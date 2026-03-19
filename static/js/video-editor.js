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
    csvFile: null,
    csvId: null,
    csvData: [],            // [{t, speed, maxSpeed, voltage, temperature, current, battery, mileage, pwm, power, gps, timestamp}, ...]
    csvDuration: 0,
    timeOffset: 0,          // seconds: CSV start relative to video start
    timelineOrigin: 0,      // seconds: shift to keep all content at positive pixel positions
    csvTrimStart: 0,        // seconds from CSV start
    csvTrimEnd: 0,          // seconds from CSV start (=csvDuration initially)
    vboFile: null,
    vboId: null,
    vboData: null,
    vboDuration: 0,
    vboTimeOffset: 0,
    vboTrimStart: 0,
    vboTrimEnd: 0,
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
    iconImages: {},
  };

  // ===== SETTINGS (mirrors Python text_settings) =====
  const settings = {
    font_size: 22,
    vertical_position: 1,
    horizontal_position: 50,
    top_padding: 14,
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
    window.addEventListener('resize', resizeCanvases);
  }

  // ===== SETTINGS BINDING =====
  function bindSettings() {
    // Text tab sliders
    const sliders = [
      { id: 'fontSize', key: 'font_size', valId: 'valFontSize' },
      { id: 'verticalPosition', key: 'vertical_position', valId: 'valVertPos' },
      { id: 'horizontalPosition', key: 'horizontal_position', valId: 'valHorizPos' },
      { id: 'topPadding', key: 'top_padding', valId: 'valTopPad' },
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
    ];

    checks.forEach(function(c) {
      const el = document.getElementById(c.id);
      if (!el) return;
      el.checked = settings[c.key];
      el.addEventListener('change', function() {
        settings[c.key] = this.checked;
        renderOverlayOnce();
      });
    });
  }

  // ===== BUTTON BINDINGS =====
  function bindButtons() {
    // Video upload
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
    if (dom.btnTrimCropLeft) dom.btnTrimCropLeft.addEventListener('click', function() { cropCSVLeft(); });
    if (dom.btnTrimCropRight) dom.btnTrimCropRight.addEventListener('click', function() { cropCSVRight(); });
    if (dom.vboBtnTrimCropLeft) dom.vboBtnTrimCropLeft.addEventListener('click', function() { cropVBOLeft(); });
    if (dom.vboBtnTrimCropRight) dom.vboBtnTrimCropRight.addEventListener('click', function() { cropVBORight(); });
    if (dom.btnTrimToggle) {
      dom.btnTrimToggle.addEventListener('click', function() {
        state.trimMode = !state.trimMode;
        dom.btnTrimToggle.classList.toggle('trim-active', state.trimMode);
        updateTrimVisibility();
        updateTrimArrows();
      });
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
      if (e.code === 'ArrowLeft') { e.preventDefault(); dom.video.currentTime = Math.max(0, dom.video.currentTime - 1 / state.videoMeta.fps); }
      if (e.code === 'ArrowRight') { e.preventDefault(); dom.video.currentTime = Math.min(dom.video.duration, dom.video.currentTime + 1 / state.videoMeta.fps); }
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

  // ===== VIDEO HANDLING =====
  function handleVideoFile(file) {
    state.videoFile = file;
    // Local playback immediately
    var url = URL.createObjectURL(file);
    dom.video.src = url;
    dom.video.style.display = 'block';
    dom.canvas.style.display = 'block';
    if (dom.placeholder) dom.placeholder.style.display = 'none';

    dom.video.addEventListener('loadedmetadata', function onMeta() {
      dom.video.removeEventListener('loadedmetadata', onMeta);
      state.videoMeta.duration = dom.video.duration;
      state.videoMeta.width = dom.video.videoWidth;
      state.videoMeta.height = dom.video.videoHeight;
      // Estimate FPS (default 30)
      state.videoMeta.fps = 30;
      dom.totalTime.textContent = formatTime(dom.video.duration);
      resizeCanvases();
      generateThumbnails();
      // Full timeline refresh — recalculates pxPerSecond with correct video duration
      // Fixes race condition when CSV was loaded before video metadata was ready
      refreshTimeline();
      renderOverlayOnce();
      checkExportReady();
    });

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

    // Step 1: Initialize upload
    fetch('/video-editor/upload-video-init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        totalSize: file.size,
        totalChunks: totalChunks
      })
    })
    .then(function(resp) {
      if (!resp.ok) return resp.json().then(function(d) { throw new Error(d.error || 'Init failed'); });
      return resp.json();
    })
    .then(function(data) {
      uploadId = data.upload_id;
      return sendChunk(0);
    })
    .then(function() {
      return fetch('/video-editor/upload-video-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_id: uploadId })
      });
    })
    .then(function(resp) {
      if (!resp.ok) throw new Error('Complete failed: ' + resp.status);
      return resp.json();
    })
    .then(function(data) {
      dom.videoUploadProgress.style.display = 'none';
      state.videoId = data.video_id;
      state.videoUploaded = true;
      checkExportReady();
    })
    .catch(function(err) {
      dom.videoUploadProgress.style.display = 'none';
      alert('Video upload failed: ' + err.message);
    });

    function sendChunk(index) {
      if (index >= totalChunks) return Promise.resolve();
      return sendChunkWithRetry(index, 0);
    }

    function sendChunkWithRetry(index, attempt) {
      var start = index * CHUNK_SIZE;
      var end = Math.min(start + CHUNK_SIZE, file.size);
      var blob = file.slice(start, end);

      return new Promise(function(resolve, reject) {
        var formData = new FormData();
        formData.append('upload_id', uploadId);
        formData.append('chunk_index', index);
        formData.append('chunk', blob, 'chunk_' + index);

        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/video-editor/upload-video-chunk', true);
        xhr.timeout = 120000; // 2 min timeout per chunk

        xhr.upload.addEventListener('progress', function(e) {
          if (e.lengthComputable) {
            updateProgress(index, e.loaded / e.total);
          }
        });

        xhr.addEventListener('load', function() {
          if (xhr.status === 200) {
            resolve();
          } else {
            reject(new Error('Chunk ' + index + ' failed: ' + xhr.statusText));
          }
        });

        xhr.addEventListener('error', function() {
          reject(new Error('Chunk ' + index + ' network error'));
        });

        xhr.addEventListener('timeout', function() {
          reject(new Error('Chunk ' + index + ' timeout'));
        });

        xhr.send(formData);
      }).then(function() {
        return sendChunk(index + 1);
      }).catch(function(err) {
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
        video.currentTime = 0;
        // All thumbnails generated — update strip width to match actual video duration
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
    fetch('/video-editor/upload-csv', { method: 'POST', body: formData })
      .then(function(r) { return r.json(); })
      .then(function(data) { state.csvId = data.csv_id; checkExportReady(); })
      .catch(function(err) { console.error('CSV upload failed:', err); });
  }

  function parseCSV(text) {
    var lines = text.split('\n');
    if (lines.length < 2) return;

    // Parse header
    var header = lines[0].split(',').map(function(h) { return h.trim().replace(/"/g, ''); });

    // Detect CSV type
    var type = detectCSVType(header);
    if (!type) { alert('Unrecognized CSV format'); return; }

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

    // Compute running max speed
    var runMax = 0;
    for (var k = 0; k < data.length; k++) {
      if (data[k].speed > runMax) runMax = data[k].speed;
      data[k].maxSpeed = runMax;
    }

    state.csvData = data;
    state.csvDuration = data.length > 0 ? data[data.length - 1].t : 0;
    state.csvTrimStart = 0;
    state.csvTrimEnd = state.csvDuration;

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
    var point = { timestamp: 0, speed: 0, voltage: 0, temperature: 0, current: 0, battery: 0, mileage: 0, pwm: 0, power: 0, gps: 0 };
    try {
      if (type === 'darknessbot') {
        point.timestamp = parseDarknessBotTimestamp(row['Date']);
        point.speed = safeFloat(row['Speed']);
        point.voltage = safeFloat(row['Voltage']);
        point.temperature = safeFloat(row['Temperature'] || 0);
        point.current = safeFloat(row['Current'] || 0);
        point.battery = safeFloat(row['Battery level'] || 0);
        point.mileage = safeFloat(row['Total mileage'] || 0);
        point.pwm = safeFloat(row['PWM'] || 0);
        point.power = safeFloat(row['Power'] || 0);
        point.gps = safeFloat(row['GPS Speed'] || 0);
      } else if (type === 'eucworld') {
        // EUC World: ISO 8601 datetime with timezone
        var dt = new Date(row['datetime']);
        point.timestamp = dt.getTime() / 1000;
        point.speed = safeFloat(row['speed']);
        point.voltage = safeFloat(row['voltage']);
        point.temperature = safeFloat(row['temp'] || 0);
        point.current = safeFloat(row['current'] || 0);
        point.battery = safeFloat(row['battery'] || 0);
        point.mileage = safeFloat(row['distance_total'] || row['distance'] || 0);
        point.pwm = 100 - safeFloat(row['safety_margin'] || 100);
        point.power = safeFloat(row['power'] || 0);
        point.gps = safeFloat(row['gps_speed'] || 0);
      } else if (type === 'wheellog') {
        point.timestamp = parseWheelLogTimestamp(row['date'], row['time']);
        point.speed = safeFloat(row['speed']);
        point.voltage = safeFloat(row['voltage']);
        point.temperature = safeFloat(row['system_temp'] || 0);
        point.current = safeFloat(row['current'] || 0);
        point.battery = safeFloat(row['battery_level'] || 0);
        point.mileage = safeFloat(row['totaldistance'] || 0) / 1000;
        point.pwm = safeFloat(row['pwm'] || 0);
        point.power = safeFloat(row['power'] || 0);
        point.gps = safeFloat(row['gps_speed'] || 0);
      }
      if (isNaN(point.timestamp) || point.timestamp === null) return null;
      return point;
    } catch (e) {
      return null;
    }
  }

  function parseDarknessBotTimestamp(dateStr) {
    if (!dateStr) return null;
    // Format: DD.MM.YYYY HH:MM:SS.fff
    var parts = dateStr.split(' ');
    if (parts.length < 2) return null;
    var dp = parts[0].split('.');
    var tp = parts[1].split(':');
    if (dp.length < 3 || tp.length < 3) return null;
    var secParts = tp[2].split('.');
    var sec = parseInt(secParts[0]);
    var ms = secParts.length > 1 ? parseInt(secParts[1]) : 0;
    var d = new Date(parseInt(dp[2]), parseInt(dp[1]) - 1, parseInt(dp[0]),
                     parseInt(tp[0]), parseInt(tp[1]), sec, ms);
    return d.getTime() / 1000;
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

  // ===== TIMELINE HELPERS =====
  function getTimelineDuration() {
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
    var videoTime = dom.video.currentTime || 0;
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
      var thumbW = videoWidth / thumbs.length;
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
    var csvWidthPx = Math.max(20, state.csvDuration * pxPerSec);
    // Position CSV track (uses timelineOrigin to avoid negative positions)
    updateCSVTrackPosition();
    dom.csvTrack.style.width = csvWidthPx + 'px';

    var canvas = dom.csvWaveform;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = csvWidthPx * dpr;
    canvas.height = 50 * dpr;
    canvas.style.width = csvWidthPx + 'px';
    canvas.style.height = '50px';
    var ctx = dom.csvWaveformCtx;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, csvWidthPx, 50);

    var h = 50;
    var data = state.csvData;
    var maxPWM = 100;
    var maxSpeed = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i].speed > maxSpeed) maxSpeed = data[i].speed;
    }
    if (maxSpeed === 0) maxSpeed = 1;

    // Draw trimmed regions (dimmed overlay)
    var trimLeftPx = (state.csvTrimStart / state.csvDuration) * csvWidthPx;
    var trimRightPx = (state.csvTrimEnd / state.csvDuration) * csvWidthPx;

    // Draw PWM as red filled area
    ctx.fillStyle = 'rgba(180, 40, 40, 0.6)';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (var j = 0; j < data.length; j++) {
      var x = (data[j].t / state.csvDuration) * csvWidthPx;
      var y = h - (Math.min(data[j].pwm, maxPWM) / maxPWM) * h;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(csvWidthPx, h);
    ctx.closePath();
    ctx.fill();

    // Draw Speed as blue line
    ctx.strokeStyle = 'rgba(60, 130, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var k = 0; k < data.length; k++) {
      var sx = (data[k].t / state.csvDuration) * csvWidthPx;
      var sy = h - (data[k].speed / maxSpeed) * h;
      if (k === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // Dim trimmed-out regions
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    if (trimLeftPx > 0) {
      ctx.fillRect(0, 0, trimLeftPx, h);
    }
    if (trimRightPx < csvWidthPx) {
      ctx.fillRect(trimRightPx, 0, csvWidthPx - trimRightPx, h);
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
    state.csvDuration -= tStart;
    state.csvTrimEnd -= tStart;
    state.csvTrimStart = 0;
    preserveScaleAndRefresh(oldPps);
  }

  function cropCSVRight() {
    if (state.csvData.length === 0 || state.csvTrimEnd >= state.csvDuration) return;
    var tEnd = state.csvTrimEnd;
    var oldPps = getPxPerSecond();
    state.csvData = state.csvData.filter(function(d) { return d.t <= tEnd; });
    state.csvDuration = tEnd;
    state.csvTrimEnd = tEnd;
    preserveScaleAndRefresh(oldPps);
  }

  function cropVBOLeft() {
    if (!state.vboData || state.vboData.length === 0 || state.vboTrimStart <= 0) return;
    var tStart = state.vboTrimStart;
    var oldPps = getPxPerSecond();
    state.vboData = state.vboData.filter(function(d) { return d.t >= tStart; });
    state.vboData.forEach(function(d) { d.t -= tStart; });
    state.vboTimeOffset += tStart;
    state.vboDuration -= tStart;
    state.vboTrimEnd -= tStart;
    state.vboTrimStart = 0;
    preserveScaleAndRefresh(oldPps);
  }

  function cropVBORight() {
    if (!state.vboData || state.vboData.length === 0 || state.vboTrimEnd >= state.vboDuration) return;
    var tEnd = state.vboTrimEnd;
    var oldPps = getPxPerSecond();
    state.vboData = state.vboData.filter(function(d) { return d.t <= tEnd; });
    state.vboDuration = tEnd;
    state.vboTrimEnd = tEnd;
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
    state.csvData = newData;
    state.csvDuration = newData[newData.length - 1].t;
    state.csvTrimStart = 0;
    state.csvTrimEnd = state.csvDuration;
    preserveScaleAndRefresh(oldPps);
  }

  // ===== TIMELINE =====
  function bindTimeline() {
    // Playhead dragging
    var phDragging = false;
    document.querySelectorAll('.ve-playhead-handle, .ve-playhead-grab').forEach(function(h) {
      h.addEventListener('mousedown', function(e) {
        if (!dom.video.src) return;
        phDragging = true;
        e.preventDefault();
        e.stopPropagation();
      });
    });
    document.addEventListener('mousemove', function(e) {
      if (!phDragging) return;
      // Use playhead bar for coordinate calculation (handle lives there)
      var barEl = dom.playheadBarContent;
      if (!barEl) return;
      var rect = barEl.getBoundingClientRect();
      var clickX = e.clientX - rect.left + barEl.scrollLeft;
      var pps = getPxPerSecond();
      var t = clickX / pps - state.timelineOrigin;
      dom.video.currentTime = Math.max(0, Math.min(t, dom.video.duration || 0));
    });
    document.addEventListener('mouseup', function() { phDragging = false; });

    // Click on playhead bar to seek
    if (dom.playheadBarContent) {
      dom.playheadBarContent.addEventListener('click', function(e) {
        if (!dom.video.src) return;
        var rect = dom.playheadBarContent.getBoundingClientRect();
        var clickX = e.clientX - rect.left + dom.playheadBarContent.scrollLeft;
        var pps = getPxPerSecond();
        var t = clickX / pps - state.timelineOrigin;
        dom.video.currentTime = Math.max(0, Math.min(t, dom.video.duration || 0));
      });
    }

    // Click on video track to seek
    if (dom.videoTrackContent) {
      dom.videoTrackContent.addEventListener('click', function(e) {
        if (!dom.video.src) return;
        var rect = dom.videoTrackContent.getBoundingClientRect();
        var clickX = e.clientX - rect.left + dom.videoTrackContent.scrollLeft;
        var pps = getPxPerSecond();
        var t = clickX / pps - state.timelineOrigin;
        dom.video.currentTime = Math.max(0, Math.min(t, dom.video.duration));
      });
    }

    // CSV track dragging
    if (dom.csvTrack) {
      dom.csvTrack.addEventListener('mousedown', function(e) {
        if (e.target === dom.trimLeft) {
          state.dragging = 'trimLeft';
          state.dragStartTrimStart = state.csvTrimStart;
        } else if (e.target === dom.trimRight) {
          state.dragging = 'trimRight';
          state.dragStartTrimEnd = state.csvTrimEnd;
        } else {
          state.dragging = 'csv';
          state._frozenPps = getPxPerSecond(); // freeze scale during drag
        }
        state.dragStartX = e.clientX;
        state.dragStartOffset = state.timeOffset;
        e.preventDefault();
      });
    }

    // VBO track dragging
    var vboTrackEl = document.getElementById('vboTrack');
    if (vboTrackEl) {
      vboTrackEl.addEventListener('mousedown', function(e) {
        if (e.target === dom.vboTrimLeft) {
          state.dragging = 'vboTrimLeft';
          state.dragStartVboTrimStart = state.vboTrimStart;
        } else if (e.target === dom.vboTrimRight) {
          state.dragging = 'vboTrimRight';
          state.dragStartVboTrimEnd = state.vboTrimEnd;
        } else {
          state.dragging = 'vbo';
          state._frozenPps = getPxPerSecond(); // freeze scale during drag
        }
        state.dragStartX = e.clientX;
        state.dragStartVboOffset = state.vboTimeOffset;
        e.preventDefault();
      });
    }

    document.addEventListener('mousemove', function(e) {
      if (!state.dragging) return;
      var pxPerSec = getPxPerSecond();
      if (pxPerSec <= 0) return;
      var dx = e.clientX - state.dragStartX;
      var dtSec = dx / pxPerSec;

      if (state.dragging === 'csv') {
        // Move entire CSV track — only position changes, never width
        state.timeOffset = state.dragStartOffset + dtSec;
        updateCSVTrackPosition();
        // NOTE: don't call updatePlayheads() here — timeOffset change alters
        // pxPerSecond which would make the playhead jump even though video time hasn't changed
        // Throttle heavy overlay render to rAF
        if (!state._dragRaf) {
          state._dragRaf = requestAnimationFrame(function() {
            state._dragRaf = null;
            renderOverlayOnce();
          });
        }
      } else if (state.dragging === 'trimLeft') {
        var newStart = state.dragStartTrimStart + dtSec;
        state.csvTrimStart = Math.max(0, Math.min(newStart, state.csvTrimEnd - 0.5));
        // Throttle waveform redraw — only update trim handles immediately
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
        // Throttle waveform redraw — only update trim handles immediately
        updateTrimHandles(state.csvDuration * getPxPerSecond());
        if (!state._dragRaf) {
          state._dragRaf = requestAnimationFrame(function() {
            state._dragRaf = null;
            renderWaveform();
          });
        }
      } else if (state.dragging === 'vbo') {
        state.vboTimeOffset = state.dragStartVboOffset + dtSec;
        // Just move the track element, don't re-render waveform (like CSV updateCSVTrackPosition)
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
    });

    document.addEventListener('mouseup', function() {
      if (state.dragging) {
        var wasDragging = state.dragging;
        state.dragging = null;
        // Unfreeze pps: adjust zoomLevel to maintain the same visual scale
        if (state._frozenPps) {
          var frozenPps = state._frozenPps;
          state._frozenPps = null;
          var newBase = getBasePxPerSecond();
          if (newBase > 0) state.zoomLevel = frozenPps / newBase;
        }
        // Only refresh waveforms, NOT timeline scale
        if (wasDragging === 'csv' || wasDragging === 'vbo') {
          renderWaveform();
          renderVBOWaveform();
          updateVboTrimHandles();
          renderOverlayOnce();
        } else {
          // Trim handle drags — refresh waveforms
          renderWaveform();
          renderVBOWaveform();
          updateVboTrimHandles();
          renderOverlayOnce();
        }
      }
    });
  }

  function drawRuler() {
    if (!dom.rulerCanvas) return;
    var canvas = dom.rulerCanvas;
    var viewportW = canvas.parentElement.clientWidth;
    var w = viewportW * state.zoomLevel;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = 24 * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = '24px';
    var ctx = dom.rulerCtx;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, 24);

    var dur = getTimelineDuration();
    if (dur <= 0) return;

    // Adaptive tick interval - ensure ~70px between labels
    var pxPerSec = w / dur;
    var tickSec = 1;
    var cands = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    for (var ci = 0; ci < cands.length; ci++) {
      tickSec = cands[ci];
      if (cands[ci] * pxPerSec >= 70) break;
    }

    ctx.fillStyle = '#8e959e';
    ctx.font = '10px sans-serif';
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1;

    for (var t = 0; t <= dur; t += tickSec) {
      var x = (t / dur) * w;
      ctx.beginPath();
      ctx.moveTo(x, 16);
      ctx.lineTo(x, 24);
      ctx.stroke();
      ctx.fillText(formatTime(t), x + 2, 14);
    }
  }

  function updatePlayheads() {
    if (!dom.video.src) return;
    var dur = getTimelineDuration();
    if (dur <= 0) return;
    var pxPerSec = getPxPerSecond();
    var px = (dom.video.currentTime + state.timelineOrigin) * pxPerSec;

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
    var pos = rulerLeft - scrollOff + 120;
    // Hide when playhead is outside the visible track area (behind labels or off-screen right)
    var tracksW = dom.playheadLine.parentElement ? dom.playheadLine.parentElement.clientWidth : 9999;
    if (pos < 120 || pos > tracksW) {
      dom.playheadLine.style.display = 'none';
    } else {
      dom.playheadLine.style.display = '';
      dom.playheadLine.style.left = pos + 'px';
    }
  }

  // ===== PLAYBACK =====
  function togglePlay() {
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
    if (!dom.ctx || !dom.video.src) return;
    var ctx = dom.ctx;
    var cw = dom.canvas.width;
    var ch = dom.canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    // Draw video frame onto canvas
    ctx.drawImage(dom.video, 0, 0, cw, ch);

    if (state.csvData.length === 0) return;

    // Get data for current time
    var dataPoint = getDataAtTime(dom.video.currentTime);
    if (!dataPoint) return;

    // Debug overlay (toggled via Elements > Debug Info checkbox)
    if (settings.debug_overlay) {
      ctx.save();
      var dbgSf = cw / 1920;
      var dbgFs = Math.max(16, Math.round(28 * dbgSf));
      var ln = Math.round(dbgFs * 1.4);
      ctx.font = 'bold ' + dbgFs + 'px monospace';
      var dbY = ch - ln * 4.5;
      // Background for readability
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, dbY - dbgFs, cw, ln * 4.5 + 4);
      ctx.fillStyle = '#ffff00';
      ctx.fillText('videoTime=' + dom.video.currentTime.toFixed(2) + '  timeOffset=' + state.timeOffset.toFixed(2) + '  csvTime=' + (dom.video.currentTime - state.timeOffset).toFixed(2), 8, dbY);
      ctx.fillText('speed=' + dataPoint.speed.toFixed(1) + '  pwm=' + dataPoint.pwm.toFixed(1) + '  t=' + dataPoint.t.toFixed(2) + '  csvDur=' + state.csvDuration.toFixed(1), 8, dbY + ln);
      ctx.fillText('idx=' + (dataPoint._dbgLo || 0) + '/' + (dataPoint._dbgTotal || 0) + '  lo.spd=' + (dataPoint._dbgLoSpeed != null ? dataPoint._dbgLoSpeed.toFixed(1) : '?') + '  hi.spd=' + (dataPoint._dbgHiSpeed != null ? dataPoint._dbgHiSpeed.toFixed(1) : '?'), 8, dbY + ln * 2);
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
      ctx.fillText('trimS=' + state.csvTrimStart.toFixed(1) + ' trimE=' + state.csvTrimEnd.toFixed(1) + ' zoom=' + state.zoomLevel.toFixed(2) + '  ' + nnzInfo, 8, dbY + ln * 3);
      ctx.restore();
    }

    // Draw telemetry boxes
    drawTelemetryBoxes(ctx, cw, ch, dataPoint);

    // Draw speed indicator
    if (settings.show_bottom_elements) {
      drawSpeedGauge(ctx, cw, ch, dataPoint.speed);
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
      // Linear interpolation
      var factor = (csvTime - data[lo].t) / (data[hi].t - data[lo].t);
      result = {
        t: csvTime,
        speed: lerp(data[lo].speed, data[hi].speed, factor),
        maxSpeed: Math.max(data[lo].maxSpeed, data[hi].maxSpeed),
        voltage: lerp(data[lo].voltage, data[hi].voltage, factor),
        temperature: lerp(data[lo].temperature, data[hi].temperature, factor),
        current: lerp(data[lo].current, data[hi].current, factor),
        battery: lerp(data[lo].battery, data[hi].battery, factor),
        mileage: lerp(data[lo].mileage, data[hi].mileage, factor),
        pwm: lerp(data[lo].pwm, data[hi].pwm, factor),
        power: lerp(data[lo].power, data[hi].power, factor),
        gps: lerp(data[lo].gps, data[hi].gps, factor),
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

  // ===== TELEMETRY BOX RENDERING =====
  function drawTelemetryBoxes(ctx, cw, ch, dp) {
    // Scale factor: settings are in design units, backend always renders at 4K (3840x2160)
    var sf = cw / 1920;
    var fontSize = settings.font_size * sf;
    var topPad = settings.top_padding * sf;
    var boxH = settings.bottom_padding * sf;
    var spacing = settings.spacing * sf;
    var radius = settings.border_radius * sf;
    var vertPos = settings.vertical_position;
    var horizPos = settings.horizontal_position;

    var font = fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    var boldFont = 'bold ' + font;
    ctx.font = font;

    // Build params array
    var params = [];
    if (settings.show_speed) params.push({ label: LOC.speed, value: Math.round(dp.speed) + '', unit: LOC.units.speed, key: 'pwm_check_no' });
    if (settings.show_max_speed) params.push({ label: LOC.max_speed, value: Math.round(dp.maxSpeed) + '', unit: LOC.units.speed });
    if (settings.show_gps) params.push({ label: LOC.gps, value: Math.round(dp.gps) + '', unit: LOC.units.speed });
    if (settings.show_voltage) params.push({ label: LOC.voltage, value: dp.voltage.toFixed(1), unit: LOC.units.voltage });
    if (settings.show_temp) params.push({ label: LOC.temp, value: Math.round(dp.temperature) + '', unit: LOC.units.temp });
    if (settings.show_battery) params.push({ label: LOC.battery, value: Math.round(dp.battery) + '', unit: LOC.units.battery, isBattery: true });
    if (settings.show_mileage) params.push({ label: LOC.mileage, value: Math.round(dp.mileage) + '', unit: LOC.units.mileage });
    if (settings.show_pwm) params.push({ label: LOC.pwm, value: Math.round(dp.pwm) + '', unit: LOC.units.pwm, isPWM: true });
    if (settings.show_power) params.push({ label: LOC.power, value: Math.round(dp.power) + '', unit: LOC.units.power });
    if (settings.show_current) params.push({ label: LOC.current, value: dp.current.toFixed(1), unit: LOC.units.current });
    if (settings.show_time) {
      var d = new Date(dp.timestamp * 1000);
      var ts = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
      params.push({ label: LOC.time, value: ts, unit: '' });
    }
    if (settings.show_dragy_speed && state.vboData) {
      var dragySpeed = getDragySpeedAtTime(dp.t);
      params.push({ label: LOC.dragy_speed, value: Math.round(dragySpeed) + '', unit: LOC.units.speed });
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
      var textW = (settings.use_icons ? iconSize + iconSpacing : labelW) + valueW + unitW;
      var boxW = textW + 2 * topPad;
      boxes.push({ param: p, textW: textW, boxW: boxW });
    });

    // Position boxes
    var yPos, xPos;

    if (settings.vertical_layout) {
      var totalH = params.length * boxH + (params.length - 1) * spacing;
      yPos = (ch * vertPos / 100) - totalH / 2;
      xPos = (cw * horizPos / 100);

      boxes.forEach(function(b, i) {
        var by = yPos + i * (boxH + spacing);
        drawSingleBox(ctx, xPos, by, b.boxW, boxH, radius, b.param, b.textW, topPad, fontSize, sf, iconSize, iconSpacing, boldFont, font);
      });
    } else {
      var totalW = 0;
      boxes.forEach(function(b) { totalW += b.boxW; });
      totalW += (boxes.length - 1) * spacing;
      xPos = (cw - totalW) / 2;
      yPos = ch * vertPos / 100;

      boxes.forEach(function(b) {
        drawSingleBox(ctx, xPos, yPos, b.boxW, boxH, radius, b.param, b.textW, topPad, fontSize, sf, iconSize, iconSpacing, boldFont, font);
        xPos += b.boxW + spacing;
      });
    }
  }

  function drawSingleBox(ctx, x, y, w, h, radius, param, textW, topPad, fontSize, sf, iconSize, iconSpacing, boldFont, normalFont) {
    // Determine box color
    var boxColor = 'rgba(0,0,0,0.7)';
    var textColor = '#ffffff';

    if (param.isPWM) {
      var pwm = parseInt(param.value);
      if (pwm > 90) { boxColor = 'rgba(255,0,0,0.9)'; textColor = '#000000'; }
      else if (pwm >= 80) { boxColor = 'rgba(255,255,0,0.9)'; textColor = '#000000'; }
    }
    if (param.isBattery) {
      var bat = parseInt(param.value);
      if (bat < 10) { boxColor = 'rgba(255,0,0,0.9)'; textColor = '#000000'; }
      else if (bat <= 30) { boxColor = 'rgba(255,255,0,0.9)'; textColor = '#000000'; }
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
    var textY = y + h / 2 + fontSize * 0.35;

    ctx.fillStyle = textColor;

    if (settings.use_icons) {
      // Draw icon placeholder (filled circle as placeholder)
      var iconY = y + (h - iconSize) / 2;
      ctx.fillStyle = textColor;
      ctx.beginPath();
      ctx.arc(textX + iconSize / 2, iconY + iconSize / 2, iconSize / 2 - 1, 0, Math.PI * 2);
      ctx.fill();

      // Try loading actual icon
      var iconName = LABEL_TO_ICON[param.label];
      if (iconName && state.iconImages[iconName]) {
        ctx.drawImage(state.iconImages[iconName], textX, iconY, iconSize, iconSize);
      } else if (iconName && !state.iconImages[iconName]) {
        loadIconImage(iconName);
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
    var img = new Image();
    img.onload = function() {
      state.iconImages[name] = img;
    };
    img.src = '/static/icons/icons_telemetry/' + name + '.png';
    // Set placeholder to prevent re-loading
    state.iconImages[name] = null;
  }

  // ===== SPEED GAUGE =====
  function drawSpeedGauge(ctx, cw, ch, speed) {
    var sf = cw / 1920;
    var baseSize = 250 * sf * (settings.indicator_scale / 100);
    var centerX = cw * settings.indicator_x / 100;
    var centerY = ch * settings.indicator_y / 100;
    var radius = baseSize / 2 - 10 * sf;
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
    var ready = state.videoUploaded && state.csvId;
    if (dom.btnExport) dom.btnExport.disabled = !ready;
  }

  function generateProjectName() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var id = '';
    for (var i = 0; i < 7; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    return 'VE-' + id;
  }

  function startExport() {
    if (!state.videoId || !state.csvId) {
      alert('Please upload both video and CSV first.');
      return;
    }

    var nameInput = document.getElementById('exportProjectName');
    var projectName = nameInput ? nameInput.value.trim() : '';
    if (!projectName) projectName = generateProjectName();

    var interpolateEl = document.getElementById('exportInterpolate');
    var interpolate = interpolateEl ? interpolateEl.checked : true;

    var payload = {
      video_id: state.videoId,
      csv_id: state.csvId,
      project_name: projectName,
      interpolate_values: interpolate,
      time_offset: state.timeOffset,
      csv_trim_start: state.csvTrimStart,
      csv_trim_end: state.csvTrimEnd,
      settings: settings,
      fps: dom.exportFPS.value,
      data_fps: dom.exportDataFPS.value,
      codec: dom.exportCodec.value,
      resolution: dom.exportResolution.value,
      vbo_id: state.vboId || null,
      vbo_time_offset: state.vboTimeOffset,
      vbo_trim_start: state.vboTrimStart,
      vbo_trim_end: state.vboTrimEnd,
    };

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
    fetch('/video-editor/upload-vbo', { method: 'POST', body: formData })
      .then(function(r) { return r.json(); })
      .then(function(data) { state.vboId = data.vbo_id; })
      .catch(function(err) { console.error('VBO upload failed:', err); });
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
      var rawVelocity = parseFloat(row['velocity'] || row['speed'] || 0);
      var speedKmh = velocityIsKmh ? rawVelocity : rawVelocity * 1.852;

      if (firstTime === null) firstTime = timeSec;

      data.push({
        t: timeSec - firstTime,
        timestamp: timeSec,
        speed: speedKmh
      });
    }

    console.log('parseVBO: parsed ' + data.length + ' points');
    if (data.length === 0) { console.warn('parseVBO: no data points!'); return; }

    state.vboData = data;
    state.vboDuration = data[data.length - 1].t;
    state.vboTrimStart = 0;
    state.vboTrimEnd = state.vboDuration;
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
    var vboWidthPx = Math.max(20, state.vboDuration * pxPerSec);

    // Position VBO track like CSV: left = offset, width = duration
    updateVBOTrackPosition();
    var vboTrackEl = document.getElementById('vboTrack');
    if (vboTrackEl) {
      vboTrackEl.style.width = vboWidthPx + 'px';
    }

    var canvas = dom.vboWaveformCanvas;
    var dpr = window.devicePixelRatio || 1;
    var canvasW = Math.min(vboWidthPx, 8000);
    var scaleRatio = canvasW / vboWidthPx; // for downscaled canvas
    canvas.width = canvasW * dpr;
    canvas.height = 50 * dpr;
    canvas.style.width = vboWidthPx + 'px';
    canvas.style.height = '50px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasW, 50);

    var h = 50;
    var data = state.vboData;
    var maxVal = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i].speed > maxVal) maxVal = data[i].speed;
    }
    if (maxVal === 0) maxVal = 1;

    var step = Math.max(1, Math.floor(data.length / 4000));

    // Draw speed as filled area (yellow) — LOCAL coordinates (like CSV)
    ctx.fillStyle = 'rgba(255, 193, 7, 0.3)';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (var i = 0; i < data.length; i += step) {
      var x = (data[i].t / state.vboDuration) * canvasW;
      var y = h - (data[i].speed / maxVal) * h;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(canvasW, h);
    ctx.closePath();
    ctx.fill();

    // Draw speed line
    ctx.strokeStyle = '#ffc107';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var i = 0; i < data.length; i += step) {
      var x = (data[i].t / state.vboDuration) * canvasW;
      var y = h - (data[i].speed / maxVal) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Dim trimmed-out regions
    if (state.vboTrimStart > 0 || state.vboTrimEnd < state.vboDuration) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      var trimLeftX = (state.vboTrimStart / state.vboDuration) * canvasW;
      var trimRightX = (state.vboTrimEnd / state.vboDuration) * canvasW;
      if (trimLeftX > 0) ctx.fillRect(0, 0, trimLeftX, h);
      if (trimRightX < canvasW) ctx.fillRect(trimRightX, 0, canvasW - trimRightX, h);
    }

    // Update VBO trim handles (like CSV updateTrimHandles)
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

  // ===== UTILITIES =====
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00:00';
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  updateTrimVisibility();

  // ===== START =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
