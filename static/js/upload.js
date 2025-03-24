document.getElementById('uploadForm').addEventListener('submit', function(e) {
    e.preventDefault();

    const projectNameInput = document.getElementById('projectName');
    const projectName = projectNameInput.value.trim();

    // Client-side validation
    if (projectName) {
        if (projectName.length > 7) {
            projectNameInput.classList.add('is-invalid');
            return;
        }
        if (!/^[\p{L}\d]+$/u.test(projectName)) {
            projectNameInput.classList.add('is-invalid');
            return;
        }
    }

    const formData = new FormData(this);
    const previewSection = document.getElementById('previewSection');
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');
    const videoProcessingInfo = document.getElementById('videoProcessingInfo');
    let projectId;

    // Show progress for upload, but not the video processing info
    progressDiv.classList.remove('d-none');
    videoProcessingInfo.classList.add('d-none');  // Ensure video processing info is hidden
    progressTitle.textContent = gettext('Uploading CSV...');

    // Disable form
    this.querySelectorAll('input, button').forEach(el => el.disabled = true);

    // Upload CSV and get preview
    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(gettext('Upload failed'));
        }
        return response.json();
    })
    .then(data => {
        if (data.error) throw new Error(data.error);

        projectId = data.project_id;
        
        // Get CSV time range info
        fetch(`/project_status/${projectId}`)
            .then(response => response.json())
            .then(projectData => {
                if (projectData.trim_start && projectData.trim_end) {
                    // Initialize time range variables
                    csvStartTime = projectData.trim_start;
                    csvEndTime = projectData.trim_end;
                    csvTotalDuration = projectData.total_duration;
                    
                    // Setup time range handlers
                    setupTimeRangeHandlers();
                }
            })
            .catch(error => {
                console.error('Error getting project time range:', error);
            });
            
        updatePreview(projectId);
    })
    .catch(error => {
        console.error('Error:', error);
        progressTitle.textContent = gettext('Error: ') + error.message;
        progressBar.classList.add('bg-danger');
        // Re-enable form
        this.querySelectorAll('input, button').forEach(el => el.disabled = false);
    });
});

// Function to enable all UI elements
function enableUIElements() {
    const previewSection = document.getElementById('previewSection');
    
    // Re-enable all controls in the preview section
    previewSection.querySelectorAll('input, button, select').forEach(el => {
        el.disabled = false;
    });
    
    // Re-enable time range elements
    const leftHandle = document.getElementById('leftHandle');
    const rightHandle = document.getElementById('rightHandle');
    const timeRangeSelection = document.getElementById('timeRangeSelection');
    
    if (leftHandle) leftHandle.style.pointerEvents = 'auto';
    if (rightHandle) rightHandle.style.pointerEvents = 'auto';
    if (timeRangeSelection) timeRangeSelection.style.pointerEvents = 'auto';
    
    // Re-enable collapsible card headers
    previewSection.querySelectorAll('[data-bs-toggle="collapse"]').forEach(el => {
        el.style.pointerEvents = 'auto';
    });
}

// Function to disable all UI elements
function disableUIElements() {
    const previewSection = document.getElementById('previewSection');
    
    // Disable all controls in the preview section
    previewSection.querySelectorAll('input, button, select').forEach(el => {
        el.disabled = true;
    });
    
    // Disable time range elements
    const leftHandle = document.getElementById('leftHandle');
    const rightHandle = document.getElementById('rightHandle');
    const timeRangeSelection = document.getElementById('timeRangeSelection');
    
    if (leftHandle) leftHandle.style.pointerEvents = 'none';
    if (rightHandle) rightHandle.style.pointerEvents = 'none';
    if (timeRangeSelection) timeRangeSelection.style.pointerEvents = 'none';
    
    // Disable collapsible card headers
    previewSection.querySelectorAll('[data-bs-toggle="collapse"]').forEach(el => {
        el.style.pointerEvents = 'none';
    });
}

// Function to update preview with current settings
function updatePreview(projectId) {
    const previewSection = document.getElementById('previewSection');
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');

    // Check resolution and adjust offsets if needed
    const resolution = document.querySelector('input[name="resolution"]:checked').value;
    if (resolution === '4k') {
        document.getElementById('speedY').value = -50;
        document.getElementById('speedYValue').textContent = '-50';
        document.getElementById('unitY').value = 65;
        document.getElementById('unitYValue').textContent = '65';
    } else {
        document.getElementById('speedY').value = -28;
        document.getElementById('speedYValue').textContent = '-28';
        document.getElementById('unitY').value = 36;
        document.getElementById('unitYValue').textContent = '36';
    }

    // Get current values with updated settings
    const settings = {
        resolution: resolution,
        vertical_position: document.getElementById('verticalPosition').value,
        top_padding: document.getElementById('topPadding').value,
        bottom_padding: document.getElementById('bottomPadding').value,
        spacing: document.getElementById('spacing').value,
        font_size: document.getElementById('fontSize').value,
        border_radius: document.getElementById('borderRadius').value,
        // Speed indicator settings
        indicator_scale: document.getElementById('indicatorScale').value,
        indicator_x: document.getElementById('indicatorX').value,
        indicator_y: document.getElementById('indicatorY').value,
        speed_y: document.getElementById('speedY').value,
        unit_y: document.getElementById('unitY').value,
        speed_size: document.getElementById('speedSize').value,
        unit_size: document.getElementById('unitSize').value,
        // Visibility settings
        show_speed: document.getElementById('showSpeed').checked,
        show_max_speed: document.getElementById('showMaxSpeed').checked,
        show_voltage: document.getElementById('showVoltage').checked,
        show_temp: document.getElementById('showTemp').checked,
        show_battery: document.getElementById('showBattery').checked,
        show_mileage: document.getElementById('showMileage').checked,
        show_pwm: document.getElementById('showPWM').checked,
        show_power: document.getElementById('showPower').checked,
        show_current: document.getElementById('showCurrent').checked,
        show_gps: document.getElementById('showGPS').checked,
        show_bottom_elements: document.getElementById('showBottomElements').checked
    };

    console.log('Sending preview settings:', settings);

    fetch(`/preview/${projectId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings)
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);

        // Show preview
        progressDiv.classList.add('d-none');
        previewSection.classList.remove('d-none');
        document.getElementById('previewImage').src = data.preview_url + '?t=' + new Date().getTime();

        // Re-enable form
        document.querySelectorAll('input, button').forEach(el => el.disabled = false);

        // Store project ID for the start processing button
        document.getElementById('startProcessButton').dataset.projectId = projectId;
    })
    .catch(error => {
        console.error('Error:', error);
        progressTitle.textContent = gettext('Error: ') + error.message;
        progressBar.classList.add('bg-danger');
        // Re-enable form
        document.querySelectorAll('input, button').forEach(el => el.disabled = false);
    });
}

// Add real-time validation for project name input
document.getElementById('projectName').addEventListener('input', function() {
    const value = this.value.trim();

    if (value === '') {
        // Empty value is valid (will generate automatic name)
        this.classList.remove('is-invalid');
        return;
    }

    if (value.length > 7 || !/^[\p{L}\d]+$/u.test(value)) {
        this.classList.add('is-invalid');
    } else {
        this.classList.remove('is-invalid');
    }
});

// Add event listeners for text display settings
const textSettings = ['verticalPosition', 'topPadding', 'bottomPadding', 'spacing', 'fontSize', 'borderRadius'];
const speedIndicatorSettings = ['indicatorScale', 'indicatorX', 'indicatorY', 'speedSize', 'speedY', 'unitSize', 'unitY'];

// Global variables for time range selection
let csvStartTime = null;
let csvEndTime = null;
let csvTotalDuration = 0;
let leftHandlePos = 0;
let rightHandlePos = 100;

// Time range handler setup
function setupTimeRangeHandlers() {
    const leftHandle = document.getElementById('leftHandle');
    const rightHandle = document.getElementById('rightHandle');
    const timeRangeSelection = document.getElementById('timeRangeSelection');
    const timeRangeBar = document.querySelector('.time-range-bar');
    const startTimeLabel = document.getElementById('startTimeLabel');
    const endTimeLabel = document.getElementById('endTimeLabel');
    const durationLabel = document.getElementById('durationLabel');
    const trimStartInput = document.getElementById('trimStartInput');
    const trimEndInput = document.getElementById('trimEndInput');
    
    if (!leftHandle || !rightHandle || !timeRangeSelection || !timeRangeBar || 
        !startTimeLabel || !endTimeLabel || !durationLabel || 
        !trimStartInput || !trimEndInput) return;
    
    // Function to update handles position and visual selection
    function updateHandles() {
        // Update selection position and width
        timeRangeSelection.style.left = leftHandlePos + '%';
        timeRangeSelection.style.width = (rightHandlePos - leftHandlePos) + '%';
        
        // Update handles position
        leftHandle.style.left = leftHandlePos + '%';
        rightHandle.style.left = rightHandlePos + '%';
        
        // Update timestamp labels and input fields if time data is available
        if (csvStartTime && csvEndTime) {
            const totalMs = new Date(csvEndTime) - new Date(csvStartTime);
            const leftMs = totalMs * (leftHandlePos / 100);
            const rightMs = totalMs * (rightHandlePos / 100);
            
            const leftDate = new Date(new Date(csvStartTime).getTime() + leftMs);
            const rightDate = new Date(new Date(csvStartTime).getTime() + rightMs);
            
            const formattedLeftDate = leftDate.toISOString().slice(0, 19).replace('T', ' ');
            const formattedRightDate = rightDate.toISOString().slice(0, 19).replace('T', ' ');
            
            startTimeLabel.textContent = formattedLeftDate;
            endTimeLabel.textContent = formattedRightDate;
            
            // Update input fields
            trimStartInput.value = formattedLeftDate;
            trimEndInput.value = formattedRightDate;
            
            // Calculate and display duration
            const durationMs = rightMs - leftMs;
            const durationSec = Math.floor(durationMs / 1000);
            const minutes = Math.floor(durationSec / 60);
            const seconds = durationSec % 60;
            durationLabel.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }
    
    // Initialize drag functionality for left handle
    leftHandle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        
        const barWidth = timeRangeBar.offsetWidth;
        const barLeft = timeRangeBar.getBoundingClientRect().left;
        
        function moveLeftHandle(moveEvent) {
            // Calculate new position as percentage
            let newPos = ((moveEvent.clientX - barLeft) / barWidth) * 100;
            
            // Constrain within limits (0% to right handle)
            newPos = Math.max(0, Math.min(rightHandlePos - 5, newPos));
            
            // Update left handle position
            leftHandlePos = newPos;
            updateHandles();
        }
        
        // Move event for dragging
        document.addEventListener('mousemove', moveLeftHandle);
        
        // Mouse up to stop dragging
        document.addEventListener('mouseup', function() {
            document.removeEventListener('mousemove', moveLeftHandle);
        }, { once: true });
    });
    
    // Initialize drag functionality for right handle
    rightHandle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        
        const barWidth = timeRangeBar.offsetWidth;
        const barLeft = timeRangeBar.getBoundingClientRect().left;
        
        function moveRightHandle(moveEvent) {
            // Calculate new position as percentage
            let newPos = ((moveEvent.clientX - barLeft) / barWidth) * 100;
            
            // Constrain within limits (left handle to 100%)
            newPos = Math.max(leftHandlePos + 5, Math.min(100, newPos));
            
            // Update right handle position
            rightHandlePos = newPos;
            updateHandles();
        }
        
        // Move event for dragging
        document.addEventListener('mousemove', moveRightHandle);
        
        // Mouse up to stop dragging
        document.addEventListener('mouseup', function() {
            document.removeEventListener('mousemove', moveRightHandle);
        }, { once: true });
    });
    
    // Listen for manual changes in input fields
    trimStartInput.addEventListener('change', function() {
        if (!csvStartTime || !csvEndTime) return;
        
        try {
            const inputDate = new Date(this.value);
            const startDate = new Date(csvStartTime);
            const endDate = new Date(csvEndTime);
            
            // Check if the input date is valid and within range
            if (inputDate >= startDate && inputDate < endDate) {
                // Calculate the percentage position for this timestamp
                const totalMs = endDate - startDate;
                const positionMs = inputDate - startDate;
                leftHandlePos = (positionMs / totalMs) * 100;
                
                // Update the handles and selection
                updateHandles();
            } else {
                // Reset to current value if invalid
                this.value = startTimeLabel.textContent;
            }
        } catch (e) {
            // Reset to current value if parsing fails
            this.value = startTimeLabel.textContent;
        }
    });
    
    trimEndInput.addEventListener('change', function() {
        if (!csvStartTime || !csvEndTime) return;
        
        try {
            const inputDate = new Date(this.value);
            const startDate = new Date(csvStartTime);
            const endDate = new Date(csvEndTime);
            
            // Check if the input date is valid and within range
            if (inputDate > startDate && inputDate <= endDate) {
                // Calculate the percentage position for this timestamp
                const totalMs = endDate - startDate;
                const positionMs = inputDate - startDate;
                rightHandlePos = (positionMs / totalMs) * 100;
                
                // Update the handles and selection
                updateHandles();
            } else {
                // Reset to current value if invalid
                this.value = endTimeLabel.textContent;
            }
        } catch (e) {
            // Reset to current value if parsing fails
            this.value = endTimeLabel.textContent;
        }
    });
    
    // Initial update
    updateHandles();
}

// Combine all settings
const allSettings = [...textSettings, ...speedIndicatorSettings];

// Add event listener for resolution change
document.querySelectorAll('input[name="resolution"]').forEach(radio => {
    radio.addEventListener('change', function() {
        const projectId = document.getElementById('startProcessButton').dataset.projectId;
        if (projectId) {
            // Adjust slider values based on resolution
            if (this.value === '4k') {
                // Set specific values for 4K
                document.getElementById('speedY').value = -50;
                document.getElementById('speedYValue').textContent = '-50';
                document.getElementById('unitY').value = 65;
                document.getElementById('unitYValue').textContent = '65';
            } else {
                // Reset to default values for Full HD
                document.getElementById('speedY').value = -28;
                document.getElementById('speedYValue').textContent = '-28';
                document.getElementById('unitY').value = 36;
                document.getElementById('unitYValue').textContent = '36';
            }
            // Update preview with new settings
            updatePreview(projectId);
        }
    });
});

allSettings.forEach(setting => {
    const input = document.getElementById(setting);
    const valueDisplay = document.getElementById(setting + 'Value');
    if (!input || !valueDisplay) return; // Skip if elements don't exist

    input.addEventListener('input', function() {
        // Update value display without adding unit if it's already in the display text
        const currentText = valueDisplay.textContent;
        const value = this.value;

        // Check if the current text already contains a unit
        if (currentText.includes('%') || currentText.includes('px')) {
            valueDisplay.textContent = value;
        } else {
            // Add unit only if it's not already present
            valueDisplay.textContent = value + (
                this.id === 'speedSize' || this.id === 'unitSize' || this.id.includes('indicator') ? '%' : 'px'
            );
        }

        // Debounce the preview update
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => {
            const projectId = document.getElementById('startProcessButton').dataset.projectId;
            if (projectId) {
                updatePreview(projectId);
            }
        }, 500);
    });
});

document.getElementById('startProcessButton').addEventListener('click', function() {
    const projectId = this.dataset.projectId;
    if (!projectId) return;

    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');
    const videoProcessingInfo = document.getElementById('videoProcessingInfo');
    const previewSection = document.getElementById('previewSection');

    // Show progress bar and processing info
    progressDiv.classList.remove('d-none');
    videoProcessingInfo.classList.remove('d-none');
    
    // Disable all UI elements
    disableUIElements();
    
    // Also disable the start process button
    this.disabled = true;

    // Set initial background processing message
    videoProcessingInfo.textContent = gettext("You can close your browser and come back later - the video processing will continue in the background.");

    // Get time range values if available
    const trimStartInput = document.getElementById('trimStartInput');
    const trimEndInput = document.getElementById('trimEndInput');

    // Get all current settings
    const settings = {
        resolution: document.querySelector('input[name="resolution"]:checked').value,
        fps: document.querySelector('input[name="fps"]:checked').value,
        codec: document.querySelector('input[name="codec"]:checked').value,
        interpolate_values: document.getElementById('interpolateValues').checked,
        vertical_position: document.getElementById('verticalPosition').value,
        top_padding: document.getElementById('topPadding').value,
        bottom_padding: document.getElementById('bottomPadding').value,
        spacing: document.getElementById('spacing').value,
        font_size: document.getElementById('fontSize').value,
        border_radius: document.getElementById('borderRadius').value,
        // Speed indicator settings
        indicator_scale: document.getElementById('indicatorScale').value,
        indicator_x: document.getElementById('indicatorX').value,
        indicator_y: document.getElementById('indicatorY').value,
        speed_y: document.getElementById('speedY').value,
        unit_y: document.getElementById('unitY').value,
        speed_size: document.getElementById('speedSize').value,
        unit_size: document.getElementById('unitSize').value,
        // Visibility settings
        show_speed: document.getElementById('showSpeed').checked,
        show_max_speed: document.getElementById('showMaxSpeed').checked,
        show_voltage: document.getElementById('showVoltage').checked,
        show_temp: document.getElementById('showTemp').checked,
        show_battery: document.getElementById('showBattery').checked,
        show_mileage: document.getElementById('showMileage').checked,
        show_pwm: document.getElementById('showPWM').checked,
        show_power: document.getElementById('showPower').checked,
        show_current: document.getElementById('showCurrent').checked,
        show_gps: document.getElementById('showGPS').checked,
        show_bottom_elements: document.getElementById('showBottomElements').checked
    };

    // Add time range values if available
    const trimStartInput = document.getElementById('trimStartInput');
    const trimEndInput = document.getElementById('trimEndInput');
    
    console.log("DEBUG: trimStartInput element:", trimStartInput);
    console.log("DEBUG: trimEndInput element:", trimEndInput);
    
    if (trimStartInput && trimEndInput) {
        console.log("DEBUG: trimStartInput value:", trimStartInput.value);
        console.log("DEBUG: trimEndInput value:", trimEndInput.value);
        
        settings.trim_start = trimStartInput.value;
        settings.trim_end = trimEndInput.value;
        
        console.log("DEBUG: Added time range to settings:", settings);
    } else {
        console.log("DEBUG: Could not find trim input elements!");
    }

    // Start processing
    fetch(`/generate_frames/${projectId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings)
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);

        // Start polling for status
        const checkStatus = () => {
            fetch(`/project_status/${projectId}`)
                .then(response => response.json())
                .then(statusData => {
                    // Ensure we have a valid status
                    if (!statusData.status) {
                        throw new Error(gettext('No status received from server'));
                    }

                    switch(statusData.status) {
                        case 'processing':
                            const progress = statusData.progress || 0;
                            progressTitle.textContent = progress <= 50 ? 
                                gettext('Creating frames...') : 
                                gettext('Encoding video...');
                            progressBar.style.width = `${progress}%`;
                            progressBar.textContent = `${progress.toFixed(1)}%`;
                            // Show processing stage below the main message
                            videoProcessingInfo.textContent = gettext('You can close your browser and come back later - the video processing will continue in the background.') + ' ' +
                                gettext('Alternatively, you can go to the Projects section to monitor the progress there.');
                            setTimeout(checkStatus, progress <= 50 ? 200 : 1000);
                            break;

                        case 'completed':
                            progressBar.style.width = '100%';
                            progressBar.textContent = '100%';
                            progressTitle.textContent = gettext('Complete!');
                            videoProcessingInfo.textContent = gettext('Video processing completed successfully!');
                            setTimeout(() => {
                                window.location.href = '/projects';
                            }, 1000);
                            break;

                        case 'pending':
                            progressTitle.textContent = gettext('Waiting to start...');
                            videoProcessingInfo.textContent = gettext('You can close your browser and come back later - the video processing will continue in the background.');
                            setTimeout(checkStatus, 500);
                            break;

                        case 'error':
                            const errorMsg = statusData.error_message || gettext('Processing failed');
                            progressTitle.textContent = gettext('Error: ') + errorMsg;
                            progressBar.classList.add('bg-danger');
                            videoProcessingInfo.textContent = gettext('An error occurred during video processing.');
                            
                            // Re-enable all UI elements
                            enableUIElements();
                            this.disabled = false;
                            break;

                        default:
                            console.error('Unexpected status:', statusData.status);
                            progressTitle.textContent = gettext('Error: Unexpected status');
                            progressBar.classList.add('bg-danger');
                            videoProcessingInfo.textContent = gettext('An unexpected error occurred.');
                            
                            // Re-enable all UI elements
                            enableUIElements();
                            this.disabled = false;
                    }
                })
                .catch(error => {
                    console.error('Status check error:', error);
                    progressTitle.textContent = gettext('Error checking status: ') + error.message;
                    progressBar.classList.add('bg-danger');
                    videoProcessingInfo.textContent = gettext('An error occurred while checking the processing status.');
                    
                    // Re-enable all UI elements
                    enableUIElements();
                    this.disabled = false;
                });
        };

        // Start checking status
        checkStatus();
    })
    .catch(error => {
        console.error('Error:', error);
        progressTitle.textContent = gettext('Error: ') + error.message;
        progressBar.classList.add('bg-danger');
        videoProcessingInfo.textContent = gettext('An error occurred while starting the video processing.');
        
        // Re-enable all UI elements
        enableUIElements();
        this.disabled = false;
    });
});

// Save preset functionality
document.getElementById('savePresetBtn').addEventListener('click', function() {
    const presetNameInput = document.getElementById('presetName');
    const presetName = presetNameInput.value.trim();
    
    if (!presetName) {
        alert(gettext('Please enter a preset name'));
        return;
    }
    
    // Get all current settings
    const settings = {
        resolution: document.querySelector('input[name="resolution"]:checked').value,
        fps: document.querySelector('input[name="fps"]:checked').value,
        codec: document.querySelector('input[name="codec"]:checked').value,
        interpolate_values: document.getElementById('interpolateValues').checked,
        vertical_position: document.getElementById('verticalPosition').value,
        top_padding: document.getElementById('topPadding').value,
        bottom_padding: document.getElementById('bottomPadding').value,
        spacing: document.getElementById('spacing').value,
        font_size: document.getElementById('fontSize').value,
        border_radius: document.getElementById('borderRadius').value,
        // Speed indicator settings
        indicator_scale: document.getElementById('indicatorScale').value,
        indicator_x: document.getElementById('indicatorX').value,
        indicator_y: document.getElementById('indicatorY').value,
        speed_y: document.getElementById('speedY').value,
        unit_y: document.getElementById('unitY').value,
        speed_size: document.getElementById('speedSize').value,
        unit_size: document.getElementById('unitSize').value,
        // Visibility settings
        show_speed: document.getElementById('showSpeed').checked,
        show_max_speed: document.getElementById('showMaxSpeed').checked,
        show_voltage: document.getElementById('showVoltage').checked,
        show_temp: document.getElementById('showTemp').checked,
        show_battery: document.getElementById('showBattery').checked,
        show_mileage: document.getElementById('showMileage').checked,
        show_pwm: document.getElementById('showPWM').checked,
        show_power: document.getElementById('showPower').checked,
        show_current: document.getElementById('showCurrent').checked,
        show_gps: document.getElementById('showGPS').checked,
        show_bottom_elements: document.getElementById('showBottomElements').checked
    };
    
    fetch('/save_preset', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: presetName,
            settings: settings
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        
        alert(gettext('Preset saved successfully!'));
        presetNameInput.value = '';
        
        // Refresh presets list
        loadPresets();
    })
    .catch(error => {
        console.error('Error saving preset:', error);
        alert(gettext('Error saving preset: ') + error.message);
    });
});

// Function to load presets
function loadPresets() {
    const presetSelect = document.getElementById('presetSelect');
    if (!presetSelect) return;
    
    fetch('/get_presets')
        .then(response => response.json())
        .then(data => {
            // Clear select
            presetSelect.innerHTML = '';
            
            // Add default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = gettext('Select a preset...');
            presetSelect.appendChild(defaultOption);
            
            // Add presets
            data.presets.forEach(preset => {
                const option = document.createElement('option');
                option.value = preset.id;
                option.textContent = preset.name;
                presetSelect.appendChild(option);
            });
        })
        .catch(error => {
            console.error('Error loading presets:', error);
        });
}

// Load presets on page load
document.addEventListener('DOMContentLoaded', function() {
    loadPresets();
});

// Apply preset
document.getElementById('presetSelect').addEventListener('change', function() {
    const presetId = this.value;
    if (!presetId) return;
    
    fetch(`/get_preset/${presetId}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            const settings = data.preset.settings;
            
            // Apply settings to form
            document.querySelector(`input[name="resolution"][value="${settings.resolution}"]`).checked = true;
            document.querySelector(`input[name="fps"][value="${settings.fps}"]`).checked = true;
            document.querySelector(`input[name="codec"][value="${settings.codec}"]`).checked = true;
            document.getElementById('interpolateValues').checked = settings.interpolate_values;
            
            // Apply text settings
            document.getElementById('verticalPosition').value = settings.vertical_position;
            document.getElementById('verticalPositionValue').textContent = settings.vertical_position + '%';
            document.getElementById('topPadding').value = settings.top_padding;
            document.getElementById('topPaddingValue').textContent = settings.top_padding + 'px';
            document.getElementById('bottomPadding').value = settings.bottom_padding;
            document.getElementById('bottomPaddingValue').textContent = settings.bottom_padding + 'px';
            document.getElementById('spacing').value = settings.spacing;
            document.getElementById('spacingValue').textContent = settings.spacing + 'px';
            document.getElementById('fontSize').value = settings.font_size;
            document.getElementById('fontSizeValue').textContent = settings.font_size + 'px';
            document.getElementById('borderRadius').value = settings.border_radius;
            document.getElementById('borderRadiusValue').textContent = settings.border_radius + 'px';
            
            // Apply speed indicator settings
            document.getElementById('indicatorScale').value = settings.indicator_scale;
            document.getElementById('indicatorScaleValue').textContent = settings.indicator_scale + '%';
            document.getElementById('indicatorX').value = settings.indicator_x;
            document.getElementById('indicatorXValue').textContent = settings.indicator_x + 'px';
            document.getElementById('indicatorY').value = settings.indicator_y;
            document.getElementById('indicatorYValue').textContent = settings.indicator_y + 'px';
            document.getElementById('speedY').value = settings.speed_y;
            document.getElementById('speedYValue').textContent = settings.speed_y;
            document.getElementById('unitY').value = settings.unit_y;
            document.getElementById('unitYValue').textContent = settings.unit_y;
            document.getElementById('speedSize').value = settings.speed_size;
            document.getElementById('speedSizeValue').textContent = settings.speed_size + '%';
            document.getElementById('unitSize').value = settings.unit_size;
            document.getElementById('unitSizeValue').textContent = settings.unit_size + '%';
            
            // Apply visibility settings
            document.getElementById('showSpeed').checked = settings.show_speed;
            document.getElementById('showMaxSpeed').checked = settings.show_max_speed;
            document.getElementById('showVoltage').checked = settings.show_voltage;
            document.getElementById('showTemp').checked = settings.show_temp;
            document.getElementById('showBattery').checked = settings.show_battery;
            document.getElementById('showMileage').checked = settings.show_mileage;
            document.getElementById('showPWM').checked = settings.show_pwm;
            document.getElementById('showPower').checked = settings.show_power;
            document.getElementById('showCurrent').checked = settings.show_current;
            document.getElementById('showGPS').checked = settings.show_gps;
            document.getElementById('showBottomElements').checked = settings.show_bottom_elements;
            
            // Update preview if we have a project ID
            const projectId = document.getElementById('startProcessButton').dataset.projectId;
            if (projectId) {
                updatePreview(projectId);
            }
        })
        .catch(error => {
            console.error('Error applying preset:', error);
            alert(gettext('Error applying preset: ') + error.message);
        });
});

// Delete preset
document.getElementById('deletePresetBtn').addEventListener('click', function() {
    const presetSelect = document.getElementById('presetSelect');
    const presetId = presetSelect.value;
    
    if (!presetId) {
        alert(gettext('Please select a preset to delete'));
        return;
    }
    
    if (!confirm(gettext('Are you sure you want to delete this preset?'))) {
        return;
    }
    
    fetch(`/delete_preset/${presetId}`, {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        
        alert(gettext('Preset deleted successfully!'));
        
        // Refresh presets list
        loadPresets();
    })
    .catch(error => {
        console.error('Error deleting preset:', error);
        alert(gettext('Error deleting preset: ') + error.message);
    });
});