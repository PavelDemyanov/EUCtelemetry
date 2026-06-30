/**
 * EUCtelemetry Video Editor
 * Real-time telemetry overlay preview with Canvas 2D
 */

(function() {
  'use strict';

  // ===== STATE =====
  const state = {
    videoFile: null,
    videoId: null,          // from server after upload
    videoUploaded: false,
    _currentUploadId: null,   // tracks which upload is active (to cancel stale ones)
    _uploadAborted: false,    // flag to abort in-progress upload
    _uploadActive: false,     // an upload is in progress (pause button usable)
    uploadPaused: false,      // user paused the chunked upload
    _uploadXhr: null,         // current in-flight chunk XHR (aborted on pause)
    _uploadResume: null,      // resolve() that un-blocks the paused chunk loop
    csvFile: null,
    csvId: null,
    csvData: [],            // [{t, speed, maxSpeed, voltage, temperature, current, battery, mileage, pwm, power, gps, timestamp}, ...]
    csvDuration: 0,
    timeOffset: 0,          // seconds: CSV start relative to video start
    timelineOrigin: 0,      // seconds: shift to keep all content at positive pixel positions
    csvTrimStart: 0,        // seconds from CSV start
    csvTrimEnd: 0,          // seconds from CSV start (=csvDuration initially)
    csvCropOffset: 0,       // accumulated seconds cropped from CSV left side
    vboFile: null,
    vboId: null,
    vboData: null,
    vboDuration: 0,
    vboTimeOffset: 0,
    vboTrimStart: 0,
    vboTrimEnd: 0,
    vboCropOffset: 0,
    // Track minimap (built from VBO GPS lat/long)
    trackMapReady: false,    // true when projected path is built
    trackMapClosed: false,   // auto-detected closed loop (start≈finish)
    trackMapPath: null,      // downsampled [{mx,my}] (0..1, north up) for the static line
    trackMapCache: null,     // offscreen canvas with the static track pre-rendered
    trackMapCacheKey: '',    // px-size|closed|len key — rebuild cache when it changes
    trackMapDrag: null,      // {dx,dy} offset from widget center while dragging
    // Lap analysis
    trackGateIdx: 0,         // start/finish gate = index into vboData
    trackLaps: null,         // [{i0,i1,t,avg,max}] detected laps
    trackLapMedian: 0,       // median lap time (s)
    trackAvgPath: null,      // [{mx,my}] averaged clean-lap centerline (closed)
    trackGateDrag: false,    // true while dragging the gate handle
    overlayDrag: null,       // {type:'telem'|'gauge', sx, sy, a, b} while dragging those elements
    _telemBounds: null,      // {x,y,w,h} last-drawn telemetry strip bounds (preview)
    _gaugeBounds: null,      // {cx,cy,r} last-drawn speed gauge bounds (preview)
    _lapBoardBounds: null,   // {x,y,w,h} last-drawn lap board bounds (preview)
    videoMeta: { duration: 0, width: 0, height: 0, fps: 30 },
    playing: false,
    animFrameId: null,
    // Timeline zoom
    pxPerSecond: 10,        // pixels per second on timeline (legacy)
    zoomLevel: 1,           // zoom multiplier (1 = fit all)
    timelineScroll: 0,
    // Drag state
    dragging: null,
    trimMode: false,         // null | 'csv' | 'trimLeft' | 'trimRight'
    _dragRaf: null,        // requestAnimationFrame ID for throttling drag renders
    dragStartX: 0,
    dragStartOffset: 0,
    // Thumbnails
    thumbnails: [],
    // Icons cache
    iconImages: {},      // name -> HTMLImageElement | null (loading) | false (failed)
    iconTintCache: {},   // name+'|'+color -> перекрашенный offscreen-canvas
    // No-video (chroma key) mode
    noVideoMode: false,
    chromaBgColor: '#0000FF',
    playbackTime: 0,
    isPlaying: false,
    _playbackTimer: null,
  };

  // ===== SETTINGS (mirrors Python text_settings) =====
  const settings = {
    font_size: 22,
    vertical_position: 1,
    horizontal_position: 50,
    top_padding: 14,
    text_vertical_offset: 0,
    box_opacity: 100,
    bottom_padding: 41,
    spacing: 10,
    border_radius: 13,
    static_box_size: false,
    vertical_layout: false,
    // Indicator
    indicator_scale: 100,
    indicator_x: 50,
    indicator_y: 90,
    speed_size: 138,
    unit_size: 90,
    speed_y: -15,
    unit_y: -5,
    // Visibility
    show_speed: false,
    show_max_speed: true,
    show_voltage: true,
    show_temp: true,
    show_battery: true,
    show_gps: true,
    show_mileage: true,
    show_pwm: true,
    show_power: true,
    show_current: true,
    show_time: false,
    show_dragy_speed: false,
    show_bottom_elements: true,
    use_icons: false,
    debug_overlay: false,
    center_based_indicator: true,
    // Track minimap (VBO GPS) — position/size as fractions of the frame
    show_track_map: false,
    track_map_x: 0.84,       // widget center X / frame width
    track_map_y: 0.24,       // widget center Y / frame height
    track_map_size: 0.24,    // widget side / min(frame w, h)
    show_lap_table: false,   // on-video lap timing widget (below the map)
    track_map_opacity: 100,  // background-panel opacity (%) for the map + lap board
    nav_heading_up: false,   // route mode: heading-up navigator (future path up, rider lower-1/3)
    show_raw_track: false,   // circuit: show the faint raw-GPS bundle behind the averaged lap
    raw_track_opacity: 20,   // opacity (%) of that raw-GPS bundle
    lap_board_above: false,  // reverse growth: vertical → up, horizontal → left
    lap_board_horizontal: false, // lay laps in a horizontal row instead of a vertical column
    lap_board_x: 0.77,       // lap board anchor X (fraction of frame) — LAP 1 corner
    lap_board_y: 0.40,       // lap board anchor Y (fraction of frame)
    lap_board_match_map: false, // tie lap plaque width to the map's width
  };

  // ===== LOCALIZATION (EN only for MVP) =====
  const LOC = {
    speed: 'Speed', max_speed: 'Max Speed', gps: 'GPS', voltage: 'Voltage',
    temp: 'Temp', current: 'Current', battery: 'Battery', mileage: 'Mileage',
    pwm: 'PWM', power: 'Power', time: 'Time',
    dragy_speed: 'Dragy',
    units: {
      speed: 'km/h', voltage: 'V', temp: '\u00B0C', current: 'A',
      battery: '%', mileage: 'km', pwm: '%', power: 'W',
    }
  };

  // Icon name mapping
  const LABEL_TO_ICON = {
    Speed: 'speed', 'Max Speed': 'max_speed', GPS: 'gps', Voltage: 'voltage',
    Temp: 'temp', Current: 'current', Battery: 'battery', Mileage: 'mileage',
    PWM: 'pwm', Power: 'power', Time: 'time',
    Dragy: 'dragy_speed',
  };

  // ===== DOM REFS =====
  let dom = {};

  function cacheDom() {
    dom.video = document.getElementById('editorVideo');
    dom.canvas = document.getElementById('overlayCanvas');
    dom.ctx = dom.canvas ? dom.canvas.getContext('2d') : null;
    dom.placeholder = document.getElementById('videoPlaceholder');
    dom.previewContainer = document.getElementById('previewContainer');
    // Buttons
    dom.btnUploadVideo = document.getElementById('btnUploadVideo');
    dom.btnUploadCSV = document.getElementById('btnUploadCSV');
    dom.videoFileInput = document.getElementById('videoFileInput');
    dom.csvFileInput = document.getElementById('csvFileInput');
    dom.btnPlayPause = document.getElementById('btnPlayPause');
    dom.playIcon = document.getElementById('playIcon');
    dom.btnZoomIn = document.getElementById('btnZoomIn');
    dom.btnZoomOut = document.getElementById('btnZoomOut');
    dom.btnZoomFit = document.getElementById('btnZoomFit');
    dom.btnFullscreen = document.getElementById('btnFullscreen');
    dom.seekBar = document.getElementById('seekBar');
    dom.currentTime = document.getElementById('currentTime');
    dom.totalTime = document.getElementById('totalTime');
    dom.btnExport = document.getElementById('btnExport');
    dom.btnStartExport = document.getElementById('btnStartExport');
    // Timeline
    dom.rulerCanvas = document.getElementById('rulerCanvas');
    dom.rulerCtx = dom.rulerCanvas ? dom.rulerCanvas.getContext('2d') : null;
    dom.videoStrip = document.getElementById('videoStrip');
    dom.videoTrackContent = document.getElementById('videoTrackContent');
    dom.csvTrackContent = document.getElementById('csvTrackContent');
    dom.csvTrack = document.getElementById('csvTrack');
    dom.csvWaveform = document.getElementById('csvWaveformCanvas');
    dom.csvWaveformCtx = dom.csvWaveform ? dom.csvWaveform.getContext('2d') : null;
    dom.btnAddVBO = document.getElementById('btnAddVBO');
    dom.vboFileInput = document.getElementById('vboFileInput');
    dom.vboTrackRow = document.getElementById('vboTrackRow');
    dom.vboTrackContent = document.getElementById('vboTrackContent');
    dom.vboWaveformCanvas = document.getElementById('vboWaveformCanvas');
    dom.vboTrimLeft = document.getElementById('vboTrimLeft');
    dom.vboTrimRight = document.getElementById('vboTrimRight');
    dom.btnVboRemove = document.getElementById('btnVboRemove');
    dom.trimLeft = document.getElementById('trimLeft');
    dom.trimRight = document.getElementById('trimRight');
    dom.btnTrimCropLeft = document.getElementById('btnTrimCropLeft');
    dom.btnTrimCropRight = document.getElementById('btnTrimCropRight');
    dom.vboBtnTrimCropLeft = document.getElementById('vboBtnTrimCropLeft');
    dom.vboBtnTrimCropRight = document.getElementById('vboBtnTrimCropRight');
    dom.btnTrimToggle = document.getElementById('btnTrimToggle');
    dom.csvTrimArrowLeft = document.getElementById('csvTrimArrowLeft');
    dom.csvTrimArrowRight = document.getElementById('csvTrimArrowRight');
    dom.vboTrimArrowLeft = document.getElementById('vboTrimArrowLeft');
    dom.vboTrimArrowRight = document.getElementById('vboTrimArrowRight');
    dom.playheadRuler = document.getElementById('playheadRuler');
    dom.playheadBarContent = document.getElementById('playheadBarContent');
    dom.playheadLine = document.getElementById('playheadLine');
    // Create spacer inside playheadBarContent so its scrollWidth matches other tracks
    if (dom.playheadBarContent) {
      dom.playheadBarSpacer = document.createElement('div');
      dom.playheadBarSpacer.style.cssText = 'position:absolute;top:0;left:0;height:1px;pointer-events:none;';
      dom.playheadBarContent.appendChild(dom.playheadBarSpacer);
    }
    // Upload progress
    dom.videoUploadProgress = document.getElementById('videoUploadProgress');
    // Export
    dom.exportFPS = document.getElementById('exportFPS');
    dom.exportDataFPS = document.getElementById('exportDataFPS');
    dom.exportCodec = document.getElementById('exportCodec');
    dom.exportResolution = document.getElementById('exportResolution');
  }

  // ===== INIT =====
  function init() {
    cacheDom();
    bindSettings();
    bindButtons();
    bindDragDrop();
    bindTimeline();
    syncTimelineScroll();
    resizeCanvases();
    initLocalExport();
    preloadIcons();
    bindTrackMapInteraction();
    updateLapUIVisibility();
    var btnUploadPause = document.getElementById('btnUploadPause');
    if (btnUploadPause) btnUploadPause.addEventListener('click', togglePauseUpload);
    window.addEventListener('resize', resizeCanvases);

    // Mobile settings panel (bottom sheet)
    var sidebar = document.querySelector('.ve-sidebar');
    var sidebarBackdrop = document.getElementById('sidebarBackdrop');
    var btnSettingsToggle = document.getElementById('btnSettingsToggle');
    var btnMobileSettings = document.getElementById('btnMobileSettings');
    function openSettings() {
      if (sidebar) sidebar.classList.add('open');
      if (sidebarBackdrop) sidebarBackdrop.classList.add('active');
    }
    function closeSettings() {
      if (sidebar) sidebar.classList.remove('open');
      if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
    }
    if (btnSettingsToggle) btnSettingsToggle.addEventListener('click', openSettings);
    if (btnMobileSettings) btnMobileSettings.addEventListener('click', openSettings);
    if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSettings);
  }

  // ===== SETTINGS BINDING =====
  function bindSettings() {
    // Text tab sliders
    const sliders = [
      { id: 'fontSize', key: 'font_size', valId: 'valFontSize' },
      { id: 'verticalPosition', key: 'vertical_position', valId: 'valVertPos' },
      { id: 'horizontalPosition', key: 'horizontal_position', valId: 'valHorizPos' },
      { id: 'topPadding', key: 'top_padding', valId: 'valTopPad' },
      { id: 'textVerticalOffset', key: 'text_vertical_offset', valId: 'valTextOffset' },
      { id: 'boxOpacity', key: 'box_opacity', valId: 'valBoxOpacity' },
      { id: 'bottomPadding', key: 'bottom_padding', valId: 'valBotPad' },
      { id: 'spacing', key: 'spacing', valId: 'valSpacing' },
      { id: 'borderRadius', key: 'border_radius', valId: 'valRadius' },
      // Indicator tab
      { id: 'indicatorScale', key: 'indicator_scale', valId: 'valScale' },
      { id: 'indicatorX', key: 'indicator_x', valId: 'valIndX' },
      { id: 'indicatorY', key: 'indicator_y', valId: 'valIndY' },
      { id: 'speedSize', key: 'speed_size', valId: 'valSpeedSize' },
      { id: 'unitSize', key: 'unit_size', valId: 'valUnitSize' },
      { id: 'speedY', key: 'speed_y', valId: 'valSpeedY' },
      { id: 'unitY', key: 'unit_y', valId: 'valUnitY' },
      { id: 'trackMapOpacity', key: 'track_map_opacity', valId: 'valTrackMapOpacity' },
      { id: 'rawTrackOpacity', key: 'raw_track_opacity', valId: 'valRawTrackOpacity' },
    ];

    sliders.forEach(function(s) {
      const el = document.getElementById(s.id);
      const valEl = document.getElementById(s.valId);
      if (!el) return;
      el.value = settings[s.key];
      if (valEl) valEl.textContent = settings[s.key];
      el.addEventListener('input', function() {
        settings[s.key] = parseFloat(this.value);
        if (valEl) valEl.textContent = this.value;
        if (s.key === 'font_size') recalcStaticBoxWidths();
        renderOverlayOnce();
      });
    });

    // Checkboxes
    const checks = [
      { id: 'staticBoxSize', key: 'static_box_size' },
      { id: 'verticalLayout', key: 'vertical_layout' },
      { id: 'showSpeed', key: 'show_speed' },
      { id: 'showMaxSpeed', key: 'show_max_speed' },
      { id: 'showVoltage', key: 'show_voltage' },
      { id: 'showTemp', key: 'show_temp' },
      { id: 'showBattery', key: 'show_battery' },
      { id: 'showGPS', key: 'show_gps' },
      { id: 'showMileage', key: 'show_mileage' },
      { id: 'showPWM', key: 'show_pwm' },
      { id: 'showPower', key: 'show_power' },
      { id: 'showCurrent', key: 'show_current' },
      { id: 'showTime', key: 'show_time' },
      { id: 'showDragySpeed', key: 'show_dragy_speed' },
      { id: 'showBottomElements', key: 'show_bottom_elements' },
      { id: 'useIcons', key: 'use_icons' },
      { id: 'debugOverlay', key: 'debug_overlay' },
      { id: 'showTrackMap', key: 'show_track_map' },
      { id: 'showLapTable', key: 'show_lap_table' },
      { id: 'navHeadingUp', key: 'nav_heading_up' },
      { id: 'showRawTrack', key: 'show_raw_track' },
      { id: 'lapBoardAbove', key: 'lap_board_above' },
      { id: 'lapBoardHorizontal', key: 'lap_board_horizontal' },
      { id: 'lapBoardMatchMap', key: 'lap_board_match_map' },
    ];

    checks.forEach(function(c) {
      const el = document.getElementById(c.id);
      if (!el) return;
      el.checked = settings[c.key];
      el.addEventListener('change', function() {
        settings[c.key] = this.checked;
        if (c.key === 'static_box_size' || c.key === 'use_icons') recalcStaticBoxWidths();
        if (c.key === 'show_track_map') { updateTrackMapInteractivity(); renderLapTable(); }
        renderOverlayOnce();
      });
    });
  }

  // ===== BUTTON BINDINGS =====
  function bindButtons() {
    // Video upload
    // Mobile action sheet for uploads
    var actionSheet = document.getElementById('uploadActionSheet');
    var btnMobileUpload = document.getElementById('btnMobileUpload');
    function openActionSheet() { if (actionSheet) actionSheet.classList.add('open'); }
    function closeActionSheet() { if (actionSheet) actionSheet.classList.remove('open'); }
    if (btnMobileUpload) btnMobileUpload.addEventListener('click', openActionSheet);
    if (actionSheet) {
      actionSheet.querySelector('.ve-action-sheet-backdrop').addEventListener('click', closeActionSheet);
      actionSheet.querySelector('.ve-action-cancel').addEventListener('click', closeActionSheet);
    }
    var mUploadVideo = document.getElementById('btnMobileUploadVideo');
    var mUploadCSV = document.getElementById('btnMobileUploadCSV');
    var mUploadVBO = document.getElementById('btnMobileUploadVBO');
    if (mUploadVideo) mUploadVideo.addEventListener('click', function() { closeActionSheet(); dom.videoFileInput.click(); });
    if (mUploadCSV) mUploadCSV.addEventListener('click', function() { closeActionSheet(); dom.csvFileInput.click(); });
    if (mUploadVBO) mUploadVBO.addEventListener('click', function() { closeActionSheet(); dom.vboFileInput.click(); });

    dom.btnUploadVideo.addEventListener('click', function() {
      dom.videoFileInput.click();
    });
    dom.videoFileInput.addEventListener('change', function(e) {
      if (e.target.files.length) handleVideoFile(e.target.files[0]);
    });

    // CSV upload
    dom.btnUploadCSV.addEventListener('click', function() {
      dom.csvFileInput.click();
    });
    dom.csvFileInput.addEventListener('change', function(e) {
      if (e.target.files.length) handleCSVFile(e.target.files[0]);
    });

    // VBO upload
    if (dom.btnAddVBO) {
      dom.btnAddVBO.addEventListener('click', function() {
        dom.vboFileInput.click();
      });
      dom.vboFileInput.addEventListener('change', function(e) {
        if (e.target.files.length) handleVBOFile(e.target.files[0]);
      });
    }
    if (dom.btnVboRemove) {
      dom.btnVboRemove.addEventListener('click', function() {
        state.vboData = null;
        state.vboDuration = 0;
        state.vboTimeOffset = 0;
        state.vboTrimStart = 0;
        state.vboTrimEnd = 0;
        state.trackMapReady = false;
        state.trackMapPath = null;
        state.trackMapCache = null;
        state.trackMapCacheKey = '';
        state.trackLaps = null;
        state.trackAvgPath = null;
        updateTrackMapInteractivity();
        renderLapTable();
        updateLapUIVisibility();
        state.vboId = null;
        settings.show_dragy_speed = false;
        var el = document.getElementById('showDragySpeed');
        if (el) el.checked = false;
        if (dom.vboTrackRow) dom.vboTrackRow.style.display = 'none';
        renderOverlayOnce();
      });
    }

    // Playback controls
    dom.btnPlayPause.addEventListener('click', togglePlay);
    // Zoom controls
    dom.btnZoomIn.addEventListener('click', function() { zoomTimeline(1.5); });
    dom.btnZoomOut.addEventListener('click', function() { zoomTimeline(1 / 1.5); });
    dom.btnZoomFit.addEventListener('click', zoomFitAll);

    // Mobile zoom controls (duplicated for the mobile bar)
    var mZoomIn = document.getElementById('btnMobileZoomIn');
    var mZoomOut = document.getElementById('btnMobileZoomOut');
    var mZoomFit = document.getElementById('btnMobileZoomFit');
    var mTrimToggle = document.getElementById('btnMobileTrimToggle');
    if (mZoomIn) mZoomIn.addEventListener('click', function() { zoomTimeline(1.5); });
    if (mZoomOut) mZoomOut.addEventListener('click', function() { zoomTimeline(1 / 1.5); });
    if (mZoomFit) mZoomFit.addEventListener('click', zoomFitAll);
    if (dom.btnTrimCropLeft) dom.btnTrimCropLeft.addEventListener('click', function() { cropCSVLeft(); });
    if (dom.btnTrimCropRight) dom.btnTrimCropRight.addEventListener('click', function() { cropCSVRight(); });
    if (dom.vboBtnTrimCropLeft) dom.vboBtnTrimCropLeft.addEventListener('click', function() { cropVBOLeft(); });
    if (dom.vboBtnTrimCropRight) dom.vboBtnTrimCropRight.addEventListener('click', function() { cropVBORight(); });
    if (dom.btnTrimToggle) {
      dom.btnTrimToggle.addEventListener('click', function() {
        // Also sync mobile trim button
        var mBtn = document.getElementById('btnMobileTrimToggle');
        if (mBtn) mBtn.classList.toggle('trim-active', !state.trimMode);
        state.trimMode = !state.trimMode;
        dom.btnTrimToggle.classList.toggle('trim-active', state.trimMode);
        updateTrimVisibility();
        updateTrimArrows();
      });
    var mCropLeft = document.getElementById('btnMobileCropLeft');
    var mCropRight = document.getElementById('btnMobileCropRight');
    function updateMobileCropButtons() {
      if (!mCropLeft || !mCropRight) return;
      if (state.trimMode && state.csvData.length > 0) {
        mCropLeft.style.display = state.csvTrimStart > 0.1 ? '' : 'none';
        mCropRight.style.display = state.csvTrimEnd < state.csvDuration - 0.1 ? '' : 'none';
      } else {
        mCropLeft.style.display = 'none';
        mCropRight.style.display = 'none';
      }
    }
    if (mTrimToggle) {
      mTrimToggle.addEventListener('click', function() {
        state.trimMode = !state.trimMode;
        mTrimToggle.classList.toggle('trim-active', state.trimMode);
        if (dom.btnTrimToggle) dom.btnTrimToggle.classList.toggle('trim-active', state.trimMode);
        updateTrimVisibility();
        updateVboTrimVisibility();
        updateMobileCropButtons();
      });
    }
    if (mCropLeft) mCropLeft.addEventListener('click', function() { cropCSVLeft(); updateMobileCropButtons(); });
    if (mCropRight) mCropRight.addEventListener('click', function() { cropCSVRight(); updateMobileCropButtons(); });
    }
    if (dom.btnFullscreen) dom.btnFullscreen.addEventListener('click', function() { if (dom.previewContainer.requestFullscreen) dom.previewContainer.requestFullscreen(); });

    // Scroll-wheel zoom on timeline
    var timelineEl = document.querySelector('.ve-timeline');
    if (timelineEl) {
      timelineEl.addEventListener('wheel', function(e) {
        if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          var factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
          zoomTimeline(factor);
        }
      }, { passive: false });
    }

    // Seek bar
    dom.seekBar.addEventListener('input', function() {
      if (state.noVideoMode) {
        var dur = getNoVideoDuration();
        state.playbackTime = (this.value / 1000) * dur;
        renderOverlay();
        updateTimeDisplay();
        updatePlaybackCursor();
        return;
      }
      if (dom.video.src) {
        dom.video.currentTime = (this.value / 1000) * dom.video.duration;
      }
    });

    // Video time update
    dom.video.addEventListener('timeupdate', onTimeUpdate);
    dom.video.addEventListener('ended', function() {
      state.playing = false;
      dom.playIcon.className = 'bi bi-play-fill';
      stopRenderLoop();
    });

    // Export
    if (dom.btnStartExport) {
      dom.btnStartExport.addEventListener('click', startExport);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (state.noVideoMode) {
          state.playbackTime = Math.max(0, state.playbackTime - 1 / state.videoMeta.fps);
          renderOverlay(); updateTimeDisplay(); updatePlaybackCursor();
        } else {
          dom.video.currentTime = Math.max(0, dom.video.currentTime - 1 / state.videoMeta.fps);
        }
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (state.noVideoMode) {
          state.playbackTime = Math.min(getNoVideoDuration(), state.playbackTime + 1 / state.videoMeta.fps);
          renderOverlay(); updateTimeDisplay(); updatePlaybackCursor();
        } else {
          dom.video.currentTime = Math.min(dom.video.duration, dom.video.currentTime + 1 / state.videoMeta.fps);
        }
      }
    });
  }

  // ===== DRAG & DROP =====
  function bindDragDrop() {
    // Drop on video preview placeholder
    var dropTargets = [dom.placeholder, dom.previewContainer, dom.videoTrackContent];
    dropTargets.forEach(function(el) {
      if (!el) return;
      el.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        el.classList.add('ve-dragover');
      });
      el.addEventListener('dragleave', function() {
        el.classList.remove('ve-dragover');
      });
      el.addEventListener('drop', function(e) {
        e.preventDefault();
        el.classList.remove('ve-dragover');
        var files = e.dataTransfer.files;
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          if (f.type.startsWith('video/')) handleVideoFile(f);
          else if (f.name.endsWith('.csv')) handleCSVFile(f);
          else if (f.name.toLowerCase().endsWith('.vbo')) handleVBOFile(f);
        }
      });
    });

    // Drop on CSV track
    if (dom.csvTrackContent) {
      dom.csvTrackContent.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        dom.csvTrackContent.classList.add('ve-dragover');
      });
      dom.csvTrackContent.addEventListener('dragleave', function() {
        dom.csvTrackContent.classList.remove('ve-dragover');
      });
      dom.csvTrackContent.addEventListener('drop', function(e) {
        e.preventDefault();
        dom.csvTrackContent.classList.remove('ve-dragover');
        var files = e.dataTransfer.files;
        for (var i = 0; i < files.length; i++) {
          if (files[i].name.endsWith('.csv')) handleCSVFile(files[i]);
            else if (files[i].name.toLowerCase().endsWith('.vbo')) handleVBOFile(files[i]);
        }
      });
    }
  }

  // ===== NO-VIDEO (CHROMA KEY) MODE =====
  function enterNoVideoMode() {
    state.noVideoMode = true;
    // Hide placeholder, show canvas
    if (dom.placeholder) dom.placeholder.style.display = 'none';
    if (dom.canvas) dom.canvas.style.display = 'block';
    // Set default canvas size (16:9)
    if (dom.canvas) {
      dom.canvas.width = 1920;
      dom.canvas.height = 1080;
    }
    // Duration from CSV
    state.videoMeta.duration = getNoVideoDuration();
    state.playbackTime = 0;
    // Set time display
    if (dom.totalTime) dom.totalTime.textContent = formatTime(state.videoMeta.duration);
    if (dom.currentTime) dom.currentTime.textContent = formatTime(0);
    // Show chroma key color picker
    var chromaSettings = document.getElementById('chromaKeySettings');
    if (chromaSettings) chromaSettings.style.display = 'block';
    // Hide "Source" option in FPS and Resolution (no source video)
    _toggleSourceOptions(true);
    renderOverlay();
    checkExportReady();
  }

  function exitNoVideoMode() {
    state.noVideoMode = false;
    state.isPlaying = false;
    if (state._playbackTimer) {
      cancelAnimationFrame(state._playbackTimer);
      state._playbackTimer = null;
    }
    // Hide chroma key color picker
    var chromaSettings = document.getElementById('chromaKeySettings');
    if (chromaSettings) chromaSettings.style.display = 'none';
    // Restore "Source" options
    _toggleSourceOptions(false);
  }

  function getNoVideoDuration() {
    if (!state.csvData || state.csvData.length === 0) return 0;
    var trimEnd = state.csvTrimEnd || state.csvDuration || 0;
    // Right edge of CSV on timeline — CSV is always the duration limiter in no-video mode
    var csvRightEdge = state.timeOffset + trimEnd;
    return Math.max(0.1, csvRightEdge);
  }

  // Hide/show "Source" options in export dropdowns for no-video mode
  function _toggleSourceOptions(hide) {
    var fpsSelect = document.getElementById('exportFPS');
    var resSelect = document.getElementById('exportResolution');
    if (fpsSelect) {
      var srcOpt = fpsSelect.querySelector('option[value="source"]');
      if (srcOpt) srcOpt.style.display = hide ? 'none' : '';
      if (hide && fpsSelect.value === 'source') fpsSelect.value = '29.97';
    }
    if (resSelect) {
      var srcOpt2 = resSelect.querySelector('option[value="source"]');
      if (srcOpt2) srcOpt2.style.display = hide ? 'none' : '';
      if (hide && resSelect.value === 'source') resSelect.value = 'fullhd';
    }
  }

  // Chroma key color picker handler
  var _chromaPicker = document.getElementById('chromaBgColor');
  if (_chromaPicker) {
    _chromaPicker.addEventListener('input', function() {
      state.chromaBgColor = this.value;
      var label = document.getElementById('chromaBgColorLabel');
      if (label) label.textContent = this.value.toUpperCase();
      if (state.noVideoMode) renderOverlay();
    });
  }

  function startNoVideoPlayback() {
    if (!state.noVideoMode) return;
    state.isPlaying = true;
    var startWall = performance.now();
    var startTime = state.playbackTime;
    function tick() {
      if (!state.isPlaying || !state.noVideoMode) return;
      state.playbackTime = startTime + (performance.now() - startWall) / 1000;
      var maxTime = getNoVideoDuration();
      if (state.playbackTime >= maxTime) {
        state.playbackTime = maxTime;
        state.isPlaying = false;
        var playBtn = document.getElementById('btnPlay');
        if (playBtn) playBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
      }
      renderOverlay();
      updateTimeDisplay();
      updatePlaybackCursor();
      if (state.isPlaying) state._playbackTimer = requestAnimationFrame(tick);
    }
    state._playbackTimer = requestAnimationFrame(tick);
  }

  function stopNoVideoPlayback() {
    state.isPlaying = false;
    if (state._playbackTimer) {
      cancelAnimationFrame(state._playbackTimer);
      state._playbackTimer = null;
    }
  }

  // ===== VIDEO HANDLING =====
  function handleVideoFile(file) {
    if (state.noVideoMode) exitNoVideoMode();
    state.videoFile = file;
    checkExportReady();
    // Local playback immediately
    var url = URL.createObjectURL(file);
    dom.video.src = url;
    dom.video.style.display = 'block';
    dom.canvas.style.display = 'block';
    if (dom.placeholder) dom.placeholder.style.display = 'none';

    var thumbsStarted = false;
    function startThumbnails() {
      if (thumbsStarted) return;
      thumbsStarted = true;
      dom.video.currentTime = 0.001;
      dom.video.addEventListener('seeked', function onFirstSeek() {
        dom.video.removeEventListener('seeked', onFirstSeek);
        generateThumbnails();
      }, {once: true});
    }

    dom.video.addEventListener('loadedmetadata', function onMeta() {
      dom.video.removeEventListener('loadedmetadata', onMeta);
      state.videoMeta.duration = dom.video.duration;
      state.videoMeta.width = dom.video.videoWidth;
      state.videoMeta.height = dom.video.videoHeight;
      state.videoMeta.fps = 30;
      dom.totalTime.textContent = formatTime(dom.video.duration);
      resizeCanvases();
      refreshTimeline();
      renderOverlayOnce();
      checkExportReady();
    });

    // Try to force iOS Safari to load video data
    // iOS won't preload until user interaction, so we do play+pause trick
    dom.video.addEventListener('canplay', function onCanPlay() {
      dom.video.removeEventListener('canplay', onCanPlay);
      startThumbnails();
    });

    // Force load — iOS needs explicit load() + play/pause to buffer data
    dom.video.load();
    var playPromise = dom.video.play();
    if (playPromise !== undefined) {
      playPromise.then(function() {
        dom.video.pause();
        dom.video.currentTime = 0;
        // If canplay already fired before play trick, start thumbnails
        startThumbnails();
      }).catch(function() {
        // Autoplay blocked — try muted play
        dom.video.muted = true;
        var p2 = dom.video.play();
        if (p2 !== undefined) {
          p2.then(function() {
            dom.video.pause();
            dom.video.muted = false;
            dom.video.currentTime = 0;
            startThumbnails();
          }).catch(function() {
            // Both failed — thumbnails will start on first user play
            console.warn('iOS autoplay blocked — thumbnails on first play');
          });
        }
      });
    }

    // Fallback: if user presses play manually, generate thumbnails
    dom.video.addEventListener('playing', function onFirstPlay() {
      dom.video.removeEventListener('playing', onFirstPlay);
      startThumbnails();
    });

    // Пассивная оценка реального fps через requestVideoFrameCallback (видео и так
    // кратко проигрывается выше для preload). HTML5 video API не отдаёт частоту кадров,
    // и раньше fps был захардкожен 30 — 60fps-видео экспортировалось рывками и с
    // неверной длительностью. Если кадры собрать не удалось — остаётся fallback 30.
    if (typeof dom.video.requestVideoFrameCallback === 'function') {
      (function attachFpsProbe() {
        var times = [];
        function probe(now, meta) {
          if (typeof meta.mediaTime === 'number') times.push(meta.mediaTime);
          if (times.length >= 8) {
            var deltas = [];
            for (var i = 1; i < times.length; i++) { var d = times[i] - times[i - 1]; if (d > 0.0001) deltas.push(d); }
            if (deltas.length) {
              deltas.sort(function (a, b) { return a - b; });
              var fps = 1 / deltas[Math.floor(deltas.length / 2)];
              if (isFinite(fps) && fps >= 10 && fps <= 244) {
                state.videoMeta.fps = Math.round(fps * 100) / 100;
                console.log('Local export: detected source fps', state.videoMeta.fps);
              }
            }
            return; // достаточно
          }
          dom.video.requestVideoFrameCallback(probe);
        }
        dom.video.requestVideoFrameCallback(probe);
      })();
    }

    // Background upload to server — check disk space first
    fetch('/api/disk-space')
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data.enough) {
          alert('The server is temporarily out of disk space. Please try again later.');
          return;
        }
        uploadVideoToServer(file);
      })
      .catch(function() {
        // If disk check fails, proceed with upload anyway
        uploadVideoToServer(file);
      });
  }

  // Compute SHA-256 hash of first 2MB of file for deduplication
  function computeFileHash(file) {
    var HASH_SIZE = 2 * 1024 * 1024;
    var slice = file.slice(0, Math.min(HASH_SIZE, file.size));
    return slice.arrayBuffer().then(function(buffer) {
      return crypto.subtle.digest('SHA-256', buffer);
    }).then(function(hashBuffer) {
      var hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  // Toggle the upload pause button look (⏸ ↔ ▶) and the status text.
  function setUploadPauseUI(paused) {
    var btn = document.getElementById('btnUploadPause');
    if (btn) {
      btn.innerHTML = paused ? '<i class="bi bi-play-fill"></i>' : '<i class="bi bi-pause-fill"></i>';
      btn.title = paused ? 'Resume upload' : 'Pause upload';
    }
    var txt = document.getElementById('uploadStateText');
    if (txt) txt.textContent = paused ? 'Paused' : 'Uploading...';
  }

  // Pause/resume the server upload (lets users skip it when they only need Local Export).
  function togglePauseUpload() {
    if (!state._uploadActive) return;
    if (state.uploadPaused) {
      state.uploadPaused = false;
      setUploadPauseUI(false);
      if (state._uploadResume) { var r = state._uploadResume; state._uploadResume = null; r(); }
    } else {
      state.uploadPaused = true;
      setUploadPauseUI(true);
      if (state._uploadXhr) { try { state._uploadXhr.abort(); } catch (_) {} }   // stop traffic now
    }
  }

  function uploadVideoToServer(file) {
    // File size limit: 20GB for regular users, unlimited for admin
    var MAX_SIZE = 20 * 1024 * 1024 * 1024; // 20GB
    if (!window._isAdmin && file.size > MAX_SIZE) {
      var sizeMB = Math.round(file.size / 1024 / 1024);
      var limitGB = 20;
      alert('File size (' + sizeMB + ' MB) exceeds the ' + limitGB + ' GB limit.\nPlease reduce the video size and try again.');
      return;
    }

    var CHUNK_SIZE = 20 * 1024 * 1024; // 20MB chunks
    var totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    var uploadId = null;
    var MAX_RETRIES = 5;

    // Show progress
    dom.videoUploadProgress.style.display = 'flex';
    var progressBar = dom.videoUploadProgress.querySelector('.progress-bar');
    var percentSpan = dom.videoUploadProgress.querySelector('.percent');
    progressBar.style.width = '0%';
    percentSpan.textContent = '0%';

    function updateProgress(chunkIndex, chunkProgress) {
      var overall = ((chunkIndex + chunkProgress) / totalChunks) * 100;
      var pct = Math.min(Math.round(overall), 99);
      progressBar.style.width = pct + '%';
      percentSpan.textContent = pct + '%';
    }

    // Cancel any previous upload (also un-block it if it was paused, so it can exit cleanly)
    var uploadToken = Date.now() + '_' + Math.random();
    state._currentUploadId = uploadToken;
    state._uploadAborted = false;
    state.uploadPaused = false;
    if (state._uploadResume) { var _r = state._uploadResume; state._uploadResume = null; _r(); }
    if (state._uploadXhr) { try { state._uploadXhr.abort(); } catch (_) {} state._uploadXhr = null; }
    state._uploadActive = true;
    setUploadPauseUI(false);

    // Step 0: Compute file hash for dedup, then init upload
    computeFileHash(file).catch(function() { return ''; }).then(function(fileHash) {

      // Step 1: Initialize upload (server checks if file already exists by hash+size)
      fetch('/video-editor/upload-video-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          totalSize: file.size,
          totalChunks: totalChunks,
          fileHash: fileHash
        })
      })
      .then(function(resp) {
        if (!resp.ok) return resp.json().then(function(d) { throw new Error(d.error || 'Init failed'); });
        return resp.json();
      })
      .then(function(data) {
        // Server found identical file already uploaded — skip chunked upload
        if (data.existing) {
          console.log('Video already on server, skipping upload. videoId=' + data.video_id);
          return { video_id: data.video_id, skipped: true };
        }
        uploadId = data.upload_id;
        if (state._currentUploadId !== uploadToken) {
          console.log('Upload ' + uploadId + ' superseded by newer upload, aborting');
          state._uploadAborted = true;
          throw new Error('__UPLOAD_SUPERSEDED__');
        }
        return sendChunk(0).then(function() {
          return fetch('/video-editor/upload-video-complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ upload_id: uploadId })
          });
        }).then(function(resp) {
          if (!resp.ok) throw new Error('Complete failed: ' + resp.status);
          return resp.json();
        });
      })
      .then(function(data) {
        if (!data) return;
        if (state._currentUploadId !== uploadToken) {
          console.log('Upload completed but was superseded, ignoring');
          return;
        }
        dom.videoUploadProgress.style.display = 'none';
        state._uploadActive = false;
        state.uploadPaused = false;
        state.videoId = data.video_id;
        state.videoUploaded = true;
        console.log('Video ' + (data.skipped ? 'reused from server' : 'uploaded') + ', videoId=' + data.video_id);
        checkExportReady();
      })
      .catch(function(err) {
        if (err.message === '__UPLOAD_SUPERSEDED__') {
          console.log('Previous upload cancelled (superseded)');
          return;
        }
        state._uploadActive = false;
        state.uploadPaused = false;
        dom.videoUploadProgress.style.display = 'none';
        alert('Video upload failed: ' + err.message);
      });

    }); // end computeFileHash

    // Resolves immediately unless the user paused the upload — then waits for resume.
    function waitWhilePaused() {
      if (!state.uploadPaused) return Promise.resolve();
      return new Promise(function(resolve) { state._uploadResume = resolve; });
    }

    function sendChunk(index) {
      if (index >= totalChunks) return Promise.resolve();
      if (state._currentUploadId !== uploadToken) return Promise.reject(new Error('__UPLOAD_SUPERSEDED__'));
      return waitWhilePaused().then(function() {
        if (state._currentUploadId !== uploadToken) throw new Error('__UPLOAD_SUPERSEDED__');
        return sendChunkWithRetry(index, 0);
      });
    }

    function sendChunkWithRetry(index, attempt) {
      // Abort if this upload was superseded
      if (state._currentUploadId !== uploadToken) {
        return Promise.reject(new Error('__UPLOAD_SUPERSEDED__'));
      }
      var start = index * CHUNK_SIZE;
      var end = Math.min(start + CHUNK_SIZE, file.size);
      var blob = file.slice(start, end);

      return new Promise(function(resolve, reject) {
        var formData = new FormData();
        formData.append('upload_id', uploadId);
        formData.append('chunk_index', index);
        formData.append('chunk', blob, 'chunk_' + index);

        var xhr = new XMLHttpRequest();
        state._uploadXhr = xhr;
        xhr.open('POST', '/video-editor/upload-video-chunk', true);
        xhr.timeout = 120000; // 2 min timeout per chunk

        xhr.upload.addEventListener('progress', function(e) {
          if (e.lengthComputable) {
            updateProgress(index, e.loaded / e.total);
          }
        });

        xhr.addEventListener('load', function() {
          state._uploadXhr = null;
          if (xhr.status === 200) {
            resolve();
          } else {
            reject(new Error('Chunk ' + index + ' failed: ' + xhr.statusText));
          }
        });

        xhr.addEventListener('error', function() {
          state._uploadXhr = null;
          reject(new Error('Chunk ' + index + ' network error'));
        });

        xhr.addEventListener('timeout', function() {
          state._uploadXhr = null;
          reject(new Error('Chunk ' + index + ' timeout'));
        });

        // Pausing aborts the in-flight chunk → re-sent from the start after resume (no wasted bytes).
        xhr.addEventListener('abort', function() {
          state._uploadXhr = null;
          reject(new Error('__UPLOAD_PAUSED__'));
        });

        xhr.send(formData);
      }).then(function() {
        return sendChunk(index + 1);
      }).catch(function(err) {
        if (err.message === '__UPLOAD_PAUSED__') {
          // Wait until the user resumes, then re-send THIS chunk from scratch.
          return waitWhilePaused().then(function() {
            if (state._currentUploadId !== uploadToken) throw new Error('__UPLOAD_SUPERSEDED__');
            return sendChunkWithRetry(index, 0);
          });
        }
        if (err.message === '__UPLOAD_SUPERSEDED__') throw err;
        if (attempt < MAX_RETRIES) {
          console.warn('Chunk ' + index + ' failed (attempt ' + (attempt + 1) + '/' + MAX_RETRIES + '), retrying in 2s...', err.message);
          return new Promise(function(resolve) { setTimeout(resolve, 2000); })
            .then(function() { return sendChunkWithRetry(index, attempt + 1); });
        }
        throw err;
      });
    }
  }

  // ===== THUMBNAIL GENERATION =====
  function generateThumbnails() {
    var video = dom.video;
    var count = 30;
    var interval = video.duration / count;
    state.thumbnails = [];
    dom.videoStrip.innerHTML = '';

    var thumbCanvas = document.createElement('canvas');
    var thumbCtx = thumbCanvas.getContext('2d');
    var thumbH = 50;
    var thumbW = Math.round(thumbH * (video.videoWidth / video.videoHeight));
    thumbCanvas.width = thumbW;
    thumbCanvas.height = thumbH;

    var idx = 0;
    var retries = 0;
    var maxRetries = 3; // max retries per frame if black

    function isFrameBlack() {
      var data = thumbCtx.getImageData(0, 0, thumbW, thumbH).data;
      var total = 0;
      var step = 16; // sample every 16th pixel for speed
      var samples = 0;
      for (var i = 0; i < data.length; i += step * 4) {
        total += data[i] + data[i + 1] + data[i + 2];
        samples++;
      }
      var avgBrightness = total / (samples * 3);
      return avgBrightness < 10; // nearly black
    }

    function extractNext() {
      if (idx >= count) {
        // All thumbnails generated — seek to show first frame in viewer
        video.currentTime = 0.001;
        updateVideoStrip();
        return;
      }
      // Start each frame at offset 0.5s to avoid exact keyframe boundaries with black
      var seekTime = idx * interval + 0.5;
      if (seekTime >= video.duration) seekTime = video.duration - 0.1;
      video.currentTime = seekTime;
    }

    video.addEventListener('seeked', function onSeeked() {
      if (idx >= count) {
        video.removeEventListener('seeked', onSeeked);
        video.currentTime = 0.001;
        updateVideoStrip();
        return;
      }
      thumbCtx.drawImage(video, 0, 0, thumbW, thumbH);

      // If frame is black and we haven't retried too many times, skip 0.3s forward
      if (isFrameBlack() && retries < maxRetries) {
        retries++;
        var retry = video.currentTime + 0.3;
        if (retry < video.duration) {
          video.currentTime = retry;
          return; // will fire seeked again
        }
      }

      retries = 0;
      var img = document.createElement('img');
      img.src = thumbCanvas.toDataURL('image/jpeg', 0.5);
      img.className = 've-thumb';
      dom.videoStrip.appendChild(img);
      state.thumbnails.push(img);
      idx++;
      extractNext();
    });

    extractNext();
  }

  // ===== CSV HANDLING =====
  function handleCSVFile(file) {
    state.csvFile = file;
    var reader = new FileReader();
    reader.onload = function(e) {
      parseCSV(e.target.result);
      checkExportReady();
    };
    reader.readAsText(file);

    // Also upload to server
    uploadCSVToServer(file);
  }

  function uploadCSVToServer(file) {
    var formData = new FormData();
    formData.append('csv', file);
    return fetch('/video-editor/upload-csv', { method: 'POST', body: formData })
      .then(function(r) { return r.json(); })
      .then(function(data) { state.csvId = data.csv_id; checkExportReady(); return data; })
      .catch(function(err) { console.error('CSV upload failed:', err); throw err; });
  }

  function parseCSV(text) {
    var lines = text.split('\n');
    if (lines.length < 2) return;

    // Parse header
    var header = lines[0].split(',').map(function(h) { return h.trim().replace(/"/g, ''); });

    // Detect CSV type
    var type = detectCSVType(header);
    if (!type) { alert('Unrecognized CSV format'); return; }
    state.csvType = type;  // запоминаем источник телеметрии для статистики Local Export

    var data = [];
    var firstTimestamp = null;
    var maxSpeed = 0;

    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var cols = parseCSVLine(line);
      if (cols.length < header.length) continue;

      var row = {};
      for (var j = 0; j < header.length; j++) {
        row[header[j]] = cols[j];
      }

      var point = extractDataPoint(row, type);
      if (point === null) continue;

      if (firstTimestamp === null) firstTimestamp = point.timestamp;
      point.t = point.timestamp - firstTimestamp; // relative seconds

      if (point.speed > maxSpeed) maxSpeed = point.speed;
      point.maxSpeed = 0; // will be computed after
      data.push(point);
    }

    // Заполнить пропуски так же, как сервер (классика): ведущие пустые строки
    // EUC World берут первое валидное значение, иначе первый кадр был бы нулевым.
    fillMissingValues(data, ['speed','voltage','temperature','current','battery','mileage','pwm','power','gps']);

    // ===== ПОЛНЫЙ ПАРИТЕТ С КЛАССИКОЙ (utils/csv_processor.py) =====
    // Классика: interpolate_numeric_data округляет ВСЕ телеметрии до int → потом
    // process_mileage (одометр уже int) вычитает старт → потом remove_consecutive_duplicates.
    // Повторяем ровно этот порядок, чтобы превью/Local Export совпадали с серверным
    // экспортом, а интерполяция между разреженными точками была плавной (рампа, не «полка+скачок»).
    var INT_FIELDS = ['speed','gps','voltage','temperature','current','battery','mileage','pwm','power'];
    for (var ri = 0; ri < data.length; ri++) {
      for (var fi = 0; fi < INT_FIELDS.length; fi++) {
        var fk = INT_FIELDS[fi];
        data[ri][fk] = Math.round(data[ri][fk] || 0);
      }
    }

    // Пробег = дистанция поездки от нуля: round(odometer[i]) - round(odometer[0]).
    // Одометр уже округлён выше, поэтому это вычитание двух int — как в классике.
    if (data.length > 0) {
      var mileageStart = data[0].mileage || 0;
      for (var mi = 0; mi < data.length; mi++) {
        data[mi].mileage = (data[mi].mileage || 0) - mileageStart;
      }
    }

    // Удаляем подряд идущие дубли (remove_consecutive_duplicates): строка выкидывается,
    // если ВСЕ 9 полей совпали с предыдущей. Именно это даёт плавность — getDataAtTime
    // потом интерполирует между РАЗНЫМИ значениями через весь интервал между ними.
    if (data.length > 1) {
      var deduped = [data[0]];
      for (var di = 1; di < data.length; di++) {
        var pr = deduped[deduped.length - 1], same = true;
        for (var fj = 0; fj < INT_FIELDS.length; fj++) {
          if (data[di][INT_FIELDS[fj]] !== pr[INT_FIELDS[fj]]) { same = false; break; }
        }
        if (!same) deduped.push(data[di]);
      }
      data = deduped;
    }

    // Compute running max speed (после дедупа, на целочисленной скорости)
    var runMax = 0;
    for (var k = 0; k < data.length; k++) {
      if (data[k].speed > runMax) runMax = data[k].speed;
      data[k].maxSpeed = runMax;
    }

    state.csvData = data;
    state.csvDuration = data.length > 0 ? data[data.length - 1].t : 0;
    state.csvTrimStart = 0;
    state.csvTrimEnd = state.csvDuration;
    state.csvCropOffset = 0;
    recalcStaticBoxWidths();
    checkExportReady();
    updateTrackMapInteractivity();   // CSV loaded → telemetry/gauge become draggable on the canvas

    // Auto-enter no-video mode if no video loaded
    if (!state.videoFile && state.csvData.length > 0) {
      enterNoVideoMode();
    }

    // Show CSV track
    dom.csvTrack.style.display = 'block';
    // Use rAF to ensure layout is computed after display:block before measuring widths
    requestAnimationFrame(function() {
      refreshTimeline();
      renderOverlayOnce();
      resizeCanvases();
    });
  }

  function detectCSVType(header) {
    // DarknessBot: Date, Speed, Voltage
    var hasDB = header.indexOf('Date') >= 0 && header.indexOf('Speed') >= 0 && header.indexOf('Voltage') >= 0;
    // EUC World: datetime, speed, voltage, safety_margin
    var hasEW = header.indexOf('datetime') >= 0 && header.indexOf('speed') >= 0 && header.indexOf('voltage') >= 0 && header.indexOf('safety_margin') >= 0;
    // WheelLog: date, speed, voltage
    var hasWL = header.indexOf('date') >= 0 && header.indexOf('speed') >= 0 && header.indexOf('voltage') >= 0;
    if (hasDB) return 'darknessbot';
    if (hasEW) return 'eucworld';
    if (hasWL) return 'wheellog';
    return null;
  }

  function extractDataPoint(row, type) {
    // ВАЖНО: пропущенные/пустые значения оставляем как null (а не 0), чтобы их
    // потом заполнить так же, как делает сервер (интерполяция + edge-fill).
    // Иначе ведущие пустые строки EUC World давали бы "нулевой" первый кадр.
    var point = { timestamp: 0, speed: null, voltage: null, temperature: null, current: null, battery: null, mileage: null, pwm: null, power: null, gps: null };
    try {
      if (type === 'darknessbot') {
        point.timestamp = parseDarknessBotTimestamp(row['Date']);
        point.speed = numOrNull(row['Speed']);
        point.voltage = numOrNull(row['Voltage']);
        point.temperature = numOrNull(row['Temperature']);
        point.current = numOrNull(row['Current']);
        point.battery = numOrNull(row['Battery level']);
        point.mileage = numOrNull(row['Total mileage']);
        point.pwm = numOrNull(row['PWM']);
        point.power = numOrNull(row['Power']);
        point.gps = numOrNull(row['GPS Speed']);
      } else if (type === 'eucworld') {
        // EUC World: ISO 8601 datetime with timezone
        var dt = new Date(row['datetime']);
        point.timestamp = dt.getTime() / 1000;
        point.speed = numOrNull(row['speed']);
        point.voltage = numOrNull(row['voltage']);
        point.temperature = numOrNull(row['temp']);
        point.current = numOrNull(row['current']);
        point.battery = numOrNull(row['battery']);
        point.mileage = numOrNull(row['distance_total']);
        if (point.mileage === null) point.mileage = numOrNull(row['distance']);
        var sm = numOrNull(row['safety_margin']);
        point.pwm = (sm === null) ? null : (100 - sm);
        point.power = numOrNull(row['power']);
        point.gps = numOrNull(row['gps_speed']);
      } else if (type === 'wheellog') {
        point.timestamp = parseWheelLogTimestamp(row['date'], row['time']);
        point.speed = numOrNull(row['speed']);
        point.voltage = numOrNull(row['voltage']);
        point.temperature = numOrNull(row['system_temp']);
        point.current = numOrNull(row['current']);
        point.battery = numOrNull(row['battery_level']);
        var td = numOrNull(row['totaldistance']);
        point.mileage = (td === null) ? null : (td / 1000);
        point.pwm = numOrNull(row['pwm']);
        point.power = numOrNull(row['power']);
        point.gps = numOrNull(row['gps_speed']);
      }
      if (point.timestamp === null || isNaN(point.timestamp)) return null;
      return point;
    } catch (e) {
      return null;
    }
  }

  function parseDarknessBotTimestamp(dateStr) {
    if (!dateStr) return null;
    // Формат 1 — DarknessBot (классический): DD.MM.YYYY HH:MM:SS.fff
    // (дата и время разделены пробелом, дата через точки).
    var parts = dateStr.split(' ');
    if (parts.length >= 2) {
      var dp = parts[0].split('.');
      var tp = parts[1].split(':');
      if (dp.length < 3 || tp.length < 3) return null;
      var secParts = tp[2].split('.');
      var sec = parseInt(secParts[0]);
      var ms = secParts.length > 1 ? parseInt(secParts[1]) : 0;
      var d = new Date(parseInt(dp[2]), parseInt(dp[1]) - 1, parseInt(dp[0]),
                       parseInt(tp[0]), parseInt(tp[1]), sec, ms);
      var t = d.getTime() / 1000;
      return isNaN(t) ? null : t;
    }
    // Формат 2 — EUC World (экспорт с iOS): ISO 8601 без пробела,
    // например 2026-05-30T15:47:30.631221 (микросекунды, опциональный TZ).
    return parseISOTimestamp(dateStr);
  }

  function parseISOTimestamp(s) {
    if (!s) return null;
    s = String(s).trim();
    if (!s) return null;
    // JS Date понимает только миллисекунды, а 6-значные микросекунды разные
    // движки парсят по-разному. Обрезаем дробную часть до 3 знаков, сохраняя
    // возможный часовой пояс (Z или ±HH:MM) после неё.
    var normalized = s.replace(/(\.\d{3})\d+/, '$1');
    var d = new Date(normalized);
    var t = d.getTime();
    return isNaN(t) ? null : t / 1000;
  }

  function parseWheelLogTimestamp(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    var dt = dateStr + 'T' + timeStr;
    var d = new Date(dt);
    return d.getTime() / 1000;
  }

  function parseCSVLine(line) {
    // Simple CSV parser handling quoted fields
    var result = [];
    var current = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    result.push(current.trim());
    return result;
  }

  function safeFloat(val) {
    var n = parseFloat(val);
    return isNaN(n) ? 0 : n;
  }

  // Число или null, если значение пустое/не парсится.
  // ВАЖНО: реальный "0"/"0.0" остаётся нулём — это НЕ пропуск.
  function numOrNull(val) {
    if (val === null || val === undefined) return null;
    var s = String(val).trim();
    if (s === '') return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  // Заполняет пропуски (null) по каждому полю так же, как сервер
  // (pandas interpolate(method='linear', limit_direction='both') + fillna(0)):
  //  - ведущие пропуски  -> значение первой валидной точки (back-fill);
  //  - концевые пропуски  -> значение последней валидной точки (forward-fill);
  //  - внутренние         -> линейная интерполяция по индексу строк;
  //  - полностью пустое поле -> 0.
  function fillMissingValues(data, fields) {
    if (!data || data.length === 0) return;
    var n = data.length;
    function isMissing(v) { return v === null || v === undefined || (typeof v === 'number' && isNaN(v)); }
    fields.forEach(function(f) {
      var i = 0;
      while (i < n) {
        if (!isMissing(data[i][f])) { i++; continue; }
        var j = i + 1;
        while (j < n && isMissing(data[j][f])) j++;
        var prev = i - 1;
        if (prev < 0 && j < n) {
          for (var a = i; a < j; a++) data[a][f] = data[j][f];            // ведущие
        } else if (j >= n && prev >= 0) {
          for (var b = i; b < n; b++) data[b][f] = data[prev][f];          // концевые
        } else if (prev >= 0 && j < n) {
          var v0 = data[prev][f], v1 = data[j][f], span = j - prev;        // внутренние
          for (var c = i; c < j; c++) data[c][f] = v0 + (v1 - v0) * ((c - prev) / span);
        } else {
          for (var e = i; e < n; e++) data[e][f] = 0;                      // всё пусто
        }
        i = j;
      }
    });
  }

  // ===== TIMELINE HELPERS =====
  function getTimelineDuration() {
    if (state.noVideoMode) {
      // No video — timeline shows all content (CSV + VBO)
      var csvEnd = state.csvDuration > 0 ? Math.max(0, state.timeOffset) + state.csvDuration : 0;
      var vboEnd = state.vboDuration > 0 ? Math.max(0, state.vboTimeOffset) + state.vboDuration : 0;
      return Math.max(csvEnd, vboEnd, 0.1);
    }
    // Timeline must show ALL content — use actual right edges (with offsets)
    var videoDur = state.videoMeta.duration || 0;
    var csvEnd = state.csvDuration > 0 ? Math.max(0, state.timeOffset) + state.csvDuration : 0;
    var vboEnd = state.vboDuration > 0 ? Math.max(0, state.vboTimeOffset) + state.vboDuration : 0;
    var dur = Math.max(videoDur, csvEnd, vboEnd);
    if (dur <= 0) dur = 1;
    return dur;
  }

  function getBasePxPerSecond() {
    var trackWidth = dom.csvTrackContent ? dom.csvTrackContent.clientWidth : 1;
    return trackWidth / getTimelineDuration();
  }

  function getPxPerSecond() {
    if (state._frozenPps) return state._frozenPps;
    return getBasePxPerSecond() * state.zoomLevel;
  }

  function zoomTimeline(factor) {
    var oldZoom = state.zoomLevel;
    state.zoomLevel = Math.max(0.01, Math.min(50, state.zoomLevel * factor));
    if (state.zoomLevel === oldZoom) return;

    // Zoom anchored to playhead position (like DaVinci Resolve)
    var videoTime = state.noVideoMode ? state.playbackTime : (dom.video.currentTime || 0);
    var origin = state.timelineOrigin;
    var basePps = getBasePxPerSecond();
    var oldPps = basePps * oldZoom;
    var newPps = basePps * state.zoomLevel;

    // Playhead screen position before zoom (includes origin offset)
    var scrollEl = dom.videoTrackContent;
    var scrollLeft = scrollEl ? scrollEl.scrollLeft : 0;
    var playheadScreenX = (videoTime + origin) * oldPps - scrollLeft;

    // Refresh all timeline elements with new zoom
    refreshTimeline();

    // Restore scroll so playhead stays at same screen position
    var newScrollLeft = Math.max(0, (videoTime + state.timelineOrigin) * newPps - playheadScreenX);

    // Sync scroll to ALL scrollable timeline elements at once
    var rulerEl = document.querySelector('.ve-ruler');
    var phBarEl = document.getElementById('playheadBarContent');
    [scrollEl, rulerEl, phBarEl, dom.csvTrackContent].forEach(function(el) {
      if (el) el.scrollLeft = newScrollLeft;
    });

    // Update playhead line after scroll is set
    updatePlayheadLine();
  }

  function zoomFitAll() {
    state.zoomLevel = 1;
    refreshTimeline();
    // Scroll to start — at zoom 1 everything fits, so scroll=0
    var _scrollEls = [dom.videoTrackContent, dom.csvTrackContent, dom.vboTrackContent,
      document.querySelector('.ve-ruler'), document.getElementById('playheadBarContent')];
    _scrollEls.forEach(function(el) { if (el) el.scrollLeft = 0; });
  }

  function recalcTimelineOrigin() {
    // When timeOffset < 0, CSV starts before video — shift everything right
    // so nothing has negative pixel positions
    state.timelineOrigin = 0;
  }

  function refreshTimeline() {
    recalcTimelineOrigin();
    updateTrackWidths();
    renderWaveform();
    renderVBOWaveform();
    updateVboTrimHandles();
    drawRuler();
    updatePlayheads();
    updateVideoStrip();
    updateTrimArrows();
    // Keep playheadBarContent scrollWidth in sync with other tracks
    if (dom.playheadBarSpacer) {
      var totalW = getTimelineDuration() * getPxPerSecond();
      dom.playheadBarSpacer.style.width = totalW + 'px';
    }
  }

  function updateTrackWidths() {
    // Nothing needed - individual elements (strip, waveform, playheads) set their own widths
  }

  function updateVideoStrip() {
    if (!dom.videoStrip) return;
    var pxPerSec = getPxPerSecond();
    var videoDur = state.videoMeta.duration || getTimelineDuration();
    var videoWidth = videoDur * pxPerSec;
    // Shift video strip right when CSV starts before video
    dom.videoStrip.style.left = (state.timelineOrigin * pxPerSec) + 'px';
    dom.videoStrip.style.width = videoWidth + 'px';
    // Resize thumbnails to fill the strip evenly
    var thumbs = dom.videoStrip.querySelectorAll('.ve-thumb');
    if (thumbs.length > 0) {
      var thumbW = Math.ceil(videoWidth / thumbs.length);
      for (var i = 0; i < thumbs.length; i++) {
        thumbs[i].style.width = thumbW + 'px';
        thumbs[i].style.objectFit = 'cover';
      }
    }
  }

  // ===== WAVEFORM RENDERING =====
  function renderWaveform() {
    if (!dom.csvWaveform || state.csvData.length === 0) return;

    var pxPerSec = getPxPerSecond();
    var csvWidthPx = Math.max(1, state.csvDuration * pxPerSec);
    // Position CSV track (uses timelineOrigin to avoid negative positions)
    updateCSVTrackPosition();
    dom.csvTrack.style.width = csvWidthPx + 'px';

    var canvas = dom.csvWaveform;
    var dpr = window.devicePixelRatio || 1;

    // Virtual scrolling: canvas covers only visible portion + buffer
    var parentScroll = dom.csvTrackContent ? dom.csvTrackContent.scrollLeft : 0;
    var viewportW = dom.csvTrackContent ? dom.csvTrackContent.clientWidth : csvWidthPx;
    var trackLeft = parseFloat(dom.csvTrack.style.left) || 0;
    // Visible range in track-local coordinates
    var visLeft = parentScroll - trackLeft;
    var visRight = visLeft + viewportW;
    var buffer = viewportW * 0.5;
    var drawLeft = Math.max(0, visLeft - buffer);
    var drawRight = Math.min(csvWidthPx, visRight + buffer);
    var drawW = drawRight - drawLeft;
    if (drawW < 20) drawW = Math.min(csvWidthPx, viewportW + 200);
    if (drawW < 20) drawW = 20;
    // Clamp to avoid exceeding canvas limits
    var MAX_CANVAS_DIM = 8192;
    if (drawW * dpr > MAX_CANVAS_DIM) drawW = MAX_CANVAS_DIM / dpr;

    canvas.width = Math.ceil(drawW * dpr);
    canvas.height = 50 * dpr;
    canvas.style.width = drawW + 'px';
    canvas.style.height = '50px';
    canvas.style.position = 'absolute';
    canvas.style.left = drawLeft + 'px';
    canvas.style.top = '0';

    var ctx = dom.csvWaveformCtx;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, drawW, 50);

    var h = 50;
    var data = state.csvData;
    var maxPWM = 100;
    var maxSpeed = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i].speed > maxSpeed) maxSpeed = data[i].speed;
    }
    if (maxSpeed === 0) maxSpeed = 1;

    // Convert time to track-local x, then to canvas-local x
    function tToX(t) {
      return (t / state.csvDuration) * csvWidthPx - drawLeft;
    }

    // Draw trimmed regions (dimmed overlay)
    var trimLeftPx = (state.csvTrimStart / state.csvDuration) * csvWidthPx;
    var trimRightPx = (state.csvTrimEnd / state.csvDuration) * csvWidthPx;

    // Draw PWM as red filled area
    ctx.fillStyle = 'rgba(180, 40, 40, 0.6)';
    ctx.beginPath();
    ctx.moveTo(tToX(data[0].t), h);
    for (var j = 0; j < data.length; j++) {
      var x = tToX(data[j].t);
      if (x < -10) continue;
      if (x > drawW + 10) { ctx.lineTo(x, h - (Math.min(data[j].pwm, maxPWM) / maxPWM) * h); break; }
      var y = h - (Math.min(data[j].pwm, maxPWM) / maxPWM) * h;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(tToX(data[data.length - 1].t), h);
    ctx.closePath();
    ctx.fill();

    // Draw Speed as blue line
    ctx.strokeStyle = 'rgba(60, 130, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var started = false;
    for (var k = 0; k < data.length; k++) {
      var sx = tToX(data[k].t);
      if (sx < -10) continue;
      if (sx > drawW + 10) {
        var sy2 = h - (data[k].speed / maxSpeed) * h;
        ctx.lineTo(sx, sy2);
        break;
      }
      var sy = h - (data[k].speed / maxSpeed) * h;
      if (!started) { ctx.moveTo(sx, sy); started = true; }
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // Dim trimmed-out regions (in canvas-local coords)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    var trimLeftLocal = trimLeftPx - drawLeft;
    var trimRightLocal = trimRightPx - drawLeft;
    if (trimLeftLocal > 0) {
      ctx.fillRect(0, 0, trimLeftLocal, h);
    }
    if (trimRightLocal < drawW) {
      ctx.fillRect(trimRightLocal, 0, drawW - trimRightLocal, h);
    }

    // Update trim handles
    updateTrimHandles(csvWidthPx);
  }

  function updateCSVTrackPosition() {
    if (!dom.csvTrack) return;
    var pxPerSec = getPxPerSecond();
    dom.csvTrack.style.left = ((state.timeOffset + state.timelineOrigin) * pxPerSec) + 'px';
    updateTrimArrows();
  }

  function updateTrimHandles(trackW) {
    if (!dom.trimLeft || !dom.trimRight || state.csvDuration <= 0) return;
    var leftPx = (state.csvTrimStart / state.csvDuration) * trackW;
    var rightPx = (state.csvTrimEnd / state.csvDuration) * trackW;
    dom.trimLeft.style.left = leftPx + 'px';
    dom.trimRight.style.left = (rightPx - 8) + 'px';
    // Left scissors (right of left handle)
    if (dom.btnTrimCropLeft) {
      var show = state.trimMode && state.csvTrimStart > 0.1;
      dom.btnTrimCropLeft.classList.toggle('visible', show);
      dom.btnTrimCropLeft.style.left = (leftPx + 12) + 'px';
    }
    // Right scissors (left of right handle)
    if (dom.btnTrimCropRight) {
      var show = state.trimMode && state.csvTrimEnd < state.csvDuration - 0.1;
      dom.btnTrimCropRight.classList.toggle('visible', show);
      dom.btnTrimCropRight.style.left = (rightPx - 34) + 'px';
    }
    // Update mobile crop buttons
    var mcl = document.getElementById('btnMobileCropLeft');
    var mcr = document.getElementById('btnMobileCropRight');
    if (mcl) mcl.style.display = (state.trimMode && state.csvTrimStart > 0.1) ? '' : 'none';
    if (mcr) mcr.style.display = (state.trimMode && state.csvTrimEnd < state.csvDuration - 0.1) ? '' : 'none';
  }

  function updateTrimArrows() {
    if (!state.trimMode) {
      if (dom.csvTrimArrowLeft) dom.csvTrimArrowLeft.classList.remove('visible');
      if (dom.csvTrimArrowRight) dom.csvTrimArrowRight.classList.remove('visible');
      if (dom.vboTrimArrowLeft) dom.vboTrimArrowLeft.classList.remove('visible');
      if (dom.vboTrimArrowRight) dom.vboTrimArrowRight.classList.remove('visible');
      return;
    }
    var margin = 20;
    // CSV arrows
    if (dom.csvTrackContent && dom.csvTrack && state.csvDuration > 0) {
      var scrollL = dom.csvTrackContent.scrollLeft;
      var viewW = dom.csvTrackContent.clientWidth;
      var trackLeft = parseFloat(dom.csvTrack.style.left) || 0;
      var pps = getPxPerSecond();
      var csvW = state.csvDuration * pps;
      var trimLeftPx = trackLeft + (state.csvTrimStart / state.csvDuration) * csvW;
      var trimRightPx = trackLeft + (state.csvTrimEnd / state.csvDuration) * csvW;
      var leftOff = trimLeftPx < scrollL - margin;
      var rightOff = trimRightPx > scrollL + viewW + margin;
      if (dom.csvTrimArrowLeft) {
        dom.csvTrimArrowLeft.classList.toggle('visible', leftOff);
        if (leftOff) dom.csvTrimArrowLeft.style.left = (scrollL + 4) + 'px';
      }
      if (dom.csvTrimArrowRight) {
        dom.csvTrimArrowRight.classList.toggle('visible', rightOff);
        if (rightOff) dom.csvTrimArrowRight.style.left = (scrollL + viewW - 22) + 'px';
      }
    }
    // VBO arrows
    if (dom.vboTrackContent && state.vboDuration > 0) {
      var vboTrackEl = document.getElementById('vboTrack');
      if (vboTrackEl) {
        var scrollL = dom.vboTrackContent.scrollLeft;
        var viewW = dom.vboTrackContent.clientWidth;
        var trackLeft = parseFloat(vboTrackEl.style.left) || 0;
        var pps = getPxPerSecond();
        var vboW = state.vboDuration * pps;
        var trimLeftPx = trackLeft + (state.vboTrimStart / state.vboDuration) * vboW;
        var trimRightPx = trackLeft + (state.vboTrimEnd / state.vboDuration) * vboW;
        var leftOff = trimLeftPx < scrollL - margin;
        var rightOff = trimRightPx > scrollL + viewW + margin;
        if (dom.vboTrimArrowLeft) {
          dom.vboTrimArrowLeft.classList.toggle('visible', leftOff);
          if (leftOff) dom.vboTrimArrowLeft.style.left = (scrollL + 4) + 'px';
        }
        if (dom.vboTrimArrowRight) {
          dom.vboTrimArrowRight.classList.toggle('visible', rightOff);
          if (rightOff) dom.vboTrimArrowRight.style.left = (scrollL + viewW - 22) + 'px';
        }
      }
    }
  }

  function updateTrimVisibility() {
    var show = state.trimMode;
    var els = [dom.trimLeft, dom.trimRight, dom.btnTrimCropLeft, dom.btnTrimCropRight];
    els.forEach(function(el) { if (el) el.style.display = show ? 'block' : 'none'; });
    var vels = [dom.vboTrimLeft, dom.vboTrimRight, dom.vboBtnTrimCropLeft, dom.vboBtnTrimCropRight];
    vels.forEach(function(el) { if (el) el.style.display = show ? 'block' : 'none'; });
  }

  function preserveScaleAndRefresh(oldPps) {
    // Adjust zoomLevel so pxPerSecond stays the same after timeline duration change
    var newBase = getBasePxPerSecond();
    var oldZoom = state.zoomLevel;
    if (newBase > 0) {
      // No Math.max(1,...) — allow zoom < 1 to keep same visual scale after crop
      state.zoomLevel = oldPps / newBase;
    }
    console.log('preserveScale: oldPps=' + oldPps.toFixed(3) +
      ' newBase=' + newBase.toFixed(3) +
      ' oldZoom=' + oldZoom.toFixed(3) +
      ' newZoom=' + state.zoomLevel.toFixed(3) +
      ' timelineDur=' + getTimelineDuration().toFixed(1) +
      ' csvDur=' + state.csvDuration.toFixed(1) +
      ' vboDur=' + state.vboDuration.toFixed(1) +
      ' videoDur=' + (state.videoMeta.duration || 0).toFixed(1));
    refreshTimeline();
    renderOverlayOnce();
  }

  function cropCSVLeft() {
    if (state.csvData.length === 0 || state.csvTrimStart <= 0) return;
    var tStart = state.csvTrimStart;
    var oldPps = getPxPerSecond();
    state.csvData = state.csvData.filter(function(d) { return d.t >= tStart; });
    state.csvData.forEach(function(d) { d.t -= tStart; });
    state.timeOffset += tStart;
    state.csvCropOffset += tStart;
    state.csvDuration -= tStart;
    state.csvTrimEnd -= tStart;
    state.csvTrimStart = 0;
    recalcStaticBoxWidths();
    preserveScaleAndRefresh(oldPps);
  }

  function cropCSVRight() {
    if (state.csvData.length === 0 || state.csvTrimEnd >= state.csvDuration) return;
    var tEnd = state.csvTrimEnd;
    var oldPps = getPxPerSecond();
    state.csvData = state.csvData.filter(function(d) { return d.t <= tEnd; });
    state.csvDuration = tEnd;
    state.csvTrimEnd = tEnd;
    recalcStaticBoxWidths();
    preserveScaleAndRefresh(oldPps);
  }

  function cropVBOLeft() {
    if (!state.vboData || state.vboData.length === 0 || state.vboTrimStart <= 0) return;
    var tStart = state.vboTrimStart;
    state.vboCropOffset += tStart;
    var oldPps = getPxPerSecond();
    state.vboData = state.vboData.filter(function(d) { return d.t >= tStart; });
    state.vboData.forEach(function(d) { d.t -= tStart; });
    state.vboTimeOffset += tStart;
    state.vboDuration -= tStart;
    state.vboTrimEnd -= tStart;
    state.vboTrimStart = 0;
    buildTrackMap(state.vboData);
    preserveScaleAndRefresh(oldPps);
  }

  function cropVBORight() {
    if (!state.vboData || state.vboData.length === 0 || state.vboTrimEnd >= state.vboDuration) return;
    var tEnd = state.vboTrimEnd;
    var oldPps = getPxPerSecond();
    state.vboData = state.vboData.filter(function(d) { return d.t <= tEnd; });
    state.vboDuration = tEnd;
    state.vboTrimEnd = tEnd;
    buildTrackMap(state.vboData);
    preserveScaleAndRefresh(oldPps);
  }

  function cropCSVToTrim() {
    if (state.csvData.length === 0) return;
    var oldPps = getPxPerSecond();
    var tStart = state.csvTrimStart;
    var tEnd = state.csvTrimEnd;
    var newData = [];
    for (var i = 0; i < state.csvData.length; i++) {
      var p = state.csvData[i];
      if (p.t >= tStart && p.t <= tEnd) {
        var np = {};
        for (var k in p) np[k] = p[k];
        np.t = p.t - tStart;
        newData.push(np);
      }
    }
    if (newData.length === 0) return;
    var runMax = 0;
    for (var j = 0; j < newData.length; j++) {
      if (newData[j].speed > runMax) runMax = newData[j].speed;
      newData[j].maxSpeed = runMax;
    }
    state.timeOffset = state.timeOffset + tStart;
    state.csvCropOffset += tStart;
    state.csvData = newData;
    state.csvDuration = newData[newData.length - 1].t;
    state.csvTrimStart = 0;
    state.csvTrimEnd = state.csvDuration;
    preserveScaleAndRefresh(oldPps);
  }

  // ===== TIMELINE =====
  // Helper: seek video from a clientX position relative to a bar element
  function seekFromClientX(clientX, barEl) {
    if (!state.noVideoMode && !dom.video.src) return;
    if (!barEl) return;
    var rect = barEl.getBoundingClientRect();
    var clickX = clientX - rect.left + barEl.scrollLeft;
    var pps = getPxPerSecond();
    var t = clickX / pps - state.timelineOrigin;
    if (state.noVideoMode) {
      state.playbackTime = Math.max(0, Math.min(t, getNoVideoDuration()));
      renderOverlay();
      updateTimeDisplay();
      updatePlaybackCursor();
      return;
    }
    dom.video.currentTime = Math.max(0, Math.min(t, dom.video.duration || 0));
  }

  // Helper: handle all track drag movement (called from both mouse and touch)
  function handleTrackDragMove(clientX) {
    if (!state.dragging) return;
    var pxPerSec = getPxPerSecond();
    if (pxPerSec <= 0) return;
    var dx = clientX - state.dragStartX;
    var dtSec = dx / pxPerSec;

    if (state.dragging === 'csv') {
      state.timeOffset = state.dragStartOffset + dtSec;
      if (state.noVideoMode) {
        state.videoMeta.duration = getNoVideoDuration();
        updateTimeDisplay();
      }
      updateCSVTrackPosition();
      if (!state._dragRaf) {
        state._dragRaf = requestAnimationFrame(function() {
          state._dragRaf = null;
          renderOverlayOnce();
        });
      }
    } else if (state.dragging === 'trimLeft') {
      var newStart = state.dragStartTrimStart + dtSec;
      state.csvTrimStart = Math.max(0, Math.min(newStart, state.csvTrimEnd - 0.5));
      if (state.noVideoMode) state.videoMeta.duration = getNoVideoDuration();
      updateTrimHandles(state.csvDuration * getPxPerSecond());
      if (!state._dragRaf) {
        state._dragRaf = requestAnimationFrame(function() {
          state._dragRaf = null;
          renderWaveform();
        });
      }
    } else if (state.dragging === 'trimRight') {
      var newEnd = state.dragStartTrimEnd + dtSec;
      state.csvTrimEnd = Math.max(state.csvTrimStart + 0.5, Math.min(newEnd, state.csvDuration));
      if (state.noVideoMode) state.videoMeta.duration = getNoVideoDuration();
      updateTrimHandles(state.csvDuration * getPxPerSecond());
      if (!state._dragRaf) {
        state._dragRaf = requestAnimationFrame(function() {
          state._dragRaf = null;
          renderWaveform();
        });
      }
    } else if (state.dragging === 'vbo') {
      state.vboTimeOffset = state.dragStartVboOffset + dtSec;
      updateVBOTrackPosition();
      if (!state._dragRaf) {
        state._dragRaf = requestAnimationFrame(function() {
          state._dragRaf = null;
          renderOverlayOnce();
        });
      }
    } else if (state.dragging === 'vboTrimLeft') {
      var newVboStart = state.dragStartVboTrimStart + dtSec;
      state.vboTrimStart = Math.max(0, Math.min(newVboStart, state.vboTrimEnd - 0.5));
      updateVboTrimHandles();
      if (!state._dragRaf) {
        state._dragRaf = requestAnimationFrame(function() {
          state._dragRaf = null;
          renderVBOWaveform();
        });
      }
    } else if (state.dragging === 'vboTrimRight') {
      var newVboEnd = state.dragStartVboTrimEnd + dtSec;
      state.vboTrimEnd = Math.max(state.vboTrimStart + 0.5, Math.min(newVboEnd, state.vboDuration));
      updateVboTrimHandles();
      if (!state._dragRaf) {
        state._dragRaf = requestAnimationFrame(function() {
          state._dragRaf = null;
          renderVBOWaveform();
        });
      }
    }
  }

  // Helper: handle drag end (called from both mouse and touch)
  function handleTrackDragEnd() {
    if (state.dragging) {
      var wasDragging = state.dragging;
      state.dragging = null;
      if (state._frozenPps) {
        var frozenPps = state._frozenPps;
        state._frozenPps = null;
        var newBase = getBasePxPerSecond();
        if (newBase > 0) state.zoomLevel = frozenPps / newBase;
      }
      renderWaveform();
      renderVBOWaveform();
      updateVboTrimHandles();
      renderOverlayOnce();
    }
  }

  function bindTimeline() {
    // Playhead dragging
    var phDragging = false;

    // Mouse: playhead drag start
    document.querySelectorAll('.ve-playhead-handle, .ve-playhead-grab').forEach(function(h) {
      h.addEventListener('mousedown', function(e) {
        if (!dom.video.src) return;
        phDragging = true;
        e.preventDefault();
        e.stopPropagation();
      });
    });
    // Touch: playhead drag start
    document.querySelectorAll('.ve-playhead-handle, .ve-playhead-grab').forEach(function(h) {
      h.addEventListener('touchstart', function(e) {
        if (!dom.video.src) return;
        phDragging = true;
        e.preventDefault();
      }, {passive: false});
    });

    // Mouse: playhead drag move
    document.addEventListener('mousemove', function(e) {
      if (!phDragging) return;
      seekFromClientX(e.clientX, dom.playheadBarContent);
    });
    // Touch: playhead drag move
    document.addEventListener('touchmove', function(e) {
      if (!phDragging) return;
      seekFromClientX(e.touches[0].clientX, dom.playheadBarContent);
    }, {passive: true});

    // Mouse/Touch: playhead drag end
    document.addEventListener('mouseup', function() { phDragging = false; });
    document.addEventListener('touchend', function() { phDragging = false; });

    // Click on playhead bar to seek
    if (dom.playheadBarContent) {
      dom.playheadBarContent.addEventListener('click', function(e) {
        seekFromClientX(e.clientX, dom.playheadBarContent);
      });
      // Touch tap to seek on playhead bar
      dom.playheadBarContent.addEventListener('touchstart', function(e) {
        if (!dom.video.src) return;
        seekFromClientX(e.touches[0].clientX, dom.playheadBarContent);
      }, {passive: true});
    }

    // Click on video track to seek
    if (dom.videoTrackContent) {
      dom.videoTrackContent.addEventListener('click', function(e) {
        seekFromClientX(e.clientX, dom.videoTrackContent);
      });
      // Touch tap to seek on video track
      dom.videoTrackContent.addEventListener('touchstart', function(e) {
        if (!dom.video.src) return;
        seekFromClientX(e.touches[0].clientX, dom.videoTrackContent);
      }, {passive: true});
    }

    // CSV track dragging (mouse)
    if (dom.csvTrack) {
      dom.csvTrack.addEventListener('mousedown', function(e) {
        if (e.target.closest('.ve-trim-scissors')) return;
        if (e.target === dom.trimLeft) {
          state.dragging = 'trimLeft';
          state.dragStartTrimStart = state.csvTrimStart;
        } else if (e.target === dom.trimRight) {
          state.dragging = 'trimRight';
          state.dragStartTrimEnd = state.csvTrimEnd;
        } else {
          state.dragging = 'csv';
          state._frozenPps = getPxPerSecond();
        }
        state.dragStartX = e.clientX;
        state.dragStartOffset = state.timeOffset;
        e.preventDefault();
      });
      // CSV track dragging (touch)
      dom.csvTrack.addEventListener('touchstart', function(e) {
        if (e.target.closest('.ve-trim-scissors')) return;
        var touch = e.touches[0];
        if (e.target === dom.trimLeft) {
          state.dragging = 'trimLeft';
          state.dragStartTrimStart = state.csvTrimStart;
        } else if (e.target === dom.trimRight) {
          state.dragging = 'trimRight';
          state.dragStartTrimEnd = state.csvTrimEnd;
        } else {
          state.dragging = 'csv';
          state._frozenPps = getPxPerSecond();
        }
        state.dragStartX = touch.clientX;
        state.dragStartOffset = state.timeOffset;
        e.preventDefault();
      }, {passive: false});
    }

    // VBO track dragging (mouse)
    var vboTrackEl = document.getElementById('vboTrack');
    if (vboTrackEl) {
      vboTrackEl.addEventListener('mousedown', function(e) {
        if (e.target.closest('.ve-trim-scissors')) return;
        if (e.target === dom.vboTrimLeft) {
          state.dragging = 'vboTrimLeft';
          state.dragStartVboTrimStart = state.vboTrimStart;
        } else if (e.target === dom.vboTrimRight) {
          state.dragging = 'vboTrimRight';
          state.dragStartVboTrimEnd = state.vboTrimEnd;
        } else {
          state.dragging = 'vbo';
          state._frozenPps = getPxPerSecond();
        }
        state.dragStartX = e.clientX;
        state.dragStartVboOffset = state.vboTimeOffset;
        e.preventDefault();
      });
      // VBO track dragging (touch)
      vboTrackEl.addEventListener('touchstart', function(e) {
        if (e.target.closest('.ve-trim-scissors')) return;
        var touch = e.touches[0];
        if (e.target === dom.vboTrimLeft) {
          state.dragging = 'vboTrimLeft';
          state.dragStartVboTrimStart = state.vboTrimStart;
        } else if (e.target === dom.vboTrimRight) {
          state.dragging = 'vboTrimRight';
          state.dragStartVboTrimEnd = state.vboTrimEnd;
        } else {
          state.dragging = 'vbo';
          state._frozenPps = getPxPerSecond();
        }
        state.dragStartX = touch.clientX;
        state.dragStartVboOffset = state.vboTimeOffset;
        e.preventDefault();
      }, {passive: false});
    }

    // Global drag move (mouse + touch)
    document.addEventListener('mousemove', function(e) {
      handleTrackDragMove(e.clientX);
    });
    document.addEventListener('touchmove', function(e) {
      if (state.dragging) {
        e.preventDefault();
        handleTrackDragMove(e.touches[0].clientX);
      }
    }, {passive: false});

    // Global drag end (mouse + touch)
    document.addEventListener('mouseup', handleTrackDragEnd);
    document.addEventListener('touchend', handleTrackDragEnd);
  }

  function drawRuler() {
    if (!dom.rulerCanvas) return;
    var canvas = dom.rulerCanvas;
    var parentEl = canvas.parentElement;
    var viewportW = parentEl.clientWidth;
    var totalW = viewportW * state.zoomLevel;
    var scrollLeft = parentEl.scrollLeft || 0;
    var dpr = window.devicePixelRatio || 1;

    // Canvas covers only the visible viewport + buffer (avoids Chrome max canvas limit)
    var drawW = Math.min(totalW, viewportW + 200);
    canvas.width = drawW * dpr;
    canvas.height = 24 * dpr;
    canvas.style.width = drawW + 'px';
    canvas.style.height = '24px';
    canvas.style.position = 'absolute';
    canvas.style.left = scrollLeft + 'px';
    // Spacer div to maintain scrollable width
    if (!parentEl._spacer) {
      parentEl._spacer = document.createElement('div');
      parentEl._spacer.style.cssText = 'height:1px;pointer-events:none;position:absolute;top:0;left:0;';
      parentEl.appendChild(parentEl._spacer);
    }
    parentEl._spacer.style.width = totalW + 'px';

    var ctx = dom.rulerCtx;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, drawW, 24);

    var dur = getTimelineDuration();
    if (dur <= 0) return;

    var pxPerSec = totalW / dur;
    var tickSec = 1;
    ctx.font = '10px sans-serif';
    var sampleLabel = dur >= 3600 ? '00:00:00' : '00:00';
    var labelW = ctx.measureText(sampleLabel).width + 16;
    var minGap = Math.max(labelW, 50);
    var cands = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    for (var ci = 0; ci < cands.length; ci++) {
      tickSec = cands[ci];
      if (cands[ci] * pxPerSec >= minGap) break;
    }

    var useShort = dur < 3600;
    ctx.fillStyle = '#8e959e';
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1;

    // Only draw ticks in visible scroll window
    var tStart = Math.max(0, Math.floor((scrollLeft / totalW) * dur / tickSec) - 1) * tickSec;
    var tEnd = Math.min(dur, Math.ceil(((scrollLeft + drawW) / totalW) * dur / tickSec) + 1) * tickSec;

    for (var t = tStart; t <= tEnd; t += tickSec) {
      var x = (t / dur) * totalW - scrollLeft;
      ctx.beginPath();
      ctx.moveTo(x, 16);
      ctx.lineTo(x, 24);
      ctx.stroke();
      if (x >= 4) {
        var label = useShort ? formatTimeShort(t) : formatTime(t);
        ctx.fillText(label, x + 2, 14);
      }
    }
  }

  function updateTimeDisplay() {
    if (state.noVideoMode) {
      var d = getNoVideoDuration();
      // Clamp playback time to CSV duration
      if (state.playbackTime > d) state.playbackTime = d;
      if (state.playbackTime < 0) state.playbackTime = 0;
      var t = state.playbackTime;
      if (dom.currentTime) dom.currentTime.textContent = formatTime(t);
      if (dom.totalTime) dom.totalTime.textContent = formatTime(d);
      if (dom.seekBar) dom.seekBar.value = d > 0 ? Math.round((t / d) * 1000) : 0;
    }
  }

  function updatePlaybackCursor() {
    if (state.noVideoMode) {
      var dur = getTimelineDuration();
      if (dur <= 0) return;
      var pxPerSec = getPxPerSecond();
      var px = (state.playbackTime + state.timelineOrigin) * pxPerSec;
      if (dom.playheadRuler) dom.playheadRuler.style.left = px + 'px';
      updatePlayheadLine();
    }
  }

  function updatePlayheads() {
    if (!state.noVideoMode && !dom.video.src) return;
    var dur = getTimelineDuration();
    if (dur <= 0) return;
    var pxPerSec = getPxPerSecond();
    var ct = state.noVideoMode ? state.playbackTime : dom.video.currentTime;
    var px = (ct + state.timelineOrigin) * pxPerSec;

    if (dom.playheadRuler) dom.playheadRuler.style.left = px + 'px';
    updatePlayheadLine();

    // Auto-scroll timeline to keep playhead visible during playback
    if (state.playing && state.zoomLevel > 1) {
      var rulerEl = document.querySelector('.ve-ruler');
      if (rulerEl) {
        var viewW = rulerEl.clientWidth;
        if (px < rulerEl.scrollLeft || px > rulerEl.scrollLeft + viewW - 50) {
          rulerEl.scrollLeft = px - viewW * 0.3;
        }
      }
    }
  }

  function updatePlayheadLine() {
    if (!dom.playheadLine || !dom.playheadRuler) return;
    var rulerLeft = parseFloat(dom.playheadRuler.style.left) || 0;
    // Use playheadBarContent scroll to stay in sync with the ruler circle
    var phBar = document.getElementById('playheadBarContent');
    var scrollOff = phBar ? phBar.scrollLeft : (dom.videoTrackContent ? dom.videoTrackContent.scrollLeft : 0);
    // Dynamic label width (120px desktop, 50px mobile, 40px small mobile)
    var labelEl = document.querySelector('.ve-track-label');
    var labelW = labelEl ? labelEl.offsetWidth : 120;
    var pos = rulerLeft - scrollOff + labelW;
    // Hide when playhead is outside the visible track area (behind labels or off-screen right)
    var tracksW = dom.playheadLine.parentElement ? dom.playheadLine.parentElement.clientWidth : 9999;
    if (pos < labelW || pos > tracksW) {
      dom.playheadLine.style.display = 'none';
    } else {
      dom.playheadLine.style.display = '';
      dom.playheadLine.style.left = pos + 'px';
    }
  }

  // ===== PLAYBACK =====
  function togglePlay() {
    // No-video mode playback
    if (state.noVideoMode) {
      if (state.isPlaying) {
        stopNoVideoPlayback();
        state.playing = false;
        dom.playIcon.className = 'bi bi-play-fill';
      } else {
        if (state.playbackTime >= getNoVideoDuration()) state.playbackTime = 0;
        startNoVideoPlayback();
        state.playing = true;
        dom.playIcon.className = 'bi bi-pause-fill';
      }
      return;
    }
    if (!dom.video.src) return;
    if (state.playing) {
      dom.video.pause();
      state.playing = false;
      dom.playIcon.className = 'bi bi-play-fill';
      stopRenderLoop();
    } else {
      dom.video.play();
      state.playing = true;
      dom.playIcon.className = 'bi bi-pause-fill';
      startRenderLoop();
    }
  }

  function onTimeUpdate() {
    var t = dom.video.currentTime;
    var d = dom.video.duration || 0;
    dom.currentTime.textContent = formatTime(t);
    dom.seekBar.value = d > 0 ? Math.round((t / d) * 1000) : 0;
    updatePlayheads();
    if (!state.playing) renderOverlayOnce();
  }

  // ===== RENDER LOOP =====
  function startRenderLoop() {
    if (state.animFrameId) return;
    function loop() {
      renderOverlay();
      state.animFrameId = requestAnimationFrame(loop);
    }
    state.animFrameId = requestAnimationFrame(loop);
  }

  function stopRenderLoop() {
    if (state.animFrameId) {
      cancelAnimationFrame(state.animFrameId);
      state.animFrameId = null;
    }
  }

  function renderOverlayOnce() {
    renderOverlay();
  }

  function renderOverlay() {
    if (!dom.ctx) return;
    if (!state.noVideoMode && !dom.video.src) return;
    var ctx = dom.ctx;
    var cw = dom.canvas.width;
    var ch = dom.canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    // Invalidate draggable-element bounds each frame (re-captured only if the element draws)
    state._telemBounds = null;
    state._gaugeBounds = null;
    state._lapBoardBounds = null;

    // Draw video frame or chroma background onto canvas
    if (state.noVideoMode) {
      ctx.fillStyle = state.chromaBgColor;
      ctx.fillRect(0, 0, cw, ch);
    } else {
      ctx.drawImage(dom.video, 0, 0, cw, ch);
    }

    if (state.csvData.length === 0) return;

    // Get data for current time
    var currentTime = state.noVideoMode ? state.playbackTime : dom.video.currentTime;
    var dataPoint = getDataAtTime(currentTime);
    if (!dataPoint) return;

    // Debug overlay (toggled via Elements > Debug Info checkbox)
    if (settings.debug_overlay) {
      ctx.save();
      var dbgSf = cw / 1920;
      var dbgFs = Math.max(16, Math.round(28 * dbgSf));
      var ln = Math.round(dbgFs * 1.4);
      ctx.font = 'bold ' + dbgFs + 'px monospace';

      // Find nearest non-zero speed when current speed is ~0
      var nnzInfo = '';
      if (dataPoint.speed < 0.5 && state.csvData.length > 0) {
        var _si = dataPoint._dbgLo || 0;
        for (var _di = _si; _di < Math.min(_si + 500, state.csvData.length); _di++) {
          if (state.csvData[_di].speed > 0.5) {
            nnzInfo = 'nextSpd>0 @t=' + state.csvData[_di].t.toFixed(1) + 's idx=' + _di + ' v=' + state.csvData[_di].speed.toFixed(1);
            break;
          }
        }
        if (!nnzInfo) nnzInfo = 'no speed>0 in next 500pts';
      }

      // Собираем строки дебага в массив (число строк зависит от наличия VBO)
      var dbgLines = [
        'videoTime=' + dom.video.currentTime.toFixed(2) + '  timeOffset=' + state.timeOffset.toFixed(2) + '  csvTime=' + (dom.video.currentTime - state.timeOffset).toFixed(2),
        'speed=' + dataPoint.speed.toFixed(1) + '  pwm=' + dataPoint.pwm.toFixed(1) + '  t=' + dataPoint.t.toFixed(2) + '  csvDur=' + state.csvDuration.toFixed(1),
        'idx=' + (dataPoint._dbgLo || 0) + '/' + (dataPoint._dbgTotal || 0) + '  lo.spd=' + (dataPoint._dbgLoSpeed != null ? dataPoint._dbgLoSpeed.toFixed(1) : '?') + '  hi.spd=' + (dataPoint._dbgHiSpeed != null ? dataPoint._dbgHiSpeed.toFixed(1) : '?'),
        'trimS=' + state.csvTrimStart.toFixed(1) + ' trimE=' + state.csvTrimEnd.toFixed(1) + ' zoom=' + state.zoomLevel.toFixed(2) + '  ' + nnzInfo
      ];

      // Диагностика VBO (Dragy) — добавляется только если трек загружен
      if (state.vboData && state.vboData.length > 0) {
        var vboT = dataPoint.t - state.vboTimeOffset + state.timeOffset;
        var vboIn = (vboT >= state.vboTrimStart && vboT <= state.vboTrimEnd);
        var dragyNow = getDragySpeedAtTime(dataPoint.t);
        dbgLines.push('VBO pts=' + state.vboData.length + ' dur=' + state.vboDuration.toFixed(1) + ' off=' + state.vboTimeOffset.toFixed(2) + ' trim=' + state.vboTrimStart.toFixed(1) + '-' + state.vboTrimEnd.toFixed(1));
        dbgLines.push('VBO vboT=' + vboT.toFixed(2) + ' ' + (vboIn ? 'inRange' : 'OUT-OF-RANGE') + ' dragy=' + dragyNow.toFixed(1) + ' ' + LOC.units.speed);
      }

      // Блок по вертикальному ЦЕНТРУ экрана, чтобы не перекрывать спидометр внизу
      var dbgN = dbgLines.length;
      var dbgBgH = ln * dbgN + 4;
      var dbY = Math.round(ch / 2 - dbgBgH / 2 + dbgFs);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, dbY - dbgFs, cw, dbgBgH);
      ctx.fillStyle = '#ffff00';
      for (var _dl = 0; _dl < dbgN; _dl++) {
        ctx.fillText(dbgLines[_dl], 8, dbY + ln * _dl);
      }
      ctx.restore();
    }

    // Draw telemetry boxes
    drawTelemetryBoxes(ctx, cw, ch, dataPoint, true);

    // Draw speed indicator
    if (settings.show_bottom_elements) {
      drawSpeedGauge(ctx, cw, ch, dataPoint.speed, true);
    }

    // Draw VBO track minimap (+ moving rider dot)
    drawTrackMap(ctx, cw, ch, dataPoint, true);
    drawLapTimer(ctx, cw, ch, dataPoint, true);

    // Drag highlight for telemetry / gauge
    var od = state.overlayDrag;
    if (od && od.type === 'telem' && state._telemBounds) {
      var tb = state._telemBounds;
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]); ctx.strokeRect(tb.x - 3, tb.y - 3, tb.w + 6, tb.h + 6); ctx.restore();
    } else if (od && od.type === 'gauge' && state._gaugeBounds) {
      var gb = state._gaugeBounds;
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.arc(gb.cx, gb.cy, gb.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
  }

  // ===== DATA INTERPOLATION =====
  function getDataAtTime(videoTime) {
    var csvTime = videoTime - state.timeOffset;
    if (csvTime < state.csvTrimStart || csvTime > state.csvTrimEnd) return null;
    if (state.csvData.length === 0) return null;

    // Binary search for nearest two points
    var data = state.csvData;
    var lo = 0, hi = data.length - 1;
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (data[mid].t < csvTime) lo = mid;
      else hi = mid;
    }

    var result;
    if (csvTime <= data[lo].t) {
      result = clonePoint(data[lo]);
    } else if (csvTime >= data[hi].t) {
      result = clonePoint(data[hi]);
    } else {
      // Linear interpolation. Округляем результат до int per-frame — ровно как классика
      // (find_nearest_values: int(round(v0 + factor*(v1-v0)))). timestamp оставляем float.
      var factor = (csvTime - data[lo].t) / (data[hi].t - data[lo].t);
      result = {
        t: csvTime,
        speed: Math.round(lerp(data[lo].speed, data[hi].speed, factor)),
        maxSpeed: Math.max(data[lo].maxSpeed, data[hi].maxSpeed),
        voltage: Math.round(lerp(data[lo].voltage, data[hi].voltage, factor)),
        temperature: Math.round(lerp(data[lo].temperature, data[hi].temperature, factor)),
        current: Math.round(lerp(data[lo].current, data[hi].current, factor)),
        battery: Math.round(lerp(data[lo].battery, data[hi].battery, factor)),
        mileage: Math.round(lerp(data[lo].mileage, data[hi].mileage, factor)),
        pwm: Math.round(lerp(data[lo].pwm, data[hi].pwm, factor)),
        power: Math.round(lerp(data[lo].power, data[hi].power, factor)),
        gps: Math.round(lerp(data[lo].gps, data[hi].gps, factor)),
        timestamp: lerp(data[lo].timestamp, data[hi].timestamp, factor),
      };
    }
    // Attach debug info
    result._dbgLo = lo;
    result._dbgHi = hi;
    result._dbgTotal = data.length;
    result._dbgLoSpeed = data[lo].speed;
    result._dbgHiSpeed = data[hi].speed;
    return result;
  }

  function clonePoint(p) {
    return { t: p.t, speed: p.speed, maxSpeed: p.maxSpeed, voltage: p.voltage,
      temperature: p.temperature, current: p.current, battery: p.battery,
      mileage: p.mileage, pwm: p.pwm, power: p.power, gps: p.gps, timestamp: p.timestamp };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  // ===== STATIC BOX WIDTHS CACHE =====
  var _staticBoxWidths = null;

  function recalcStaticBoxWidths(overrideWidth) {
    if (!settings.static_box_size || !state.csvData || state.csvData.length === 0) {
      _staticBoxWidths = null;
      return;
    }
    var measure = document.createElement('canvas').getContext('2d');
    var sf = (overrideWidth || (dom.canvas ? dom.canvas.width : 1920)) / 1920;
    var fontSize = settings.font_size * sf;
    var normalFont = fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    var boldFont = 'bold ' + normalFont;
    var iconSize = settings.use_icons ? Math.round(fontSize * 0.8) : 0;
    var iconSpacing = settings.use_icons ? 8 * sf : 0;

    var maxVals = { speed: 0, maxSpeed: 0, gps: 0, voltage: 0, temperature: 0,
                    battery: 0, mileage: 0, pwm: 0, power: 0, current: 0 };
    state.csvData.forEach(function(d) {
      maxVals.speed = Math.max(maxVals.speed, Math.abs(d.speed || 0));
      maxVals.maxSpeed = Math.max(maxVals.maxSpeed, Math.abs(d.maxSpeed || 0));
      maxVals.gps = Math.max(maxVals.gps, Math.abs(d.gps || 0));
      maxVals.voltage = Math.max(maxVals.voltage, Math.abs(d.voltage || 0));
      maxVals.temperature = Math.max(maxVals.temperature, Math.abs(d.temperature || 0));
      maxVals.battery = Math.max(maxVals.battery, Math.abs(d.battery || 0));
      maxVals.mileage = Math.max(maxVals.mileage, Math.abs(d.mileage || 0));
      maxVals.pwm = Math.max(maxVals.pwm, Math.abs(d.pwm || 0));
      maxVals.power = Math.max(maxVals.power, Math.abs(d.power || 0));
      maxVals.current = Math.max(maxVals.current, Math.abs(d.current || 0));
    });

    var paramDefs = [
      { key: 'speed', label: LOC.speed, unit: LOC.units.speed, maxVal: maxVals.speed, round: true, cap3: true },
      { key: 'max_speed', label: LOC.max_speed, unit: LOC.units.speed, maxVal: maxVals.maxSpeed, round: true, cap3: true },
      { key: 'gps', label: LOC.gps, unit: LOC.units.speed, maxVal: maxVals.gps, round: true, cap3: true },
      { key: 'voltage', label: LOC.voltage, unit: LOC.units.voltage, maxVal: maxVals.voltage, round: true },
      { key: 'temperature', label: LOC.temp, unit: LOC.units.temp, maxVal: maxVals.temperature, round: true, cap3: true },
      { key: 'battery', label: LOC.battery, unit: LOC.units.battery, maxVal: maxVals.battery, round: true, cap3: true },
      { key: 'mileage', label: LOC.mileage, unit: LOC.units.mileage, maxVal: maxVals.mileage, round: true },
      { key: 'pwm', label: LOC.pwm, unit: LOC.units.pwm, maxVal: maxVals.pwm, round: true, cap3: true },
      { key: 'power', label: LOC.power, unit: LOC.units.power, maxVal: maxVals.power, round: true },
      { key: 'current', label: LOC.current, unit: LOC.units.current, maxVal: maxVals.current, round: true },
    ];

    _staticBoxWidths = {};
    paramDefs.forEach(function(pd) {
      var maxStr = pd.round ? Math.round(pd.maxVal) + '' : pd.maxVal.toFixed(1);
      if (pd.cap3) {
        // Cap integer part to 3 digits
        var intStr = Math.round(pd.maxVal) + '';
        if (intStr.length > 3) intStr = intStr.substring(0, 3);
        maxStr = pd.round ? intStr : intStr + '.0';
      }
      // Replace digits with '0' to get max-width test string (preserves dots, minus)
      var testVal = maxStr.replace(/\d/g, '0');
      if (testVal.length < 1) testVal = '0';

      measure.font = boldFont;
      var valueW = measure.measureText(testVal).width;
      measure.font = normalFont;
      var labelW = settings.use_icons ? 0 : measure.measureText(pd.label + ': ').width;
      var unitW = measure.measureText(' ' + pd.unit).width;
      _staticBoxWidths[pd.key] = (settings.use_icons ? iconSize + iconSpacing : labelW) + valueW + unitW;
    });
    measure.font = boldFont;
    var timeValW = measure.measureText('00:00:00').width;
    measure.font = normalFont;
    var timeLabelW = settings.use_icons ? 0 : measure.measureText(LOC.time + ': ').width;
    _staticBoxWidths['time'] = (settings.use_icons ? iconSize + iconSpacing : timeLabelW) + timeValW;
    _staticBoxWidths['dragy_speed'] = _staticBoxWidths['speed'];
  }


  // ===== TELEMETRY BOX RENDERING =====
  function drawTelemetryBoxes(ctx, cw, ch, dp, isPreview) {
    // Scale factor: settings are in design units, backend always renders at 4K (3840x2160)
    var sf = cw / 1920;
    var fontSize = settings.font_size * sf;
    var topPad = settings.top_padding * sf;
    var boxH = Math.max(10, settings.bottom_padding) * sf;
    var spacing = settings.spacing * sf;
    var radius = settings.border_radius * sf;
    var vertPos = settings.vertical_position;
    var horizPos = settings.horizontal_position;

    var font = fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    var boldFont = 'bold ' + font;
    ctx.font = font;

    // Build params array
    var params = [];
    if (settings.show_speed) params.push({ label: LOC.speed, value: Math.round(dp.speed) + '', unit: LOC.units.speed, key: 'pwm_check_no', staticKey: 'speed' });
    if (settings.show_max_speed) params.push({ label: LOC.max_speed, value: Math.round(dp.maxSpeed) + '', unit: LOC.units.speed, staticKey: 'max_speed' });
    if (settings.show_gps) params.push({ label: LOC.gps, value: Math.round(dp.gps) + '', unit: LOC.units.speed, staticKey: 'gps' });
    if (settings.show_voltage) params.push({ label: LOC.voltage, value: Math.round(dp.voltage) + '', unit: LOC.units.voltage, staticKey: 'voltage' });
    if (settings.show_temp) params.push({ label: LOC.temp, value: Math.round(dp.temperature) + '', unit: LOC.units.temp, staticKey: 'temperature' });
    if (settings.show_battery) params.push({ label: LOC.battery, value: Math.round(dp.battery) + '', unit: LOC.units.battery, isBattery: true, staticKey: 'battery' });
    if (settings.show_mileage) params.push({ label: LOC.mileage, value: Math.round(dp.mileage) + '', unit: LOC.units.mileage, staticKey: 'mileage' });
    if (settings.show_pwm) params.push({ label: LOC.pwm, value: Math.round(dp.pwm) + '', unit: LOC.units.pwm, isPWM: true, staticKey: 'pwm' });
    if (settings.show_power) params.push({ label: LOC.power, value: Math.round(dp.power) + '', unit: LOC.units.power, staticKey: 'power' });
    if (settings.show_current) params.push({ label: LOC.current, value: Math.round(dp.current) + '', unit: LOC.units.current, staticKey: 'current' });
    if (settings.show_time) {
      var d = new Date(dp.timestamp * 1000);
      var ts = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
      params.push({ label: LOC.time, value: ts, unit: '', staticKey: 'time' });
    }
    if (settings.show_dragy_speed && state.vboData) {
      var dragySpeed = getDragySpeedAtTime(dp.t);
      params.push({ label: LOC.dragy_speed, value: Math.round(dragySpeed) + '', unit: LOC.units.speed, staticKey: 'dragy_speed' });
    }

    if (params.length === 0) return;

    // Measure each box
    var iconSize = settings.use_icons ? Math.round(fontSize * 0.8) : 0;
    var iconSpacing = settings.use_icons ? 8 * sf : 0;
    var boxes = [];

    params.forEach(function(p) {
      ctx.font = font;
      var labelW = settings.use_icons ? 0 : ctx.measureText(p.label + ': ').width;
      ctx.font = boldFont;
      var valueW = ctx.measureText(p.value).width;
      ctx.font = font;
      var unitW = ctx.measureText(' ' + p.unit).width;
      var dynamicTextW = (settings.use_icons ? iconSize + iconSpacing : labelW) + valueW + unitW;
      var textW = dynamicTextW;
      if (settings.static_box_size && _staticBoxWidths && p.staticKey && _staticBoxWidths[p.staticKey]) {
        textW = Math.max(dynamicTextW, _staticBoxWidths[p.staticKey]);
      }
      var boxW = textW + 2 * topPad;
      boxes.push({ param: p, textW: textW, boxW: boxW });
    });

    // Position boxes
    var yPos, xPos;

    if (settings.vertical_layout) {
      var totalH = params.length * boxH + (params.length - 1) * spacing;
      var maxBoxW = 0;
      boxes.forEach(function(b) { if (b.boxW > maxBoxW) maxBoxW = b.boxW; });
      yPos = (ch * vertPos / 100) - totalH / 2;
      xPos = (cw * horizPos / 100);

      boxes.forEach(function(b, i) {
        var by = yPos + i * (boxH + spacing);
        drawSingleBox(ctx, xPos, by, b.boxW, boxH, radius, b.param, b.textW, topPad, fontSize, sf, iconSize, iconSpacing, boldFont, font);
      });
      if (isPreview) state._telemBounds = { x: xPos, y: yPos, w: maxBoxW, h: totalH };
    } else {
      var totalW = 0;
      boxes.forEach(function(b) { totalW += b.boxW; });
      totalW += (boxes.length - 1) * spacing;
      // horizontal_position = row CENTRE as % of width (50 → centred, fully back-compatible)
      xPos = (cw * horizPos / 100) - totalW / 2;
      yPos = ch * vertPos / 100;
      var x0 = xPos;

      boxes.forEach(function(b) {
        drawSingleBox(ctx, xPos, yPos, b.boxW, boxH, radius, b.param, b.textW, topPad, fontSize, sf, iconSize, iconSpacing, boldFont, font);
        xPos += b.boxW + spacing;
      });
      if (isPreview) state._telemBounds = { x: x0, y: yPos, w: totalW, h: boxH };
    }
  }

  function drawSingleBox(ctx, x, y, w, h, radius, param, textW, topPad, fontSize, sf, iconSize, iconSpacing, boldFont, normalFont) {
    // Determine box color
    var boxAlpha = (settings.box_opacity / 100).toFixed(2);
    var boxColor = 'rgba(0,0,0,' + boxAlpha + ')';
    var textColor = '#ffffff';

    if (param.isPWM) {
      var pwm = parseInt(param.value);
      if (pwm > 90) { boxColor = 'rgba(255,0,0,' + boxAlpha + ')'; textColor = '#000000'; }
      else if (pwm >= 80) { boxColor = 'rgba(255,255,0,' + boxAlpha + ')'; textColor = '#000000'; }
    }
    if (param.isBattery) {
      var bat = parseInt(param.value);
      if (bat < 10) { boxColor = 'rgba(255,0,0,' + boxAlpha + ')'; textColor = '#000000'; }
      else if (bat <= 30) { boxColor = 'rgba(255,255,0,' + boxAlpha + ')'; textColor = '#000000'; }
    }

    // Draw rounded rectangle
    ctx.fillStyle = boxColor;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();

    // Draw text
    var textX = x + topPad;
    var textVOffset = (settings.text_vertical_offset || 0) * sf;
    var textY = y + h / 2 + fontSize * 0.35 + textVOffset;

    ctx.fillStyle = textColor;

    if (settings.use_icons) {
      // Иконку перекрашиваем в цвет текста (белый, либо чёрный для красных/жёлтых
      // боксов) — как в классике (image_generator.load_icon инвертирует чёрный PNG).
      // Никакого кружка-плейсхолдера: рисуем только саму иконку.
      var iconY = y + (h - iconSize) / 2 + textVOffset;
      var iconName = LABEL_TO_ICON[param.label];
      if (iconName) {
        var tintedIcon = getTintedIcon(iconName, textColor);
        if (tintedIcon) {
          ctx.drawImage(tintedIcon, textX, iconY, iconSize, iconSize);
        }
      }

      textX += iconSize + iconSpacing;
      ctx.fillStyle = textColor;
      ctx.font = boldFont;
      ctx.fillText(param.value, textX, textY);
      var vw = ctx.measureText(param.value).width;
      ctx.font = normalFont;
      ctx.fillText(' ' + param.unit, textX + vw, textY);
    } else {
      ctx.font = normalFont;
      var labelText = param.label + ': ';
      ctx.fillText(labelText, textX, textY);
      var lw = ctx.measureText(labelText).width;
      ctx.font = boldFont;
      ctx.fillText(param.value, textX + lw, textY);
      var vw2 = ctx.measureText(param.value).width;
      ctx.font = normalFont;
      ctx.fillText(' ' + param.unit, textX + lw + vw2, textY);
    }
  }

  function loadIconImage(name) {
    if (state.iconImages[name] !== undefined) return; // уже грузится/загружена/ошибка
    state.iconImages[name] = null; // null = загрузка в процессе
    var img = new Image();
    img.onload = function() {
      state.iconImages[name] = img;
      if (!state.playing) renderOverlayOnce(); // иконка пришла асинхронно — обновим превью
    };
    img.onerror = function() {
      state.iconImages[name] = false; // больше не пытаемся грузить
    };
    img.src = '/static/icons/icons_telemetry/' + name + '.png';
  }

  // Возвращает иконку, перекрашенную в нужный цвет (аналог load_icon в классике),
  // с кэшированием. PNG-иконки — чёрные силуэты на прозрачном фоне; через
  // composite 'source-in' заливаем форму цветом текста (белым на обычном боксе,
  // чёрным на красном/жёлтом). Пока сырой PNG не загружен — возвращаем null.
  function getTintedIcon(name, color) {
    var raw = state.iconImages[name];
    if (raw === undefined) { loadIconImage(name); return null; }
    if (!raw) return null; // null (грузится) или false (ошибка)
    var key = name + '|' + color;
    var cached = state.iconTintCache[key];
    if (cached) return cached;
    var w = raw.naturalWidth || 64, h = raw.naturalHeight || 64;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var cx = c.getContext('2d');
    cx.drawImage(raw, 0, 0, w, h);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = color;
    cx.fillRect(0, 0, w, h);
    state.iconTintCache[key] = c;
    return c;
  }

  // Предзагрузка всех иконок телеметрии, чтобы они были готовы к экспорту
  // (Local Export кодирует кадры сразу, без ожидания сети).
  function preloadIcons() {
    Object.keys(LABEL_TO_ICON).forEach(function(label) {
      var n = LABEL_TO_ICON[label];
      if (n) loadIconImage(n);
    });
  }

  // ===== SPEED GAUGE =====
  function drawSpeedGauge(ctx, cw, ch, speed, isPreview) {
    var sf = cw / 1920;
    var baseSize = 250 * sf * (settings.indicator_scale / 100);
    var centerX = cw * settings.indicator_x / 100;
    var centerY = ch * settings.indicator_y / 100;
    var radius = baseSize / 2 - 10 * sf;
    if (isPreview) state._gaugeBounds = { cx: centerX, cy: centerY, r: Math.max(20, baseSize / 2) };
    var arcWidth = 10 * sf * (settings.indicator_scale / 100);

    // Background arc (dark)
    ctx.strokeStyle = 'rgba(60,60,60,0.5)';
    ctx.lineWidth = arcWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, degToRad(150), degToRad(390));
    ctx.stroke();

    // Speed color interpolation
    var color;
    if (speed < 70) {
      var f = speed / 70;
      color = lerpColor([0, 255, 0], [255, 255, 0], f);
    } else if (speed < 85) {
      var f2 = (speed - 70) / 15;
      color = lerpColor([255, 255, 0], [255, 0, 0], f2);
    } else {
      color = [255, 0, 0];
    }

    // Active arc
    var startAngle = 150;
    var endAngle = 390;
    var currentAngle = startAngle + (endAngle - startAngle) * (Math.min(speed, 100) / 100);

    ctx.strokeStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
    ctx.lineWidth = arcWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, degToRad(startAngle), degToRad(currentAngle));
    ctx.stroke();

    // Speed number
    var speedFontSize = baseSize / 4 * (settings.speed_size / 100);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + speedFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(speed) + '', centerX, centerY + settings.speed_y * sf);

    // KM/H label
    var unitFontSize = baseSize / 8 * (settings.unit_size / 100);
    ctx.font = unitFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('KM/H', centerX, centerY + speedFontSize * 0.5 + unitFontSize * 0.5 + settings.unit_y * sf);

    // Reset text alignment
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function lerpColor(c1, c2, t) {
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * t),
      Math.round(c1[1] + (c2[1] - c1[1]) * t),
      Math.round(c1[2] + (c2[2] - c1[2]) * t),
    ];
  }

  function degToRad(deg) { return deg * Math.PI / 180; }

  // ===== SCROLL SYNC =====
  function syncTimelineScroll() {
    // Sync horizontal scroll between ruler and all track-content elements
    var rulerEl = document.querySelector('.ve-ruler');
    var phBarEl = document.getElementById('playheadBarContent');
    var scrollables = [rulerEl, phBarEl, dom.videoTrackContent, dom.csvTrackContent, dom.vboTrackContent].filter(Boolean);
    var syncing = false;
    scrollables.forEach(function(el) {
      el.addEventListener('scroll', function() {
        if (syncing) return;
        syncing = true;
        var left = el.scrollLeft;
        scrollables.forEach(function(other) {
          if (other !== el) other.scrollLeft = left;
        });
        // Update playhead line position on scroll
        updatePlayheadLine();
        updateTrimArrows();
        // Redraw canvases at new scroll position (virtual scrolling)
        drawRuler();
        renderWaveform();
        renderVBOWaveform();
        syncing = false;
      });
    });
  }

  // ===== RESIZE =====
  function resizeCanvases() {
    if (!dom.canvas || !dom.previewContainer) return;
    var container = dom.previewContainer;
    var vw = state.videoMeta.width || 1920;
    var vh = state.videoMeta.height || 1080;
    var aspect = vw / vh;
    var cw = container.clientWidth;
    var ch = container.clientHeight;

    // Fit video maintaining aspect ratio
    var displayW, displayH;
    if (cw / ch > aspect) {
      displayH = ch;
      displayW = ch * aspect;
    } else {
      displayW = cw;
      displayH = cw / aspect;
    }

    dom.video.style.width = displayW + 'px';
    dom.video.style.height = displayH + 'px';
    dom.canvas.width = displayW;
    dom.canvas.height = displayH;
    dom.canvas.style.width = displayW + 'px';
    dom.canvas.style.height = displayH + 'px';

    // Center video and canvas
    var ox = (cw - displayW) / 2;
    var oy = (ch - displayH) / 2;
    dom.video.style.position = 'absolute';
    dom.video.style.left = ox + 'px';
    dom.video.style.top = oy + 'px';
    dom.canvas.style.position = 'absolute';
    dom.canvas.style.left = ox + 'px';
    dom.canvas.style.top = oy + 'px';

    renderOverlayOnce();
    drawRuler();
    if (state.csvData.length > 0) renderWaveform();
  }

  // ===== EXPORT =====
  function checkExportReady() {
    // Server export: needs video uploaded + CSV processed on server
    var serverReady = (state.videoUploaded || state.noVideoMode) && state.csvId;
    if (dom.btnExport) dom.btnExport.disabled = !serverReady;
    // Local export: just needs video file + CSV data in browser
    var localBtn = document.getElementById('btnLocalExport');
    if (localBtn) {
      var localReady = (state.videoFile || state.noVideoMode) && state.csvData && state.csvData.length > 0;
      localBtn.disabled = !localReady;
    }
  }

  function generateProjectName() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var id = '';
    for (var i = 0; i < 7; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    return 'VE-' + id;
  }

  function startExport() {
    if (!state.noVideoMode && (!state.videoUploaded || !state.videoId)) {
      alert('Video is still uploading to the server. Please wait or use Local Export (Browser).');
      return;
    }
    if (!state.csvId && !state.csvFile) {
      alert('CSV not uploaded to server yet.');
      return;
    }

    // Переотправляем CSV/VBO на сервер перед серверным экспортом. Автоочистка
    // uploads/video_editor (файлы >24ч) могла их удалить, если редактор был открыт
    // дольше суток — иначе экспорт падает с 'CSV file not found'. Файлы крошечные,
    // оригиналы есть в браузере (state.csvFile / state.vboFile).
    var reuploads = [];
    if (state.csvFile) reuploads.push(uploadCSVToServer(state.csvFile));
    if (state.vboFile) reuploads.push(uploadVBOToServer(state.vboFile));
    Promise.all(reuploads).then(function() {
      _sendExportRequest();
    }).catch(function(err) {
      alert('Не удалось подготовить данные на сервере: ' + ((err && err.message) || err) + '. Попробуйте ещё раз.');
    });
  }

  function _sendExportRequest() {
    var nameInput = document.getElementById('exportProjectName');
    var projectName = nameInput ? nameInput.value.trim() : '';
    if (!projectName) projectName = generateProjectName();

    var interpolateEl = document.getElementById('exportInterpolate');
    var interpolate = interpolateEl ? interpolateEl.checked : true;

    var payload = {
      video_id: state.noVideoMode ? null : state.videoId,
      no_video_mode: state.noVideoMode || false,
      chroma_color: state.chromaBgColor || '#0000FF',
      csv_id: state.csvId,
      project_name: projectName,
      interpolate_values: interpolate,
      time_offset: state.timeOffset - state.csvCropOffset,
      csv_trim_start: state.csvTrimStart + state.csvCropOffset,
      csv_trim_end: state.csvTrimEnd + state.csvCropOffset,
      settings: settings,
      fps: dom.exportFPS.value,
      data_fps: dom.exportDataFPS.value,
      codec: dom.exportCodec.value,
      resolution: dom.exportResolution.value,
      quality: (document.getElementById('exportQuality') || {}).value || 'medium',
      vbo_id: state.vboId || null,
      vbo_time_offset: state.vboTimeOffset - state.vboCropOffset,
      vbo_trim_start: state.vboTrimStart + state.vboCropOffset,
      vbo_trim_end: state.vboTrimEnd + state.vboCropOffset,
      // Start/finish gate as a physical point (lat/lon) so the server reproduces the same laps
      track_gate_lat: (state.trackMapReady && state.vboData && state.vboData[state.trackGateIdx]) ? state.vboData[state.trackGateIdx].lat : null,
      track_gate_lon: (state.trackMapReady && state.vboData && state.vboData[state.trackGateIdx]) ? state.vboData[state.trackGateIdx].lon : null,
    };

    console.log('EXPORT payload:', JSON.stringify({time_offset: payload.time_offset, csv_trim_start: payload.csv_trim_start, csv_trim_end: payload.csv_trim_end, csvCropOffset: state.csvCropOffset, vbo_time_offset: payload.vbo_time_offset, vbo_trim_start: payload.vbo_trim_start, vbo_trim_end: payload.vbo_trim_end, vboCropOffset: state.vboCropOffset, vbo_id: payload.vbo_id}));
    fetch('/video-editor/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    .then(function(r) {
      if (!r.ok) {
        return r.text().then(function(txt) {
          throw new Error('Server error ' + r.status + ': ' + txt.substring(0, 200));
        });
      }
      return r.json();
    })
    .then(function(data) {
      if (data.project_id) {
        showExportProgress(data.project_id, projectName);
      } else {
        alert('Export failed: ' + (data.error || 'Unknown error'));
      }
    })
    .catch(function(err) {
      alert('Export request failed: ' + err.message);
    });
  }

  function showExportProgress(projectId, projectName) {
    // Fill modal with initial data
    var fpsEl = document.getElementById('exportFPS');
    var codecEl = document.getElementById('exportCodec');
    var resEl = document.getElementById('exportResolution');

    document.getElementById('expModalName').textContent = projectName;
    document.getElementById('expModalFps').textContent = fpsEl ? fpsEl.options[fpsEl.selectedIndex].text : '—';
    document.getElementById('expModalCodec').textContent = codecEl ? codecEl.options[codecEl.selectedIndex].text : '—';
    document.getElementById('expModalRes').textContent = resEl ? resEl.options[resEl.selectedIndex].text : '—';
    document.getElementById('expModalProgress').textContent = '0%';
    document.getElementById('expModalBar').style.width = '0%';
    document.getElementById('expModalStatus').innerHTML = '<span class="badge text-bg-warning">Processing 0%</span>';

    // Show modal
    var modal = new bootstrap.Modal(document.getElementById('exportProgressModal'));
    modal.show();

    // Poll progress
    var pollInterval = setInterval(function() {
      fetch('/project_status/' + projectId)
        .then(function(r) { return r.json(); })
        .then(function(st) {
          var pct = (st.progress || 0).toFixed(1);
          var status = st.status || 'processing';

          document.getElementById('expModalProgress').textContent = pct + '%';
          document.getElementById('expModalBar').style.width = pct + '%';

          if (status === 'processing') {
            document.getElementById('expModalStatus').innerHTML = '<span class="badge text-bg-warning">Processing ' + pct + '%</span>';
          } else if (status === 'completed') {
            document.getElementById('expModalStatus').innerHTML = '<span class="badge text-bg-success">Completed</span>';
            document.getElementById('expModalBar').style.background = 'var(--bs-success)';
            document.getElementById('expModalBar').style.width = '100%';
            document.getElementById('expModalProgress').textContent = '100%';
            clearInterval(pollInterval);
          } else if (status === 'error') {
            document.getElementById('expModalStatus').innerHTML = '<span class="badge text-bg-danger">Error</span>';
            document.getElementById('expModalBar').style.background = 'var(--bs-danger)';
            clearInterval(pollInterval);
          }
        })
        .catch(function() {}); // ignore poll errors
    }, 2000);

    // Stop polling when modal closes
    document.getElementById('exportProgressModal').addEventListener('hidden.bs.modal', function() {
      clearInterval(pollInterval);
    }, { once: true });
  }


  // ===== VBO HANDLING =====
  function handleVBOFile(file) {
    state.vboFile = file;
    var reader = new FileReader();
    reader.onload = function(e) {
      parseVBO(e.target.result);
      // Auto-enable dragy speed display
      settings.show_dragy_speed = true;
      var el = document.getElementById('showDragySpeed');
      if (el) el.checked = true;
      renderOverlayOnce();
    };
    reader.readAsText(file);
    uploadVBOToServer(file);
  }

  function uploadVBOToServer(file) {
    var formData = new FormData();
    formData.append('vbo', file);
    return fetch('/video-editor/upload-vbo', { method: 'POST', body: formData })
      .then(function(r) { return r.json(); })
      .then(function(data) { state.vboId = data.vbo_id; return data; })
      .catch(function(err) { console.error('VBO upload failed:', err); throw err; });
  }

  function parseVBO(text) {
    var lines = text.split('\n');
    var inData = false;
    var inHeader = false;
    var velocityIsKmh = false;
    var columns = [];
    var data = [];
    var firstTime = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (line === '[header]') {
        inHeader = true;
        continue;
      }

      if (inHeader && !line.startsWith('[')) {
        if (line.toLowerCase().indexOf('velocity kmh') >= 0 || line.toLowerCase().indexOf('velocity km') >= 0) {
          velocityIsKmh = true;
        }
        continue;
      }

      if (line.startsWith('[') && inHeader) {
        inHeader = false;
      }

      if (line === '[column names]' || line === '[columns]') {
        // Next non-empty line has column names
        i++;
        while (i < lines.length && !lines[i].trim()) i++;
        if (i < lines.length) {
          columns = lines[i].trim().split(/\s+/);
        }
        continue;
      }

      if (line === '[data]') {
        inData = true;
        continue;
      }

      if (line.startsWith('[') && line.endsWith(']')) {
        if (inData) break; // new section after data
        inData = false;
        continue;
      }

      if (!inData || columns.length === 0) continue;

      var parts = line.split(/\s+/);
      if (parts.length < columns.length) continue;

      var row = {};
      for (var j = 0; j < columns.length; j++) {
        row[columns[j].toLowerCase()] = parts[j];
      }

      // Parse time (HHMMSS.SS format)
      var timeStr = row['time'] || row['utc'] || '';
      var timeSec = 0;
      if (timeStr.length >= 6) {
        var hh = parseInt(timeStr.substring(0, 2));
        var mm = parseInt(timeStr.substring(2, 4));
        var ss = parseFloat(timeStr.substring(4));
        timeSec = hh * 3600 + mm * 60 + ss;
      }

      // Parse velocity - check if already in km/h or needs conversion from knots
      var velStr = (row['velocity'] || row['speed'] || '0').replace(',', '.');
      var rawVelocity = parseFloat(velStr);
      var speedKmh = velocityIsKmh ? rawVelocity : rawVelocity * 1.852;

      if (firstTime === null) firstTime = timeSec;

      // GPS lat/long — RaceLogic VBO stores them in MINUTES.
      // deg = minutes / 60. Longitude sign is West-positive → invert for East-positive.
      var latRaw = parseFloat((row['lat'] || row['latitude'] || '').replace(',', '.'));
      var lonRaw = parseFloat((row['long'] || row['longitude'] || row['lon'] || '').replace(',', '.'));
      var headRaw = parseFloat((row['heading'] || '0').replace(',', '.'));

      data.push({
        t: timeSec - firstTime,
        timestamp: timeSec,
        speed: speedKmh,
        lat: isNaN(latRaw) ? null : latRaw / 60,
        lon: isNaN(lonRaw) ? null : -lonRaw / 60,
        heading: isNaN(headRaw) ? 0 : headRaw
      });
    }

    console.log('parseVBO: parsed ' + data.length + ' points');
    if (data.length === 0) { console.warn('parseVBO: no data points!'); return; }

    state.vboData = data;
    state.vboDuration = data[data.length - 1].t;
    state.vboTrimStart = 0;
    state.vboTrimEnd = state.vboDuration;
    buildTrackMap(data);  // project GPS → minimap path + closed-loop detection
    updateTrackMapInteractivity();
    console.log('parseVBO: duration=' + state.vboDuration + 's, showing track...');

    // Show VBO track
    if (dom.vboTrackRow) {
      dom.vboTrackRow.style.display = '';
      var vboTrackEl = document.getElementById('vboTrack');
      if (vboTrackEl) vboTrackEl.style.display = '';
      dom.vboTrackRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      console.log('parseVBO: vboTrackRow shown');
    } else {
      console.error('parseVBO: dom.vboTrackRow is null!');
    }
    refreshTimeline();
    updateVboTrimHandles();
    // Recalc video preview size — timeline height changed
    setTimeout(resizeCanvases, 50);
  }

  function updateVBOTrackPosition() {
    var vboTrackEl = document.getElementById('vboTrack');
    if (!vboTrackEl) return;
    var pxPerSec = getPxPerSecond();
    vboTrackEl.style.left = ((state.vboTimeOffset + state.timelineOrigin) * pxPerSec) + 'px';
    updateTrimArrows();
  }

  function renderVBOWaveform() {
    if (!state.vboData || !dom.vboWaveformCanvas) return;

    var pxPerSec = getPxPerSecond();
    var vboWidthPx = Math.max(1, state.vboDuration * pxPerSec);

    updateVBOTrackPosition();
    var vboTrackEl = document.getElementById('vboTrack');
    if (vboTrackEl) {
      vboTrackEl.style.width = vboWidthPx + 'px';
    }

    var canvas = dom.vboWaveformCanvas;
    var dpr = window.devicePixelRatio || 1;

    // Virtual scrolling: canvas covers only visible portion + buffer
    var parentScroll = dom.vboTrackContent ? dom.vboTrackContent.scrollLeft : 0;
    var viewportW = dom.vboTrackContent ? dom.vboTrackContent.clientWidth : vboWidthPx;
    var trackLeft = parseFloat(vboTrackEl ? vboTrackEl.style.left : '0') || 0;
    var visLeft = parentScroll - trackLeft;
    var visRight = visLeft + viewportW;
    var buffer = viewportW * 0.5;
    var drawLeft, drawRight, drawW;
    var MAX_CANVAS_DIM = 8192;
    // If track fits in max canvas size, render it all (no virtual scrolling artifacts)
    if (vboWidthPx * dpr <= MAX_CANVAS_DIM) {
      drawLeft = 0;
      drawW = vboWidthPx;
    } else {
      drawLeft = Math.max(0, visLeft - buffer);
      drawRight = Math.min(vboWidthPx, visRight + buffer);
      drawW = drawRight - drawLeft;
      if (drawW < 20) drawW = Math.min(vboWidthPx, viewportW + 200);
      if (drawW < 20) drawW = 20;
      if (drawW * dpr > MAX_CANVAS_DIM) drawW = MAX_CANVAS_DIM / dpr;
    }

    canvas.width = Math.ceil(drawW * dpr);
    canvas.height = 50 * dpr;
    canvas.style.width = drawW + 'px';
    canvas.style.height = '50px';
    canvas.style.position = 'absolute';
    canvas.style.left = drawLeft + 'px';
    canvas.style.top = '0';

    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, drawW, 50);

    var h = 50;
    var data = state.vboData;
    var maxVal = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i].speed > maxVal) maxVal = data[i].speed;
    }
    if (maxVal === 0) maxVal = 1;

    function tToX(t) {
      return (t / state.vboDuration) * vboWidthPx - drawLeft;
    }

    var step = Math.max(1, Math.floor(data.length / 4000));

    // Draw speed as filled area (yellow)
    ctx.fillStyle = 'rgba(255, 193, 7, 0.3)';
    ctx.beginPath();
    ctx.moveTo(tToX(data[0].t), h);
    for (var i = 0; i < data.length; i += step) {
      var x = tToX(data[i].t);
      if (x < -10) continue;
      if (x > drawW + 10) { ctx.lineTo(x, h - (data[i].speed / maxVal) * h); break; }
      var y = h - (data[i].speed / maxVal) * h;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(tToX(data[data.length - 1].t), h);
    ctx.closePath();
    ctx.fill();

    // Draw speed line
    ctx.strokeStyle = '#ffc107';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < data.length; i += step) {
      var x = tToX(data[i].t);
      if (x < -10) continue;
      if (x > drawW + 10) { ctx.lineTo(x, h - (data[i].speed / maxVal) * h); break; }
      var y = h - (data[i].speed / maxVal) * h;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Dim trimmed-out regions
    if (state.vboTrimStart > 0 || state.vboTrimEnd < state.vboDuration) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      var trimLeftLocal = (state.vboTrimStart / state.vboDuration) * vboWidthPx - drawLeft;
      var trimRightLocal = (state.vboTrimEnd / state.vboDuration) * vboWidthPx - drawLeft;
      if (trimLeftLocal > 0) ctx.fillRect(0, 0, trimLeftLocal, h);
      if (trimRightLocal < drawW) ctx.fillRect(trimRightLocal, 0, drawW - trimRightLocal, h);
    }

    updateVboTrimHandles();
  }

  function updateVboTrimHandles() {
    if (!dom.vboTrimLeft || !dom.vboTrimRight || state.vboDuration <= 0) return;
    var pxPerSec = getPxPerSecond();
    var vboWidthPx = state.vboDuration * pxPerSec;
    // Local coordinates within VBO track (like CSV updateTrimHandles)
    var leftPx = (state.vboTrimStart / state.vboDuration) * vboWidthPx;
    var rightPx = (state.vboTrimEnd / state.vboDuration) * vboWidthPx;
    dom.vboTrimLeft.style.left = leftPx + 'px';
    dom.vboTrimRight.style.left = (rightPx - 8) + 'px';
    // Left scissors
    if (dom.vboBtnTrimCropLeft) {
      var show = state.trimMode && state.vboTrimStart > 0.1;
      dom.vboBtnTrimCropLeft.classList.toggle('visible', show);
      dom.vboBtnTrimCropLeft.style.left = (leftPx + 12) + 'px';
    }
    // Right scissors
    if (dom.vboBtnTrimCropRight) {
      var show = state.trimMode && state.vboTrimEnd < state.vboDuration - 0.1;
      dom.vboBtnTrimCropRight.classList.toggle('visible', show);
      dom.vboBtnTrimCropRight.style.left = (rightPx - 34) + 'px';
    }
  }

  function getDragySpeedAtTime(t) {
    if (!state.vboData || state.vboData.length === 0) return 0;
    // Adjust for VBO time offset
    var vboT = t - state.vboTimeOffset + state.timeOffset;
    if (vboT < state.vboTrimStart || vboT > state.vboTrimEnd) return 0;
    var data = state.vboData;
    t = vboT;

    // Binary search for nearest point
    var lo = 0, hi = data.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (data[mid].t < t) lo = mid + 1;
      else hi = mid;
    }

    // Interpolate between nearest points
    if (lo === 0) return data[0].speed;
    if (lo >= data.length) return data[data.length - 1].speed;

    var a = data[lo - 1], b = data[lo];
    if (b.t === a.t) return a.speed;
    var frac = (t - a.t) / (b.t - a.t);
    return a.speed + (b.speed - a.speed) * frac;
  }

  // ===== TRACK MINIMAP (from VBO GPS) =====
  // Project all GPS fixes into a normalized, aspect-correct unit square (north up),
  // mutating each VBO point with .mx/.my in [0,1]; build a downsampled static path;
  // auto-detect whether the track is a closed loop (start ≈ finish).
  function buildTrackMap(data) {
    state.trackMapReady = false;
    state.trackMapPath = null;
    state.trackMapCache = null;
    state.trackMapCacheKey = '';
    if (!data || data.length < 2) return;

    // First valid fix = projection origin
    var lat0 = null, lon0 = null;
    for (var i = 0; i < data.length; i++) {
      if (data[i].lat != null && data[i].lon != null) { lat0 = data[i].lat; lon0 = data[i].lon; break; }
    }
    if (lat0 == null) return; // no GPS in this VBO
    var cosLat = Math.cos(lat0 * Math.PI / 180);
    var MPD = 111320; // metres per degree (approx)

    // Equirectangular metres relative to origin + bounding box
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < data.length; i++) {
      var p = data[i];
      if (p.lat == null || p.lon == null) { p._gx = null; continue; }
      var gx = (p.lon - lon0) * cosLat * MPD;
      var gy = (p.lat - lat0) * MPD;
      p._gx = gx; p._gy = gy;
      if (gx < minX) minX = gx; if (gx > maxX) maxX = gx;
      if (gy < minY) minY = gy; if (gy > maxY) maxY = gy;
    }
    var rangeX = Math.max(1e-6, maxX - minX);
    var rangeY = Math.max(1e-6, maxY - minY);
    var scale = 1 / Math.max(rangeX, rangeY);          // larger axis spans full [0,1]
    state.trackMapMetersPerUnit = Math.max(rangeX, rangeY);  // 1 normalized unit = this many metres (for navigator zoom)
    var contentW = rangeX * scale, contentH = rangeY * scale;
    var offX = (1 - contentW) / 2, offY = (1 - contentH) / 2; // centre in unit square

    // Normalised coords on every point (carry last valid forward across GPS gaps)
    var lastMx = 0.5, lastMy = 0.5;
    for (var i = 0; i < data.length; i++) {
      var p = data[i];
      if (p._gx == null) { p.mx = lastMx; p.my = lastMy; continue; }
      var nx = offX + (p._gx - minX) * scale;
      var ny = offY + (p._gy - minY) * scale;
      p.mx = nx;
      p.my = 1 - ny;              // flip Y so north is up on screen
      lastMx = p.mx; lastMy = p.my;
      delete p._gx; delete p._gy;
    }

    // Downsample static path to ~1500 vertices (plenty at minimap scale)
    var maxPts = 1500;
    var step = Math.max(1, Math.floor(data.length / maxPts));
    var path = [];
    for (var i = 0; i < data.length; i += step) path.push({ mx: data[i].mx, my: data[i].my });
    var lp = data[data.length - 1];
    path.push({ mx: lp.mx, my: lp.my });
    state.trackMapPath = path;

    // Closed-loop detection: haversine(first, last) < max(30 m, 5% of bbox diagonal)
    var a = null, b = null;
    for (var i = 0; i < data.length; i++) { if (data[i].lat != null) { a = data[i]; break; } }
    for (var i = data.length - 1; i >= 0; i--) { if (data[i].lat != null) { b = data[i]; break; } }
    var closed = false;
    if (a && b && a !== b) {
      var diagM = Math.sqrt(rangeX * rangeX + rangeY * rangeY);
      var R = 6371000;
      var dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
      var la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
      var hv = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
               Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      var dist = 2 * R * Math.asin(Math.min(1, Math.sqrt(hv)));
      closed = dist < Math.max(30, diagM * 0.05);
    }
    state.trackMapClosed = closed;
    state.trackMapReady = true;
    console.log('buildTrackMap: pts=' + data.length + ' path=' + path.length + ' closed=' + closed);

    // Auto-place the start/finish gate at the most-visited point, then detect laps + average.
    state.trackGateIdx = findAutoGate();
    recomputeLaps();
  }

  // ===== LAP ANALYSIS (start/finish gate → laps → averaged centerline) =====
  var LAP_GATE_T = 0.03;     // gate capture radius in normalized track units (~7m on a 230m track)

  // Distance (normalized units) between two VBO points.
  function vboDist(i, j) {
    var d = state.vboData;
    return Math.sqrt((d[i].mx - d[j].mx) * (d[i].mx - d[j].mx) + (d[i].my - d[j].my) * (d[i].my - d[j].my));
  }

  // Count how many times the path passes within T of point gi (debounced by minLap seconds).
  function countGatePasses(gi, T, minLap) {
    var data = state.vboData, gx = data[gi].mx, gy = data[gi].my;
    var inZone = false, bestD = 9, bestI = -1, last = -9e9, n = 0;
    for (var i = 0; i < data.length; i++) {
      var dx = data[i].mx - gx, dy = data[i].my - gy, d = Math.sqrt(dx * dx + dy * dy);
      if (d < T) { inZone = true; if (d < bestD) { bestD = d; bestI = i; } }
      else if (inZone) { if (data[bestI].t - last >= minLap) { n++; last = data[bestI].t; } inZone = false; bestD = 9; bestI = -1; }
    }
    return n;
  }

  // Pick the most-visited sampled point as the default gate (a point that lies ON the lap loop,
  // unlike the GPS start which is often an out-lap / approach).
  function findAutoGate() {
    var data = state.vboData, best = 0, bestN = -1;
    for (var gi = 0; gi < data.length; gi += 500) {
      var n = countGatePasses(gi, LAP_GATE_T, 5);
      if (n > bestN) { bestN = n; best = gi; }
    }
    return best;
  }

  // Closest-approach lap detection around the current gate. Two-pass: rough median → adaptive debounce.
  function detectLaps(gateIdx) {
    var data = state.vboData;
    if (!data || data.length < 2) return { crossings: [], laps: [], median: 0 };
    var gx = data[gateIdx].mx, gy = data[gateIdx].my;
    function pass(minLap) {
      var inZone = false, bestD = 9, bestI = -1, last = -9e9, cr = [];
      for (var i = 0; i < data.length; i++) {
        var dx = data[i].mx - gx, dy = data[i].my - gy, d = Math.sqrt(dx * dx + dy * dy);
        if (d < LAP_GATE_T) { inZone = true; if (d < bestD) { bestD = d; bestI = i; } }
        else if (inZone) { if (data[bestI].t - last >= minLap) { cr.push(bestI); last = data[bestI].t; } inZone = false; bestD = 9; bestI = -1; }
      }
      if (inZone && bestI >= 0 && data[bestI].t - last >= minLap) cr.push(bestI);
      return cr;
    }
    function lapsFrom(cr) {
      var laps = [];
      for (var k = 1; k < cr.length; k++) {
        var a = cr[k - 1], b = cr[k], mx = 0, sum = 0, cnt = 0;
        for (var i = a; i <= b; i++) { if (data[i].speed > mx) mx = data[i].speed; sum += data[i].speed; cnt++; }
        laps.push({ i0: a, i1: b, t: data[b].t - data[a].t, avg: cnt ? sum / cnt : 0, max: mx });
      }
      return laps;
    }
    var cr0 = pass(5), lp0 = lapsFrom(cr0);
    var med0 = lp0.length ? lp0.map(function (l) { return l.t; }).sort(function (a, b) { return a - b; })[lp0.length >> 1] : 0;
    var cr = pass(Math.max(5, 0.4 * med0)), laps = lapsFrom(cr);
    var med = laps.length ? laps.map(function (l) { return l.t; }).sort(function (a, b) { return a - b; })[laps.length >> 1] : 0;
    return { crossings: cr, laps: laps, median: med };
  }

  // Resample one lap's path to N points equally spaced by cumulative distance.
  function resampleLap(lap, N) {
    var data = state.vboData, pts = [];
    for (var i = lap.i0; i <= lap.i1; i++) pts.push([data[i].mx, data[i].my]);
    if (pts.length < 2) return null;
    var dist = [0];
    for (var i = 1; i < pts.length; i++) dist.push(dist[i - 1] + Math.sqrt((pts[i][0] - pts[i - 1][0]) * (pts[i][0] - pts[i - 1][0]) + (pts[i][1] - pts[i - 1][1]) * (pts[i][1] - pts[i - 1][1])));
    var total = dist[dist.length - 1];
    if (total <= 0) return null;
    var out = [];
    for (var k = 0; k < N; k++) {
      var target = total * k / (N - 1), j = 0;
      while (j < dist.length - 1 && dist[j + 1] < target) j++;
      if (j >= pts.length - 1) { out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]); continue; }
      var seg = dist[j + 1] - dist[j], f = seg > 0 ? (target - dist[j]) / seg : 0;
      out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f]);
    }
    return out;
  }

  // Average the "clean" laps (time within 0.6..1.5 × median) into one smooth centerline.
  function computeAveragedPath() {
    var laps = state.trackLaps, med = state.trackLapMedian;
    state.trackAvgPath = null;
    if (!laps || laps.length < 2 || med <= 0) return;
    var N = 240, res = [];
    for (var k = 0; k < laps.length; k++) {
      if (laps[k].t < 0.6 * med || laps[k].t > 1.5 * med) continue;
      var r = resampleLap(laps[k], N);
      if (r) res.push(r);
    }
    if (res.length === 0) return;
    var avg = [];
    for (var i = 0; i < N; i++) {
      var sx = 0, sy = 0;
      for (var j = 0; j < res.length; j++) { sx += res[j][i][0]; sy += res[j][i][1]; }
      avg.push({ mx: sx / res.length, my: sy / res.length });
    }
    avg.push({ mx: avg[0].mx, my: avg[0].my }); // close the loop
    state.trackAvgPath = avg;
  }

  // Recompute laps + averaged path for the current gate; refresh table + cached line.
  // skipTable=true during gate drag (table is refreshed once on release).
  function recomputeLaps(skipTable) {
    if (!state.trackMapReady || !state.vboData) { state.trackLaps = null; state.trackAvgPath = null; return; }
    var r = detectLaps(state.trackGateIdx);
    state.trackLaps = r.laps;
    state.trackLapMedian = r.median;
    computeAveragedPath();
    state.trackMapCache = null;           // line changed → rebuild offscreen cache
    if (!skipTable && typeof renderLapTable === 'function') renderLapTable();
    if (typeof updateLapUIVisibility === 'function') updateLapUIVisibility();
  }

  // Show lap-timing controls only for circuits; show the heading-up navigator toggle
  // only for routes (non-circuit). Hide both when no VBO track is loaded.
  function updateLapUIVisibility() {
    var hasTrack = !!state.trackMapReady;
    var isCircuit = hasTrack && state.trackLaps && state.trackLaps.length >= 2 && state.trackAvgPath;
    function rowOf(id) { var el = document.getElementById(id); return (el && el.closest) ? el.closest('.ve-setting') : null; }
    var lapRow = rowOf('showLapTable');
    if (lapRow) lapRow.style.display = isCircuit ? '' : 'none';
    var navRow = rowOf('navHeadingUp');
    if (navRow) navRow.style.display = (hasTrack && !isCircuit) ? '' : 'none';
    // Raw-GPS-trace controls only make sense on a circuit (where the bundle is drawn)
    var rawRow = rowOf('showRawTrack');
    if (rawRow) rawRow.style.display = isCircuit ? '' : 'none';
    var rawOpRow = rowOf('rawTrackOpacity');
    if (rawOpRow) rawOpRow.style.display = isCircuit ? '' : 'none';
    var aboveRow = rowOf('lapBoardAbove');          // lap board direction/layout: circuits only
    if (aboveRow) aboveRow.style.display = isCircuit ? '' : 'none';
    var horizRow = rowOf('lapBoardHorizontal');
    if (horizRow) horizRow.style.display = isCircuit ? '' : 'none';
    var matchRow = rowOf('lapBoardMatchMap');
    if (matchRow) matchRow.style.display = isCircuit ? '' : 'none';
  }

  // Which lap is active at video-relative time t, and seconds elapsed within it.
  function getCurrentLap(t) {
    if (!state.trackLaps || !state.trackLaps.length) return null;
    var vboT = t - state.vboTimeOffset + state.timeOffset;
    var laps = state.trackLaps, data = state.vboData;
    for (var k = 0; k < laps.length; k++) {
      var t0 = data[laps[k].i0].t, t1 = data[laps[k].i1].t;
      if (vboT >= t0 && vboT <= t1) return { idx: k, elapsed: vboT - t0, lap: laps[k] };
    }
    return null;
  }

  // Interpolated rider position {mx,my} on the minimap for video-relative time t,
  // or null when t is outside the VBO range. Same time-mapping as getDragySpeedAtTime.
  function getVBOPointAtTime(t) {
    if (!state.vboData || state.vboData.length === 0 || !state.trackMapReady) return null;
    var vboT = t - state.vboTimeOffset + state.timeOffset;
    if (vboT < state.vboTrimStart || vboT > state.vboTrimEnd) return null;
    var data = state.vboData;
    var lo = 0, hi = data.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (data[mid].t < vboT) lo = mid + 1; else hi = mid;
    }
    if (lo === 0) return { mx: data[0].mx, my: data[0].my };
    if (lo >= data.length) { var L = data[data.length - 1]; return { mx: L.mx, my: L.my }; }
    var a = data[lo - 1], b = data[lo];
    if (b.t === a.t) return { mx: a.mx, my: a.my };
    var frac = (vboT - a.t) / (b.t - a.t);
    return { mx: a.mx + (b.mx - a.mx) * frac, my: a.my + (b.my - a.my) * frac };
  }

  // Square widget rect (canvas px) from the fractional settings.
  function getTrackMapRect(w, h) {
    var ref = Math.min(w, h);
    var S = Math.max(40, settings.track_map_size * ref);
    return { x: settings.track_map_x * w - S / 2, y: settings.track_map_y * h - S / 2, S: S };
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Pre-render the static track line to an offscreen canvas of side S.
  // Main line = averaged centerline (clean) when available; faint raw bundle behind for context.
  function buildTrackMapCache(S, pad) {
    var inner = S - 2 * pad;
    var oc = document.createElement('canvas');
    oc.width = Math.round(S); oc.height = Math.round(S);
    var c = oc.getContext('2d');
    c.lineJoin = 'round'; c.lineCap = 'round';

    // raw-GPS bundle behind the clean line — optional (Elements ▸ Raw GPS trace) + adjustable opacity
    var raw = state.trackMapPath;
    var rawOp = (settings.raw_track_opacity != null ? settings.raw_track_opacity : 20) / 100;
    if (settings.show_raw_track && rawOp > 0 && raw && raw.length > 1) {
      c.strokeStyle = 'rgba(150,160,170,' + rawOp.toFixed(3) + ')'; c.lineWidth = Math.max(1, S * 0.012);
      c.beginPath();
      for (var i = 0; i < raw.length; i++) {
        var px = pad + raw[i].mx * inner, py = pad + raw[i].my * inner;
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      if (state.trackMapClosed) c.closePath();
      c.stroke();
    }

    // main line: averaged centerline if available, else the raw path
    var path = state.trackAvgPath || raw;
    var avgClosed = !!state.trackAvgPath;   // averaged path is already closed
    if (path && path.length > 1) {
      function trace() {
        c.beginPath();
        for (var i = 0; i < path.length; i++) {
          var px = pad + path[i].mx * inner, py = pad + path[i].my * inner;
          if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        if (!avgClosed && state.trackMapClosed) c.closePath();
      }
      c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = Math.max(2.5, S * 0.05); trace(); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = Math.max(1.4, S * 0.024); trace(); c.stroke();
    }
    return oc;
  }

  // Gate anchor position {mx,my} + perpendicular unit vector {px,py} in normalized track space.
  function getGateInfo() {
    if (!state.vboData || !state.trackMapReady) return null;
    var data = state.vboData, gi = state.trackGateIdx || 0;
    if (gi < 0 || gi >= data.length) return null;
    var a = Math.max(0, gi - 30), b = Math.min(data.length - 1, gi + 30);
    var tx = data[b].mx - data[a].mx, ty = data[b].my - data[a].my;
    var L = Math.sqrt(tx * tx + ty * ty) || 1;
    return { mx: data[gi].mx, my: data[gi].my, px: -ty / L, py: tx / L };
  }

  // Draw the minimap: averaged track + start/finish gate + moving rider dot.
  // Called from preview (isPreview=true → shows the gate grab handle) AND local export.
  function drawTrackMap(ctx, w, h, dataPoint, isPreview) {
    if (!settings.show_track_map || !state.trackMapReady) return;
    var r = getTrackMapRect(w, h);
    var S = r.S, pad = Math.max(6, S * 0.10), inner = S - 2 * pad;
    var rad = Math.max(6, S * 0.06);
    var bgOp = (settings.track_map_opacity != null ? settings.track_map_opacity : 100) / 100;

    ctx.save();
    // background panel — opacity is absolute (100% = solid black, like Box Opacity)
    ctx.fillStyle = 'rgba(0,0,0,' + bgOp.toFixed(3) + ')';
    roundRectPath(ctx, r.x, r.y, S, S, rad);
    ctx.fill();
    if (state.trackMapDrag) {            // highlight while dragging the whole widget
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2;
      roundRectPath(ctx, r.x, r.y, S, S, rad); ctx.stroke();
    }

    // Circuit (laps recognized) → whole averaged track + gate.  Otherwise → navigator view.
    var isCircuit = !!(state.trackLaps && state.trackLaps.length >= 2 && state.trackAvgPath);

    if (!isCircuit) {
      drawTrackNavigator(ctx, r, S, pad, inner, rad, dataPoint);
      ctx.restore();
      return;
    }

    // static track (cached; key includes size + averaged-path length so it rebuilds on change)
    var key = Math.round(S) + '|' + (state.trackMapClosed ? 1 : 0) + '|' + (state.trackAvgPath ? state.trackAvgPath.length : 0) + '|' + (state.trackMapPath ? state.trackMapPath.length : 0) + '|' + (settings.show_raw_track ? 1 : 0) + '|' + settings.raw_track_opacity;
    if (!state.trackMapCache || state.trackMapCacheKey !== key) {
      state.trackMapCache = buildTrackMapCache(S, pad);
      state.trackMapCacheKey = key;
    }
    if (state.trackMapCache) ctx.drawImage(state.trackMapCache, r.x, r.y);

    // start/finish gate ("палочка") — only on lap circuits (laps detected); perpendicular line + (preview) handle
    var gi = (state.trackLaps && state.trackLaps.length) ? getGateInfo() : null;
    if (gi) {
      var gx = r.x + pad + gi.mx * inner, gy = r.y + pad + gi.my * inner;
      var half = Math.max(6, S * 0.075), ex = gi.px * half, ey = gi.py * half;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = Math.max(3, S * 0.05);
      ctx.beginPath(); ctx.moveTo(gx - ex, gy - ey); ctx.lineTo(gx + ex, gy + ey); ctx.stroke();
      ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = Math.max(2, S * 0.03);
      ctx.beginPath(); ctx.moveTo(gx - ex, gy - ey); ctx.lineTo(gx + ex, gy + ey); ctx.stroke();
      if (isPreview) {
        var hr = Math.max(3, S * 0.045);
        ctx.beginPath(); ctx.arc(gx, gy, hr, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd23b'; ctx.fill();
        ctx.lineWidth = Math.max(1, S * 0.012); ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
      }
    }

    // rider dot (real GPS position, not snapped to the averaged line)
    var pos = dataPoint ? getVBOPointAtTime(dataPoint.t) : null;
    if (pos) {
      var dx = r.x + pad + pos.mx * inner, dy = r.y + pad + pos.my * inner;
      var dotR = Math.max(3, S * 0.045);
      ctx.beginPath(); ctx.arc(dx, dy, dotR + Math.max(1, S * 0.012), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
      ctx.beginPath(); ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = '#3ba8ff'; ctx.fill();
      ctx.lineWidth = Math.max(1, S * 0.01); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
    }
    ctx.restore();
  }

  var NAV_WINDOW_M = 250;   // metres shown across the navigator box (non-circuit rides)

  // Like getVBOPointAtTime but also returns the route index (for the navigator window).
  function getVBOIndexAtTime(t) {
    if (!state.vboData || !state.vboData.length || !state.trackMapReady) return null;
    var vboT = t - state.vboTimeOffset + state.timeOffset;
    if (vboT < state.vboTrimStart || vboT > state.vboTrimEnd) return null;
    var data = state.vboData, lo = 0, hi = data.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (data[mid].t < vboT) lo = mid + 1; else hi = mid; }
    if (lo === 0) return { mx: data[0].mx, my: data[0].my, idx: 0 };
    if (lo >= data.length) { var L = data[data.length - 1]; return { mx: L.mx, my: L.my, idx: data.length - 1 }; }
    var a = data[lo - 1], b = data[lo];
    var f = (b.t === a.t) ? 0 : (vboT - a.t) / (b.t - a.t);
    return { mx: a.mx + (b.mx - a.mx) * f, my: a.my + (b.my - a.my) * f, idx: lo };
  }

  // Navigator: rider stays centred, the local route scrolls through, clipped to the box.
  // Smoothed forward direction at a route index: chord from ~5 m behind to ~22 m ahead
  // (look-ahead bias anticipates turns; the long baseline averages out GPS jitter).
  function navForward(data, idx, mpu) {
    var behindN = 5 / mpu, aheadN = 22 / mpu;
    var ox = data[idx].mx, oy = data[idx].my, ib = idx, ia = idx;
    while (ib > 0 && Math.hypot(data[ib].mx - ox, data[ib].my - oy) < behindN) ib--;
    while (ia < data.length - 1 && Math.hypot(data[ia].mx - ox, data[ia].my - oy) < aheadN) ia++;
    var fx = data[ia].mx - data[ib].mx, fy = data[ia].my - data[ib].my;
    var L = Math.hypot(fx, fy) || 1;
    return { fx: fx / L, fy: fy / L };
  }

  // Navigator (non-circuit). North-up: rider centred. Heading-up (settings.nav_heading_up):
  // future path points up, rider in the lower 1/3, with smoothed rotation.
  function drawTrackNavigator(ctx, r, S, pad, inner, rad, dataPoint) {
    var pos = dataPoint ? getVBOIndexAtTime(dataPoint.t) : null;
    if (!pos) return;
    var data = state.vboData;
    var mpu = state.trackMapMetersPerUnit || 1;
    var pxPerUnit = inner / (NAV_WINDOW_M / mpu);     // inner px span = NAV_WINDOW_M metres
    var headingUp = !!settings.nav_heading_up;
    var cx = r.x + S / 2;
    var anchorY = headingUp ? (r.y + S * 0.66) : (r.y + S / 2);   // lower-1/3 vs centre
    var cosA = 1, sinA = 0;
    if (headingUp) {
      var fwd = navForward(data, pos.idx, mpu);
      var ang = (-Math.PI / 2) - Math.atan2(fwd.fy, fwd.fx);      // rotate forward → screen up
      cosA = Math.cos(ang); sinA = Math.sin(ang);
    }
    // distance-bounded local window (contiguous in time), capped for safety
    var winR = NAV_WINDOW_M / mpu, CAP = 6000;
    var i0 = pos.idx, i1 = pos.idx;
    while (i0 > 0 && (pos.idx - i0) < CAP && Math.hypot(data[i0 - 1].mx - pos.mx, data[i0 - 1].my - pos.my) < winR) i0--;
    while (i1 < data.length - 1 && (i1 - pos.idx) < CAP && Math.hypot(data[i1 + 1].mx - pos.mx, data[i1 + 1].my - pos.my) < winR) i1++;

    function P(i) {
      var dx = (data[i].mx - pos.mx) * pxPerUnit, dy = (data[i].my - pos.my) * pxPerUnit;
      return [cx + (dx * cosA - dy * sinA), anchorY + (dx * sinA + dy * cosA)];
    }
    ctx.save();
    roundRectPath(ctx, r.x, r.y, S, S, rad);
    ctx.clip();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    function trace() {
      ctx.beginPath();
      for (var i = i0; i <= i1; i++) { var p = P(i); if (i === i0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = Math.max(2.5, S * 0.05); trace(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(1.4, S * 0.024); trace(); ctx.stroke();
    ctx.restore();

    // rider dot at the anchor (centre, or lower-1/3 in heading-up)
    var dotR = Math.max(3, S * 0.045);
    ctx.beginPath(); ctx.arc(cx, anchorY, dotR + Math.max(1, S * 0.012), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, anchorY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = '#3ba8ff'; ctx.fill();
    ctx.lineWidth = Math.max(1, S * 0.01); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
  }

  // On-video lap board — its OWN draggable widget (independent of the map). Each lap is a
  // telemetry-styled black plaque. Vertical column (default) or horizontal row; grows away
  // from the LAP-1 anchor (lap_board_x/y). "Reverse" flips growth (vertical→up, horizontal→left).
  function drawLapTimer(ctx, w, h, dataPoint, isPreview) {
    if (!settings.show_lap_table || !state.trackLaps || state.trackLaps.length < 2 || !dataPoint) return;
    var laps = state.trackLaps, data = state.vboData, med = state.trackLapMedian;
    var vboT = dataPoint.t - state.vboTimeOffset + state.timeOffset;

    // Rows for laps that have started by now: completed → frozen time, current → ticking.
    var rows = [];
    for (var i = 0; i < laps.length; i++) {
      var t0 = data[laps[i].i0].t, t1 = data[laps[i].i1].t;
      if (vboT < t0) break;                                   // not started yet
      if (vboT >= t1) rows.push({ num: i + 1, time: laps[i].t, done: true });
      else { rows.push({ num: i + 1, time: vboT - t0, done: false }); break; }   // current lap (ticking)
    }
    if (rows.length === 0) rows.push({ num: null, time: NaN, done: false });     // "LAP —" before 1st crossing

    // Fastest completed clean lap so far → green.
    var bestT = 1e9, bestIdx = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].done && rows[i].time >= 0.6 * med && rows[i].time <= 1.5 * med && rows[i].time < bestT) { bestT = rows[i].time; bestIdx = i; }
    }

    var horiz = !!settings.lap_board_horizontal;
    var rev = !!settings.lap_board_above;            // vertical → up, horizontal → left
    var sf = w / 1920;
    var fontSize0 = settings.font_size * sf, boxH0 = Math.max(10, settings.bottom_padding) * sf,
        spacing0 = settings.spacing * sf, topPad0 = settings.top_padding * sf, radius0 = settings.border_radius * sf;
    var margin = 6 * sf;
    var ax = settings.lap_board_x * w, ay = settings.lap_board_y * h;   // anchor = LAP 1 top-left corner
    var N = rows.length;

    // widest box at full size. Measure with digits replaced by '0' so the ticking current-lap
    // time (proportional digit widths) does NOT change the box width frame-to-frame (no jitter).
    var font0 = fontSize0 + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', boldFont0 = 'bold ' + font0;
    var gapX0 = fontSize0 * 0.9, boxW0 = 0;
    function zeroDigits(s) { return s.replace(/[0-9]/g, '0'); }
    for (var i = 0; i < N; i++) {
      ctx.font = font0; var lw = ctx.measureText(zeroDigits('LAP ' + (rows[i].num != null ? rows[i].num : '—'))).width;
      ctx.font = boldFont0; var tw = ctx.measureText(zeroDigits(isFinite(rows[i].time) ? fmtLap(rows[i].time) : '—')).width;
      boxW0 = Math.max(boxW0, topPad0 * 2 + lw + gapX0 + tw);
    }

    // optionally tie the plaque width to the map's side
    var matchMap = !!settings.lap_board_match_map;
    var mapS = matchMap ? getTrackMapRect(w, h).S : 0;

    // growth axis + available room → shrink only if it doesn't fit
    var primary0 = horiz ? (matchMap ? mapS : boxW0) : boxH0;
    var total0 = N * primary0 + (N - 1) * spacing0;
    var avail = horiz ? (rev ? ax - margin : w - ax - margin) : (rev ? ay - margin : h - ay - margin);
    avail = Math.max(primary0, avail);
    // map-width boxes can't shrink in width (locked to the map) → keep scale 1 horizontally, cap rows
    var scale = (matchMap && horiz) ? 1 : (total0 <= avail ? 1 : Math.max(0.4, avail / total0));
    var fontSize = fontSize0 * scale, boxH = boxH0 * scale,
        spacing = spacing0 * scale, topPad = topPad0 * scale, radius = radius0 * scale;
    var boxW = matchMap ? mapS : (boxW0 * scale);

    // cap rows if it still doesn't fit (keep most recent → current visible)
    var primary = horiz ? boxW : boxH, step = primary + spacing;
    if (N * primary + (N - 1) * spacing > avail) {
      var maxRows = Math.max(1, Math.floor((avail + spacing) / step));
      var startRow = Math.max(0, N - maxRows);
      rows = rows.slice(startRow); bestIdx -= startRow; N = rows.length;
    }
    var totalLen = N * primary + (N - 1) * spacing;

    var font = fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', boldFont = 'bold ' + font;
    var boxAlpha = (settings.box_opacity / 100).toFixed(2);
    var textVOffset = (settings.text_vertical_offset || 0) * sf * scale;

    // bounding box (drag hit-test): extends from the anchor in the growth direction
    var bbX = (horiz && rev) ? ax - (N - 1) * step : ax;
    var bbY = (!horiz && rev) ? ay - (N - 1) * step : ay;
    if (isPreview) state._lapBoardBounds = { x: bbX, y: bbY, w: horiz ? totalLen : boxW, h: horiz ? boxH : totalLen };

    ctx.save();
    ctx.textBaseline = 'alphabetic';
    for (var i = 0; i < N; i++) {
      var rr = rows[i], bx, by;
      if (horiz) { bx = rev ? (ax - i * step) : (ax + i * step); by = ay; }
      else       { bx = ax; by = rev ? (ay - i * step) : (ay + i * step); }
      ctx.fillStyle = 'rgba(0,0,0,' + boxAlpha + ')';
      roundRectPath(ctx, bx, by, boxW, boxH, radius);
      ctx.fill();
      var ty = by + boxH / 2 + fontSize * 0.35 + textVOffset;
      ctx.fillStyle = (i === bestIdx) ? '#36d36b' : '#ffffff';
      ctx.textAlign = 'left'; ctx.font = font;
      ctx.fillText('LAP ' + (rr.num != null ? rr.num : '—'), bx + topPad, ty);
      ctx.textAlign = 'right'; ctx.font = boldFont;
      ctx.fillText(isFinite(rr.time) ? fmtLap(rr.time) : '—', bx + boxW - topPad, ty);
    }
    ctx.restore();
  }

  // Pointer drag (move) + wheel (resize) for the minimap widget on the preview canvas.
  function bindTrackMapInteraction() {
    var cv = dom.canvas;
    if (!cv) return;
    function canvasPos(e) {
      var rect = cv.getBoundingClientRect();
      var sx = rect.width ? cv.width / rect.width : 1;
      var sy = rect.height ? cv.height / rect.height : 1;
      return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
    }
    function insideMap(p) {
      if (!settings.show_track_map || !state.trackMapReady) return false;
      var r = getTrackMapRect(cv.width, cv.height);
      return p.x >= r.x && p.x <= r.x + r.S && p.y >= r.y && p.y <= r.y + r.S;
    }
    // Is the pointer over the gate grab handle? (checked before the map-box drag)
    function gateHit(p) {
      if (!settings.show_track_map || !state.trackMapReady) return false;
      var gi = getGateInfo(); if (!gi) return false;
      var r = getTrackMapRect(cv.width, cv.height);
      var pad = Math.max(6, r.S * 0.10), inner = r.S - 2 * pad;
      var gx = r.x + pad + gi.mx * inner, gy = r.y + pad + gi.my * inner;
      return Math.sqrt((p.x - gx) * (p.x - gx) + (p.y - gy) * (p.y - gy)) <= Math.max(9, r.S * 0.10);
    }
    // Move the gate to the VBO track vertex nearest the pointer, then recompute laps.
    function setGateFromPointer(p) {
      var r = getTrackMapRect(cv.width, cv.height);
      var pad = Math.max(6, r.S * 0.10), inner = r.S - 2 * pad;
      var mx = (p.x - r.x - pad) / inner, my = (p.y - r.y - pad) / inner;
      var data = state.vboData, best = -1, bestD = 1e9;
      for (var i = 0; i < data.length; i += 2) {
        var dx = data[i].mx - mx, dy = data[i].my - my, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && best !== state.trackGateIdx) { state.trackGateIdx = best; recomputeLaps(true); }
    }
    // Hit-tests for the speed gauge (circle) and the telemetry strip (rect), from last preview draw.
    function gaugeHit(p) {
      if (!settings.show_bottom_elements) return false;
      var b = state._gaugeBounds; if (!b) return false;
      return Math.sqrt((p.x - b.cx) * (p.x - b.cx) + (p.y - b.cy) * (p.y - b.cy)) <= b.r;
    }
    function telemHit(p) {
      var b = state._telemBounds; if (!b) return false;
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    }
    function lapBoardHit(p) {
      var b = state._lapBoardBounds; if (!b) return false;
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    }
    cv.addEventListener('pointerdown', function(e) {
      var p = canvasPos(e);
      if (gateHit(p)) {                      // gate handle takes priority over map-box drag
        state.trackGateDrag = true;
        try { cv.setPointerCapture(e.pointerId); } catch (_) {}
        cv.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      if (insideMap(p)) {
        var r = getTrackMapRect(cv.width, cv.height);
        state.trackMapDrag = { dx: p.x - (r.x + r.S / 2), dy: p.y - (r.y + r.S / 2) };
        try { cv.setPointerCapture(e.pointerId); } catch (_) {}
        cv.style.cursor = 'grabbing';
        e.preventDefault();
        renderOverlayOnce();
        return;
      }
      // Lap board / speed gauge / telemetry strip — delta drag
      if (lapBoardHit(p)) {
        state.overlayDrag = { type: 'lapboard', sx: p.x, sy: p.y, a: settings.lap_board_x, b: settings.lap_board_y };
      } else if (gaugeHit(p)) {
        state.overlayDrag = { type: 'gauge', sx: p.x, sy: p.y, a: settings.indicator_x, b: settings.indicator_y };
      } else if (telemHit(p)) {
        state.overlayDrag = { type: 'telem', sx: p.x, sy: p.y, a: settings.horizontal_position, b: settings.vertical_position };
      } else { return; }
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      cv.style.cursor = 'grabbing';
      e.preventDefault();
      renderOverlayOnce();
    });
    cv.addEventListener('pointermove', function(e) {
      var p = canvasPos(e);
      if (state.trackGateDrag) {
        setGateFromPointer(p);
        renderOverlayOnce();
        e.preventDefault();
      } else if (state.trackMapDrag) {
        settings.track_map_x = Math.min(0.98, Math.max(0.02, (p.x - state.trackMapDrag.dx) / cv.width));
        settings.track_map_y = Math.min(0.98, Math.max(0.02, (p.y - state.trackMapDrag.dy) / cv.height));
        renderOverlayOnce();
        e.preventDefault();
      } else if (state.overlayDrag) {
        var od = state.overlayDrag;
        if (od.type === 'lapboard') {                 // fraction-of-frame anchor (like the map)
          settings.lap_board_x = Math.min(0.98, Math.max(0.0, od.a + (p.x - od.sx) / cv.width));
          settings.lap_board_y = Math.min(0.98, Math.max(0.0, od.b + (p.y - od.sy) / cv.height));
        } else {
          var ddx = (p.x - od.sx) / cv.width * 100, ddy = (p.y - od.sy) / cv.height * 100;
          if (od.type === 'gauge') {
            settings.indicator_x = clampPct(od.a + ddx); settings.indicator_y = clampPct(od.b + ddy);
            syncSliderUI('indicator_x'); syncSliderUI('indicator_y');
          } else {
            settings.horizontal_position = clampPct(od.a + ddx); settings.vertical_position = clampPct(od.b + ddy);
            syncSliderUI('horizontal_position'); syncSliderUI('vertical_position');
          }
        }
        renderOverlayOnce();
        e.preventDefault();
      } else {
        cv.style.cursor = (gateHit(p)) ? 'grab' : (insideMap(p) || gaugeHit(p) || telemHit(p) || lapBoardHit(p) ? 'move' : '');
      }
    });
    function endDrag(e) {
      if (state.trackGateDrag) {
        state.trackGateDrag = false;
        try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
        cv.style.cursor = '';
        if (typeof renderLapTable === 'function') renderLapTable();   // final table refresh
        renderOverlayOnce();
        return;
      }
      if (state.overlayDrag) {
        state.overlayDrag = null;
        try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
        cv.style.cursor = '';
        renderOverlayOnce();
        return;
      }
      if (!state.trackMapDrag) return;
      state.trackMapDrag = null;
      try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
      cv.style.cursor = '';
      renderOverlayOnce();
    }
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('wheel', function(e) {
      if (!insideMap(canvasPos(e))) return;       // let the page scroll elsewhere
      e.preventDefault();
      var f = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      settings.track_map_size = Math.min(0.6, Math.max(0.08, settings.track_map_size * f));
      state.trackMapCache = null;                 // size changed → rebuild cache
      renderOverlayOnce();
    }, { passive: false });
    updateTrackMapInteractivity();
  }

  // The preview canvas is `pointer-events:none` in CSS (passive overlay). Enable
  // pointer events whenever there is a draggable overlay (track map, or the telemetry
  // strip / speed gauge that exist once CSV is loaded); otherwise keep click-through.
  function updateTrackMapInteractivity() {
    if (!dom.canvas) return;
    var interactive = (settings.show_track_map && state.trackMapReady) || (state.csvData && state.csvData.length > 0);
    dom.canvas.style.pointerEvents = interactive ? 'auto' : 'none';
  }

  // Reflect a drag-changed position setting back onto its panel slider + value label.
  var SLIDER_DOM = {
    vertical_position: ['verticalPosition', 'valVertPos'],
    horizontal_position: ['horizontalPosition', 'valHorizPos'],
    indicator_x: ['indicatorX', 'valIndX'],
    indicator_y: ['indicatorY', 'valIndY']
  };
  function syncSliderUI(key) {
    var m = SLIDER_DOM[key]; if (!m) return;
    var el = document.getElementById(m[0]), v = document.getElementById(m[1]);
    if (el) el.value = settings[key];
    if (v) v.textContent = settings[key];
  }
  function clampPct(v) { return Math.max(0, Math.min(100, Math.round(v))); }

  // m:ss.s lap-time formatter
  function fmtLap(s) {
    if (!isFinite(s) || s < 0) return '—';
    var m = Math.floor(s / 60), sec = s - m * 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec.toFixed(2);   // m:ss.ZZ (hundredths)
  }

  // Fill the sidebar lap table from state.trackLaps (best lap highlighted, outliers dimmed).
  function renderLapTable() {
    var section = document.getElementById('lapTableSection');
    var tbody = document.querySelector('#lapTable tbody');
    var summary = document.getElementById('lapSummary');
    if (!section || !tbody) return;
    var laps = state.trackLaps;
    if (!state.trackMapReady || !laps || laps.length < 2) { section.style.display = 'none'; return; }
    section.style.display = '';
    var med = state.trackLapMedian, bestIdx = -1, bestT = 1e9;
    for (var i = 0; i < laps.length; i++) {
      if (laps[i].t >= 0.6 * med && laps[i].t <= 1.5 * med && laps[i].t < bestT) { bestT = laps[i].t; bestIdx = i; }
    }
    var rows = '';
    for (var i = 0; i < laps.length; i++) {
      var l = laps[i], outlier = (l.t < 0.6 * med || l.t > 1.5 * med);
      var cls = (i === bestIdx) ? ' class="lap-best"' : (outlier ? ' class="lap-out"' : '');
      rows += '<tr' + cls + '><td>' + (i + 1) + '</td><td>' + fmtLap(l.t) + '</td><td>' + Math.round(l.avg) + '</td><td>' + Math.round(l.max) + '</td></tr>';
    }
    tbody.innerHTML = rows;
    if (summary) summary.textContent = laps.length + ' laps · best ' + (bestIdx >= 0 ? fmtLap(bestT) : '—');
  }

  // ===== UTILITIES =====
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00:00';
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function formatTimeShort(s) {
    s = Math.max(0, Math.floor(s));
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return pad2(m) + ":" + pad2(sec);
  }

  updateTrimVisibility();


  // ===== LOCAL EXPORT (WebCodecs + mp4-muxer) =====
  var _localExport = {
    active: false,
    cancelled: false,
    muxer: null,
    videoEncoder: null,
    audioEncoder: null,
    resultBlob: null,
  };

  function isLocalExportSupported() {
    return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof Mp4Muxer !== 'undefined';
  }

  function initLocalExport() {
    var btn = document.getElementById('btnLocalExport');
    if (!btn) return;
    if (isLocalExportSupported()) {
      btn.style.display = '';
    } else {
      btn.style.display = 'none';
    }
    btn.addEventListener('click', showLocalExportConfirm);
    var btnStart = document.getElementById('btnLocalExportStart');
    if (btnStart) btnStart.addEventListener('click', startLocalExport);
    var btnCancel = document.getElementById('btnLocalExportCancel');
    if (btnCancel) btnCancel.addEventListener('click', cancelLocalExport);
    var btnDownload = document.getElementById('btnLocalExportDownload');
    if (btnDownload) btnDownload.addEventListener('click', downloadLocalExport);
    var btnReport = document.getElementById('btnLocalExportReport');
    if (btnReport) btnReport.addEventListener('click', sendLocalExportReport);
  }

  function showLocalExportConfirm() {
    var srcW = state.videoMeta.width || 1920;
    var srcH = state.videoMeta.height || 1080;
    var srcFps = state.videoMeta.fps || 30;
    var dur = state.noVideoMode ? getNoVideoDuration() : (state.videoMeta.duration || 0);

    // Populate resolution select
    var resSelect = document.getElementById('localExportRes');
    if (resSelect) {
      var srcOpt = resSelect.querySelector('option[value="source"]');
      if (state.noVideoMode) {
        if (srcOpt) srcOpt.style.display = 'none';
        resSelect.value = '1920x1080';
      } else {
        if (srcOpt) { srcOpt.style.display = ''; srcOpt.textContent = srcW + '\u00d7' + srcH; }
        resSelect.value = 'source';
      }
    }
    // Populate FPS select
    var fpsSelect = document.getElementById('localExportFps');
    if (fpsSelect) {
      var srcFpsOpt = fpsSelect.querySelector('option[value="source"]');
      if (state.noVideoMode) {
        if (srcFpsOpt) srcFpsOpt.style.display = 'none';
        fpsSelect.value = '30';
      } else {
        if (srcFpsOpt) { srcFpsOpt.style.display = ''; srcFpsOpt.textContent = Math.round(srcFps) + ' fps'; }
        fpsSelect.value = 'source';
      }
    }
    document.getElementById('localExportInfoDur').textContent = formatTime(dur);
    var modal = new bootstrap.Modal(document.getElementById('localExportConfirmModal'));
    modal.show();
  }

  function updateLocalProgress(frame, total, stage, speed, eta) {
    var pct = total > 0 ? Math.round(frame / total * 100) : 0;
    var statusEl = document.getElementById('localExpStatus');
    var barEl = document.getElementById('localExpBar');
    var frameEl = document.getElementById('localExpFrame');
    var speedEl = document.getElementById('localExpSpeed');
    var etaEl = document.getElementById('localExpEta');
    var stageEl = document.getElementById('localExpStage');
    if (statusEl) statusEl.innerHTML = '<span class="badge text-bg-warning">Rendering ' + pct + '%</span>';
    if (barEl) barEl.style.width = pct + '%';
    if (frameEl) frameEl.textContent = frame + ' / ' + total;
    if (speedEl) speedEl.textContent = speed || '\u2014';
    if (etaEl) etaEl.textContent = eta || '\u2014';
    if (stageEl) stageEl.textContent = stage || 'Rendering...';
  }

  function showLocalExportDone() {
    var statusEl = document.getElementById('localExpStatus');
    var barEl = document.getElementById('localExpBar');
    var stageEl = document.getElementById('localExpStage');
    var btnCancel = document.getElementById('btnLocalExportCancel');
    var btnDownload = document.getElementById('btnLocalExportDownload');
    var btnClose = document.getElementById('btnLocalExportClose');
    var speedEl = document.getElementById('localExpSpeed');
    var etaEl = document.getElementById('localExpEta');
    if (statusEl) statusEl.innerHTML = '<span class="badge text-bg-success">Complete</span>';
    if (barEl) { barEl.style.width = '100%'; barEl.style.background = 'linear-gradient(90deg,#28a745,#20c997)'; }
    // Show total time and file size
    var elapsed = _localExport.startTime ? ((performance.now() - _localExport.startTime) / 1000) : 0;
    var sizeMB = _localExport.resultBlob ? (_localExport.resultBlob.size / (1024 * 1024)).toFixed(1) : '?';
    if (stageEl) stageEl.textContent = 'Done! File size: ' + sizeMB + ' MB. Click Download to save.';
    if (speedEl) speedEl.textContent = elapsed > 0 ? (elapsed < 60 ? elapsed.toFixed(1) + 's' : Math.floor(elapsed / 60) + 'm ' + Math.round(elapsed % 60) + 's') : '\u2014';
    if (etaEl) etaEl.textContent = sizeMB + ' MB';
    if (btnCancel) btnCancel.style.display = 'none';
    if (btnDownload) btnDownload.style.display = '';
    if (btnClose) btnClose.style.display = '';

    // Beacon-статистика: Local Export целиком в браузере и иначе не виден серверу.
    // keepalive — чтобы событие ушло даже если пользователь сразу закроет вкладку.
    try {
      var _isCircuit = !!(state.trackLaps && state.trackLaps.length >= 2 && state.trackAvgPath);
      var _hasTrack = !!(settings.show_track_map && state.trackMapReady && state.vboData);
      fetch('/video-editor/track-local-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          csv_source: state.csvType || null,
          resolution: (_localExport.expW && _localExport.expH) ? (_localExport.expW + 'x' + _localExport.expH) : null,
          codec: 'h264',
          duration_sec: _localExport.expDuration || null,
          frame_count: _localExport.expFrames || null,
          has_track_map: _hasTrack,
          has_laps: _isCircuit,
          success: true
        })
      }).catch(function () {});
    } catch (e) {}
  }

  // Понятное сообщение + подсказка по частым причинам сбоя экспорта.
  function _humanizeExportError(err) {
    var m = (err && err.message) ? err.message : String(err || 'Unknown error');
    var hint = '';
    if (/closed codec|encoder closed|закрыл/i.test(m)) hint = 'Кодек закрылся — обычно разрешение или частота кадров не поддерживаются кодировщиком. Попробуйте экспорт в 1080p (параметр Resolution).';
    else if (/not supported|unsupported|isConfigSupported|не поддерж/i.test(m)) hint = 'Эта конфигурация не поддерживается браузером или видеокартой. Попробуйте меньшее разрешение (1080p) либо свежий Chrome/Edge.';
    else if (/memory|allocation|OOM|heap/i.test(m)) hint = 'Не хватило памяти — видео слишком большое для экспорта в браузере. Попробуйте меньшее разрешение или серверный экспорт (Export).';
    else if (/VideoEncoder|VideoFrame|WebCodecs|is not defined/i.test(m)) hint = 'Похоже, браузер не поддерживает WebCodecs. Используйте свежий Chrome/Edge или серверный экспорт.';
    return { message: m, hint: hint };
  }

  // Собирает максимум диагностики для отчёта об ошибке (браузер, видео, экспорт, память).
  function _collectExportDiag(err) {
    var diag = {};
    try {
      diag.error_name = err && err.name;
      diag.error_message = err && err.message ? err.message : String(err || '');
      var resSel = document.getElementById('localExportRes');
      diag.export = {
        resolution: (_localExport.expW && _localExport.expH) ? (_localExport.expW + 'x' + _localExport.expH) : (resSel ? resSel.value : null),
        fps: _localExport.expFps,
        total_frames: _localExport.expFrames,
        duration_sec: _localExport.expDuration,
        encoder_config: _localExport.encConfig || null,
        audio_skipped: _localExport.audioSkippedReason || null,
        progress_frame: (document.getElementById('localExpFrame') || {}).textContent || null,
        progress_stage: (document.getElementById('localExpStage') || {}).textContent || null,
        no_video_mode: !!state.noVideoMode,
      };
      var vm = state.videoMeta || {};
      diag.video = {
        width: vm.width, height: vm.height, fps: vm.fps, duration: vm.duration,
        file_name: state.videoFile && state.videoFile.name,
        file_size_mb: (state.videoFile && state.videoFile.size) ? Math.round(state.videoFile.size / 1048576) : null,
        file_type: state.videoFile && state.videoFile.type,
      };
      diag.telemetry = {
        csv_type: state.csvType || null,
        has_vbo: !!state.vboData,
        has_track_map: !!(settings && settings.show_track_map),
        laps: (state.trackLaps && state.trackLaps.length) || 0,
      };
      diag.webcodecs = {
        VideoEncoder: (typeof VideoEncoder !== 'undefined'),
        VideoFrame: (typeof VideoFrame !== 'undefined'),
        AudioEncoder: (typeof AudioEncoder !== 'undefined'),
        Mp4Muxer: (typeof Mp4Muxer !== 'undefined'),
        MP4Box: (typeof MP4Box !== 'undefined'),
        isConfigSupported: (typeof VideoEncoder !== 'undefined' && typeof VideoEncoder.isConfigSupported === 'function'),
      };
      var nav = window.navigator || {};
      diag.browser = {
        userAgent: nav.userAgent, platform: nav.platform, language: nav.language,
        hardwareConcurrency: nav.hardwareConcurrency, deviceMemory: nav.deviceMemory,
        screen: (window.screen ? (window.screen.width + 'x' + window.screen.height) : null),
        dpr: window.devicePixelRatio,
      };
      if (window.performance && performance.memory) {
        diag.memory = {
          usedJSHeapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
          totalJSHeapMB: Math.round(performance.memory.totalJSHeapSize / 1048576),
          limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576),
        };
      }
      diag.stack = (err && err.stack) ? String(err.stack).slice(0, 4000) : null;
      diag.time = new Date().toISOString();
    } catch (e) { diag._collectError = String(e); }
    return diag;
  }

  function showLocalExportError(err, diag) {
    var info = _humanizeExportError(err);
    _localExport.lastError = info.message;
    _localExport.lastDiag = diag || _collectExportDiag(err);
    var msgEl = document.getElementById('localExpErrorMsg');
    var hintEl = document.getElementById('localExpErrorHint');
    var detEl = document.getElementById('localExpErrorDetails');
    var errEl = document.getElementById('localExpError');
    var stageEl = document.getElementById('localExpStage');
    var statusEl = document.getElementById('localExpStatus');
    var btnCancel = document.getElementById('btnLocalExportCancel');
    var btnClose = document.getElementById('btnLocalExportClose');
    var btnReport = document.getElementById('btnLocalExportReport');
    var rptStatus = document.getElementById('localExpReportStatus');
    if (msgEl) msgEl.textContent = info.message;
    if (hintEl) { hintEl.textContent = info.hint || ''; hintEl.style.display = info.hint ? '' : 'none'; }
    if (detEl) { try { detEl.textContent = JSON.stringify(_localExport.lastDiag, null, 2); } catch (e) { detEl.textContent = String(_localExport.lastDiag); } }
    if (errEl) errEl.style.display = '';
    if (stageEl) stageEl.textContent = 'Export failed';
    if (statusEl) statusEl.innerHTML = '<span class="badge text-bg-danger">Error</span>';
    if (btnCancel) btnCancel.style.display = 'none';
    if (btnClose) btnClose.style.display = '';
    if (rptStatus) { rptStatus.style.display = 'none'; rptStatus.textContent = ''; }
    if (btnReport) { btnReport.style.display = ''; btnReport.disabled = false; btnReport.innerHTML = '<i class="bi bi-send"></i> Отправить отчёт'; }
  }

  // Отправка отчёта об ошибке на сервер (кнопка в модалке).
  function sendLocalExportReport() {
    var btnReport = document.getElementById('btnLocalExportReport');
    var rptStatus = document.getElementById('localExpReportStatus');
    if (btnReport) { btnReport.disabled = true; btnReport.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Отправка…'; }
    fetch('/video-editor/error-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'local_export',
        error_message: _localExport.lastError || 'Unknown error',
        error_stack: (_localExport.lastDiag && _localExport.lastDiag.stack) || null,
        context: _localExport.lastDiag || {},
        url: window.location.href,
      })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (rptStatus) { rptStatus.style.display = ''; rptStatus.style.color = '#9fd89f'; rptStatus.textContent = (d && d.success) ? '✓ Отчёт отправлен, спасибо! Мы разберёмся.' : 'Отчёт принят.'; }
      if (btnReport) btnReport.style.display = 'none';
    }).catch(function () {
      if (rptStatus) { rptStatus.style.display = ''; rptStatus.style.color = '#f3b0b0'; rptStatus.textContent = 'Не удалось отправить отчёт (проверьте соединение).'; }
      if (btnReport) { btnReport.disabled = false; btnReport.innerHTML = '<i class="bi bi-send"></i> Отправить отчёт'; }
    });
  }

  function cancelLocalExport() {
    _localExport.cancelled = true;
    _localExport.userCancelled = true;   // отличаем ручную отмену от сбоя энкодера
    try { if (_localExport.videoEncoder && _localExport.videoEncoder.state !== 'closed') _localExport.videoEncoder.close(); } catch(e) {}
    try { if (_localExport.audioEncoder && _localExport.audioEncoder.state !== 'closed') _localExport.audioEncoder.close(); } catch(e) {}
    var modal = bootstrap.Modal.getInstance(document.getElementById('localExportProgressModal'));
    if (modal) modal.hide();
    _localExport.active = false;
  }

  function downloadLocalExport() {
    if (!_localExport.resultBlob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(_localExport.resultBlob);
    a.download = (document.getElementById('exportProjectName').value.trim() || 'local-export') + '.mp4';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function startLocalExport() {
    if (_localExport.active) return;
    _localExport.active = true;
    _localExport.cancelled = false;
    _localExport.userCancelled = false;
    _localExport.encoderError = null;
    _localExport.audioSkippedReason = null;
    _localExport.encConfig = null;
    _localExport.resultBlob = null;
    _localExport.muxerChunks = null;
    _localExport.muxer = null;

    var confirmModal = bootstrap.Modal.getInstance(document.getElementById('localExportConfirmModal'));
    if (confirmModal) confirmModal.hide();

    // Reset progress UI
    document.getElementById('localExpBar').style.width = '0%';
    document.getElementById('localExpBar').style.background = 'linear-gradient(90deg,#28a745,#20c997)';
    document.getElementById('localExpStatus').innerHTML = '<span class="badge text-bg-warning">Rendering 0%</span>';
    document.getElementById('localExpFrame').textContent = '0 / 0';
    document.getElementById('localExpSpeed').textContent = '\u2014';
    document.getElementById('localExpEta').textContent = '\u2014';
    document.getElementById('localExpStage').textContent = 'Initializing...';
    document.getElementById('localExpError').style.display = 'none';
    document.getElementById('btnLocalExportCancel').style.display = '';
    document.getElementById('btnLocalExportDownload').style.display = 'none';
    document.getElementById('btnLocalExportClose').style.display = 'none';

    // Show progress modal
    setTimeout(function() {
      var progressModal = new bootstrap.Modal(document.getElementById('localExportProgressModal'));
      progressModal.show();
    }, 300);

    // Small delay to let modal render
    await new Promise(function(r) { setTimeout(r, 500); });

    try {
      await doLocalExport();
    } catch (e) {
      console.error('Local export error:', e);
      // Освобождаем нативные ресурсы кодеков/muxer при сбое (иначе утечка) и
      // восстанавливаем ширины боксов под viewport.
      try { if (_localExport.videoEncoder && _localExport.videoEncoder.state !== 'closed') _localExport.videoEncoder.close(); } catch (_) {}
      try { if (_localExport.audioEncoder && _localExport.audioEncoder.state !== 'closed') _localExport.audioEncoder.close(); } catch (_) {}
      try { recalcStaticBoxWidths(); } catch (_) {}
      _localExport.muxerChunks = null;
      _localExport.muxer = null;
      // Показываем ошибку только если это реальный сбой, а не ручная отмена.
      if (!_localExport.userCancelled) {
        showLocalExportError(e);
      }
    }
    _localExport.active = false;
  }

  // Подбор поддерживаемой конфигурации H.264-энкодера: достаточный Level по
  // разрешению/fps, сначала аппаратное ускорение, затем software. Возвращает первый
  // поддерживаемый VideoEncoderConfig или null, если ничего не подошло.
  async function _pickVideoEncoderConfig(w, h, fps, bitrate) {
    // High Profile, codec-строки с возрастающим Level и их потолком разрешения
    var byLevel = [
      { lvl: 'avc1.64001f', maxW: 1280, maxH: 720 },   // 3.1
      { lvl: 'avc1.640028', maxW: 2048, maxH: 1080 },  // 4.0  (1080p30)
      { lvl: 'avc1.64002a', maxW: 2704, maxH: 1536 },  // 4.2  (1080p60 / 2.7K)
      { lvl: 'avc1.640032', maxW: 3840, maxH: 2160 },  // 5.0
      { lvl: 'avc1.640033', maxW: 4096, maxH: 2304 },  // 5.1  (4K)
      { lvl: 'avc1.640034', maxW: 8192, maxH: 4320 },  // 5.2
    ];
    var candidates = byLevel.filter(function (c) { return w <= c.maxW && h <= c.maxH; }).map(function (c) { return c.lvl; });
    if (!candidates.length) candidates = ['avc1.640034', 'avc1.640033'];
    var accels = ['prefer-hardware', 'prefer-software', 'no-preference'];
    var hasCheck = (typeof VideoEncoder !== 'undefined' && typeof VideoEncoder.isConfigSupported === 'function');
    for (var ai = 0; ai < accels.length; ai++) {
      for (var ci = 0; ci < candidates.length; ci++) {
        var cfg = {
          codec: candidates[ci], width: w, height: h,
          bitrate: bitrate, framerate: fps,
          hardwareAcceleration: accels[ai],
          avc: { format: 'avc' },
        };
        if (!hasCheck) return cfg; // нет API проверки — пробуем как есть
        try {
          var sup = await VideoEncoder.isConfigSupported(cfg);
          if (sup && sup.supported) { console.log('Local export: encoder config selected', cfg.codec, accels[ai]); return cfg; }
        } catch (e) { /* пробуем следующий вариант */ }
      }
    }
    return null;
  }

  async function doLocalExport() {
    var video = dom.video;

    // Read user-selected resolution from modal
    var resSelect = document.getElementById('localExportRes');
    var resVal = resSelect ? resSelect.value : 'source';
    var w, h;
    if (resVal === '3840x2160') {
      w = 3840; h = 2160;
    } else if (resVal === '1920x1080') {
      w = 1920; h = 1080;
    } else if (state.noVideoMode) {
      w = 1920; h = 1080;
    } else {
      w = state.videoMeta.width || video.videoWidth || 1920;
      h = state.videoMeta.height || video.videoHeight || 1080;
    }
    // H.264 требует ЧЁТНЫЕ width/height — нечётный source (часто у портретных/обрезанных
    // видео) иначе валит VideoEncoder.configure() и даёт 'closed codec' на кадре 0.
    w = w - (w % 2);
    h = h - (h % 2);

    // Read user-selected FPS from modal
    var fpsSelect = document.getElementById('localExportFps');
    var fpsVal = fpsSelect ? fpsSelect.value : 'source';
    var fps;
    if (fpsVal === '60') {
      fps = 60;
    } else if (fpsVal === '30') {
      fps = 30;
    } else {
      fps = state.videoMeta.fps || 30;
    }

    var duration = state.noVideoMode ? getNoVideoDuration() : (state.videoMeta.duration || video.duration || 0);
    var totalFrames = Math.ceil(duration * fps);

    if (totalFrames <= 0) throw new Error('No video loaded or duration is 0');

    // Параметры для beacon-статистики (читаются в showLocalExportComplete)
    _localExport.expW = w; _localExport.expH = h; _localExport.expFps = fps;
    _localExport.expDuration = duration; _localExport.expFrames = totalFrames;

    _localExport.startTime = performance.now();
    updateLocalProgress(0, totalFrames, 'Setting up encoder...', '\u2014', '\u2014');

    // Offscreen canvas for compositing at original video resolution
    var offCanvas = document.createElement('canvas');
    offCanvas.width = w;
    offCanvas.height = h;
    var offCtx = offCanvas.getContext('2d');

    if (_localExport.cancelled) return;

    // Extract audio track from original video using mp4box.js (pure JS demux, no server)
    var audioTrackInfo = null;
    var audioSamples = [];
    updateLocalProgress(0, totalFrames, 'Extracting audio from original...', '\u2014', '\u2014');
    try {
      // Guard: извлечение аудио читает файл в память (mp4box) — на очень больших
      // файлах (десятки ГБ с экшн-камер) это валит вкладку по OOM ещё до рендера.
      // Пропускаем звук с предупреждением, а не роняем весь экспорт.
      if (!state.noVideoMode && state.videoFile && state.videoFile.size > 1610612736 /* 1.5 GB */) {
        console.warn('Local export: video file too large (' + (state.videoFile.size / 1073741824).toFixed(1) + ' GB) for in-browser audio extraction — exporting without audio');
        _localExport.audioSkippedReason = 'file_too_large';
      } else if (!state.noVideoMode && state.videoFile && typeof MP4Box !== 'undefined') {
        var extracted = await _extractAudioFromMP4(state.videoFile);
        if (extracted) {
          var aCodec = (extracted.info.codec || '').toLowerCase();
          if (aCodec.indexOf('mp4a') === 0 || aCodec.indexOf('aac') >= 0) {
            audioTrackInfo = extracted.info;
            audioSamples = extracted.samples;
            console.log('Local export: audio extracted, samples:', audioSamples.length,
              'codec:', audioTrackInfo.codec, 'sampleRate:', audioTrackInfo.sampleRate,
              'channels:', audioTrackInfo.channels);
          } else {
            console.warn('Local export: unsupported audio codec:', aCodec);
            alert('Audio format ' + aCodec + ' is not supported for local export. The video will be exported without audio. Supported format: AAC.');
          }
        }
      }
    } catch (e) {
      console.warn('Local export: audio extraction failed, exporting without audio:', e);
    }

    // Create muxer with audio if available.
    // StreamTarget + chunk accumulation: avoids "Array buffer allocation failed"
    // for large videos. ArrayBufferTarget required the entire MP4 in one contiguous
    // buffer, which V8 cannot allocate for ~1GB+ files (esp. with fastStart doubling).
    // Without fastStart, moov atom is placed at the end of the file — fine for a
    // downloaded file (player reads from end). For browser streaming we'd need
    // fastStart, but here the result is downloaded as a Blob.
    var muxerChunks = [];
    var muxerTarget = new Mp4Muxer.StreamTarget({
      onData: function(data, position) {
        // slice() to copy: mp4-muxer may reuse the underlying buffer
        muxerChunks.push(data.slice());
      },
    });
    _localExport.muxerChunks = muxerChunks;
    var muxerOpts = {
      target: muxerTarget,
      video: { codec: 'avc', width: w, height: h },
      // 'fragmented' => fragmented MP4 (fmp4): file is ftyp + moov(init) +
      // sequence of (moof + mdat) fragments. EVERY size is known when the
      // fragment is written, so there is NO random-access seekback during
      // finalize — perfect for StreamTarget which only appends.
      //
      // We CANNOT use:
      //   - 'in-memory' : doubles memory, hits "Array buffer allocation
      //     failed" on ~1GB+ outputs.
      //   - false       : muxer writes ftyp + mdat-with-placeholder-size
      //     and at finalize seeks back to position 0 to patch the mdat
      //     header AND appends moov at end. StreamTarget.onData is
      //     called with position=N for the patches; if the consumer just
      //     appends data ignoring position, the file gets a broken
      //     mdat header (largesize=0x10 stub) and no moov — exactly
      //     the corruption we just saw.
      //
      // Fragmented MP4 plays in QuickTime (macOS Mojave+), Safari, Chrome,
      // Firefox, VLC, ffmpeg. Editing apps may prefer non-fragmented but
      // for download+play it's universally supported.
      fastStart: 'fragmented',
    };
    if (audioTrackInfo) {
      muxerOpts.audio = {
        codec: 'aac',
        numberOfChannels: audioTrackInfo.channels,
        sampleRate: audioTrackInfo.sampleRate,
      };
      console.log('Local export: muxer with audio:', muxerOpts.audio);
    }
    var muxer = new Mp4Muxer.Muxer(muxerOpts);
    _localExport.muxer = muxer;

    // Video encoder. error-колбэк ФАТАЛЬНЫЙ: сохраняет реальную причину и валит экспорт.
    // Иначе configure() с неподдерживаемой конфигурацией асинхронно переводит кодек в
    // 'closed', а цикл продолжает encode() на закрытом кодеке → невнятное
    // 'Cannot call encode on a closed codec' на кадре 0 (исходный баг инцидента).
    var videoEncoder = new VideoEncoder({
      output: function(chunk, meta) { muxer.addVideoChunk(chunk, meta); },
      error: function(e) {
        console.error('VideoEncoder error:', e);
        _localExport.encoderError = e;
        _localExport.cancelled = true;
      }
    });
    _localExport.videoEncoder = videoEncoder;

    var bitrate = 8000000;
    if (w >= 3840) bitrate = 30000000;
    else if (w >= 1920) bitrate = 12000000;
    else if (w >= 1280) bitrate = 8000000;

    // Подбираем H.264 Level под разрешение/fps и проверяем поддержку через
    // isConfigSupported, с фолбэком на software-кодирование. Захардкоженный ранее
    // 'avc1.640028' (Level 4.0) не поддерживает >1080p — отсюда сбой на 4K/2.7K видео.
    var encCfg = await _pickVideoEncoderConfig(w, h, fps, bitrate);
    if (!encCfg) {
      throw new Error('Браузер или видеокарта не поддерживают кодирование ' + w + '×' + h +
        ' в H.264. Попробуйте экспортировать в меньшем разрешении (1080p) — параметр Resolution в окне Local Export.');
    }
    _localExport.encConfig = { codec: encCfg.codec, accel: encCfg.hardwareAcceleration, bitrate: bitrate, width: w, height: h, fps: fps };
    videoEncoder.configure(encCfg);

    updateLocalProgress(0, totalFrames, 'Rendering frames...', '\u2014', '\u2014');
    video.pause();

    var startTime = performance.now();
    var keyframeInterval = Math.round(fps * 2);

    // Recalculate static box widths at export resolution (viewport canvas is smaller)
    recalcStaticBoxWidths(w);

    // Frame-by-frame rendering
    for (var frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (_localExport.cancelled) break;
      // Если энкодер упал асинхронно (отказ HW/конфига) — пробрасываем ИСХОДНУЮ
      // причину, а не ждём generic 'closed codec' на следующем encode().
      if (_localExport.encoderError) throw _localExport.encoderError;

      var t = frameIdx / fps;

      // Seek video or draw chroma background
      if (state.noVideoMode) {
        offCtx.fillStyle = state.chromaBgColor;
        offCtx.fillRect(0, 0, w, h);
      } else {
        video.currentTime = t;
        // Wait for new frame to be both decoded AND painted by the browser.
        // We listen to BOTH signals in parallel and take whichever fires first:
        //   - 'seeked' event: works reliably in Safari (which doesn't fire rVFC
        //     on paused videos)
        //   - requestVideoFrameCallback: fires more precisely on Chrome
        // After either signal we still wait one requestAnimationFrame so the
        // browser actually paints the new frame before we drawImage from it.
        // Safety timeout 10s — should never trigger if either signal works.
        await new Promise(function(resolve) {
          var done = false;
          var onSeeked = function() { finish(); };
          function finish() {
            if (done) return;
            done = true;
            // снимаем listener во ВСЕХ путях завершения (rVFC-first / seeked / timeout),
            // иначе на длинном видео накапливаются десятки тысяч 'seeked'-обработчиков
            video.removeEventListener('seeked', onSeeked);
            // Wait one paint frame so the video element actually shows the new frame
            requestAnimationFrame(function() { resolve(); });
          }
          video.addEventListener('seeked', onSeeked);
          if (typeof video.requestVideoFrameCallback === 'function') {
            video.requestVideoFrameCallback(function() { finish(); });
          }
          setTimeout(function() {
            if (!done) {
              console.warn('Local export: frame ready timeout at frame', frameIdx, 't=', t.toFixed(3));
              done = true;
              video.removeEventListener('seeked', onSeeked);
              resolve();
            }
          }, 10000);
        });
        offCtx.drawImage(video, 0, 0, w, h);
      }

      var dataPoint = getDataAtTime(t);
      if (dataPoint) {
        if (state.vboData && state.vboData.length > 0) {
          dataPoint.dragySpeed = getDragySpeedAtTime(t);
        }
        drawTelemetryBoxes(offCtx, w, h, dataPoint, false);
        if (settings.show_bottom_elements) {
          drawSpeedGauge(offCtx, w, h, dataPoint.speed, false);
        }
        drawTrackMap(offCtx, w, h, dataPoint, false);
        drawLapTimer(offCtx, w, h, dataPoint, false);
      }

      // Encode frame. Если кодек уже закрыт (асинхронный отказ) — бросаем понятную
      // причину вместо нативного 'Cannot call encode on a closed codec'.
      if (videoEncoder.state === 'closed') throw (_localExport.encoderError || new Error('Видеокодек неожиданно закрылся во время кодирования'));
      var frame = new VideoFrame(offCanvas, {
        timestamp: Math.round(t * 1000000),
        duration: Math.round(1000000 / fps),
      });
      videoEncoder.encode(frame, { keyFrame: frameIdx % keyframeInterval === 0 });
      frame.close();

      // Backpressure: wait if encoder queue is building up
      while (videoEncoder.encodeQueueSize > 10) {
        if (_localExport.encoderError) throw _localExport.encoderError;
        await new Promise(function(r) { setTimeout(r, 1); });
      }

      // Update progress every 3 frames
      if (frameIdx % 3 === 0 || frameIdx === totalFrames - 1) {
        var elapsed = (performance.now() - startTime) / 1000;
        var fpsRate = frameIdx > 0 ? (frameIdx / elapsed) : 0;
        var remaining = fpsRate > 0 ? ((totalFrames - frameIdx) / fpsRate) : 0;
        var speedTxt = fpsRate > 0 ? (fpsRate.toFixed(1) + ' fps (' + (fpsRate / fps).toFixed(1) + 'x)') : '\u2014';
        var etaTxt = remaining > 0 ? formatTime(Math.round(remaining)) : '\u2014';
        updateLocalProgress(frameIdx + 1, totalFrames, 'Rendering frames...', speedTxt, etaTxt);
        await new Promise(function(r) { setTimeout(r, 0); });
      }
    }

    if (_localExport.cancelled) { if (videoEncoder.state !== 'closed') videoEncoder.close(); return; }

    // Flush video
    updateLocalProgress(totalFrames, totalFrames, 'Flushing video encoder...', '\u2014', '\u2014');
    await videoEncoder.flush();
    videoEncoder.close();

    if (_localExport.cancelled) return;

    // Add extracted audio samples to muxer
    if (audioTrackInfo && audioSamples.length > 0) {
      updateLocalProgress(totalFrames, totalFrames, 'Muxing audio...', '\u2014', '\u2014');
      console.log('Local export: adding', audioSamples.length, 'audio samples to muxer');
      for (var ai = 0; ai < audioSamples.length; ai++) {
        var sample = audioSamples[ai];
        // Limit audio to video duration
        if (sample.timestamp > duration * 1000000) break;
        muxer.addAudioChunkRaw(
          sample.data,
          sample.isKeyframe ? 'key' : 'delta',
          sample.timestamp,
          sample.duration,
          audioTrackInfo.decoderConfig ? { decoderConfig: audioTrackInfo.decoderConfig } : undefined
        );
      }
      console.log('Local export: audio samples added');
    }

    // Finalize MP4
    updateLocalProgress(totalFrames, totalFrames, 'Finalizing MP4...', '\u2014', '\u2014');
    muxer.finalize();

    // Blob from accumulated chunks. Blob can hold many GB (may spill to disk),
    // unlike ArrayBuffer which has a hard ~2GB-per-tab ceiling in Chromium.
    _localExport.resultBlob = new Blob(muxerChunks, { type: 'video/mp4' });
    // Освобождаем промежуточные чанки — Blob уже владеет копией данных (иначе на больших
    // видео гигабайты держатся в RAM дважды и копятся между прогонами).
    muxerChunks.length = 0;
    _localExport.muxerChunks = null;
    // Restore static box widths for viewport
    recalcStaticBoxWidths();
    showLocalExportDone();
    console.log('Local export complete, size:', (_localExport.resultBlob.size / (1024 * 1024)).toFixed(1), 'MB');
  }

  async function _encodeAudioForExport(muxer, audioBuffer, videoDuration) {
    var sampleRate = audioBuffer.sampleRate;
    var numberOfChannels = audioBuffer.numberOfChannels;
    var totalSamples = Math.min(audioBuffer.length, Math.ceil(videoDuration * sampleRate));
    console.log('Local export audio: starting encode, samples:', totalSamples, 'channels:', numberOfChannels, 'sampleRate:', sampleRate);

    var audioChunksAdded = 0;
    var audioEncoder = new AudioEncoder({
      output: function(chunk, meta) { muxer.addAudioChunk(chunk, meta); audioChunksAdded++; },
      error: function(e) { console.error('AudioEncoder error:', e); }
    });
    _localExport.audioEncoder = audioEncoder;

    // Check supported codec
    var codecToUse = 'mp4a.40.2';
    try {
      var support = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: sampleRate,
        numberOfChannels: numberOfChannels,
        bitrate: 128000,
      });
      console.log('Local export audio: mp4a.40.2 supported:', support.supported);
      if (!support.supported) {
        // Try opus as fallback (won't work in mp4 muxer but let's see)
        codecToUse = 'opus';
        console.log('Local export audio: falling back to opus');
      }
    } catch(e) {
      console.warn('Local export audio: isConfigSupported failed:', e);
    }

    audioEncoder.configure({
      codec: codecToUse,
      sampleRate: sampleRate,
      numberOfChannels: numberOfChannels,
      bitrate: 128000,
    });
    console.log('Local export audio: encoder configured with codec:', codecToUse);

    var chunkSize = 1024;
    var encodedChunks = 0;
    for (var offset = 0; offset < totalSamples; offset += chunkSize) {
      if (_localExport.cancelled) break;
      var len = Math.min(chunkSize, totalSamples - offset);

      var data = new Float32Array(len * numberOfChannels);
      for (var ch = 0; ch < numberOfChannels; ch++) {
        var chData = audioBuffer.getChannelData(ch);
        var dstOff = ch * len;
        for (var i = 0; i < len; i++) {
          var srcIdx = offset + i;
          data[dstOff + i] = srcIdx < chData.length ? chData[srcIdx] : 0;
        }
      }

      try {
        var audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: sampleRate,
          numberOfFrames: len,
          numberOfChannels: numberOfChannels,
          timestamp: Math.round(offset / sampleRate * 1000000),
          data: data,
        });
        audioEncoder.encode(audioData);
        audioData.close();
        encodedChunks++;
      } catch(e) {
        console.error('Local export audio: encode error at offset', offset, e);
        break;
      }

      while (audioEncoder.encodeQueueSize > 20) {
        await new Promise(function(r) { setTimeout(r, 1); });
      }

      if (offset % (chunkSize * 100) === 0) {
        var audioPct = Math.round(offset / totalSamples * 100);
        updateLocalProgress(0, 0, 'Encoding audio... ' + audioPct + '%', '\u2014', '\u2014');
        await new Promise(function(r) { setTimeout(r, 0); });
      }
    }

    console.log('Local export audio: flushing encoder, encoded chunks:', encodedChunks, 'output chunks to muxer:', audioChunksAdded);
    await audioEncoder.flush();
    console.log('Local export audio: flush done, total muxer chunks:', audioChunksAdded);
    audioEncoder.close();
  }


  // Extract raw audio samples from MP4 using mp4box.js (no encoding/decoding)
  function _extractAudioFromMP4(file) {
    return new Promise(function(resolve, reject) {
      var mp4box = MP4Box.createFile();
      var audioTrack = null;
      var audioSamples = [];
      var decoderConfig = null;
      var totalExpected = 0;
      var resolved = false;

      function tryResolve() {
        if (resolved) return;
        if (!audioTrack) { resolved = true; resolve(null); return; }
        // Resolve when we got all expected samples (or close enough)
        if (audioSamples.length >= totalExpected) {
          resolved = true;
          console.log('Local export: all audio samples collected:', audioSamples.length);
          resolve({
            info: {
              codec: audioTrack.codec,
              sampleRate: audioTrack.audio.sample_rate,
              channels: audioTrack.audio.channel_count,
              decoderConfig: decoderConfig,
            },
            samples: audioSamples,
          });
        }
      }

      mp4box.onReady = function(info) {
        for (var i = 0; i < info.tracks.length; i++) {
          if (info.tracks[i].type === 'audio') {
            audioTrack = info.tracks[i];
            break;
          }
        }
        if (!audioTrack) {
          console.log('Local export: no audio track found in MP4');
          tryResolve();
          return;
        }
        totalExpected = audioTrack.nb_samples;
        console.log('Local export: found audio track, id:', audioTrack.id,
          'codec:', audioTrack.codec, 'sampleRate:', audioTrack.audio.sample_rate,
          'channels:', audioTrack.audio.channel_count, 'samples:', totalExpected);

        // Get AudioSpecificConfig for AAC descriptor
        var trak = mp4box.getTrackById(audioTrack.id);
        if (trak && trak.mdia && trak.mdia.minf && trak.mdia.minf.stbl && trak.mdia.minf.stbl.stsd) {
          var entry = trak.mdia.minf.stbl.stsd.entries[0];
          if (entry && entry.esds && entry.esds.esd && entry.esds.esd.descs) {
            var descs = entry.esds.esd.descs;
            for (var d = 0; d < descs.length; d++) {
              if (descs[d].tag === 0x05 && descs[d].data) {
                decoderConfig = { description: new Uint8Array(descs[d].data) };
                console.log('Local export: got AudioSpecificConfig, length:', decoderConfig.description.length);
                break;
              }
            }
          }
        }

        mp4box.setExtractionOptions(audioTrack.id, null, { nbSamples: 5000 });
        mp4box.start();
      };

      mp4box.onSamples = function(trackId, user, samples) {
        for (var i = 0; i < samples.length; i++) {
          var s = samples[i];
          audioSamples.push({
            data: new Uint8Array(s.data),
            timestamp: Math.round(s.cts * 1000000 / s.timescale),
            duration: Math.round(s.duration * 1000000 / s.timescale),
            isKeyframe: s.is_sync,
          });
        }
        console.log('Local export: got samples batch, total so far:', audioSamples.length, '/', totalExpected);
        tryResolve();
      };

      mp4box.onError = function(e) {
        console.error('mp4box error:', e);
        if (!resolved) { resolved = true; reject(e); }
      };

      // Safety timeout — if samples don't arrive within 15s, resolve with what we have
      setTimeout(function() {
        if (!resolved) {
          console.warn('Local export: audio extraction timeout, got', audioSamples.length, '/', totalExpected);
          resolved = true;
          if (audioTrack && audioSamples.length > 0) {
            resolve({
              info: {
                codec: audioTrack.codec,
                sampleRate: audioTrack.audio.sample_rate,
                channels: audioTrack.audio.channel_count,
                decoderConfig: decoderConfig,
              },
              samples: audioSamples,
            });
          } else {
            resolve(null);
          }
        }
      }, 15000);

      // Read file and feed to mp4box
      var reader = new FileReader();
      reader.onload = function() {
        var buf = reader.result;
        buf.fileStart = 0;
        mp4box.appendBuffer(buf);
        mp4box.flush();
      };
      reader.onerror = function() { if (!resolved) { resolved = true; reject(reader.error); } };
      reader.readAsArrayBuffer(file);
    });
  }


  // ===== START =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
