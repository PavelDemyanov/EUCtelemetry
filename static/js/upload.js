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
                // Get current values for all settings including visibility
                const settings = {
                    resolution: document.querySelector('input[name="resolution"]:checked').value,
                    vertical_position: document.getElementById('verticalPosition').value,
                    top_padding: document.getElementById('topPadding').value,
                    bottom_padding: document.getElementById('bottomPadding').value,
                    spacing: document.getElementById('spacing').value,
                    font_size: document.getElementById('fontSize').value,
                    border_radius: document.getElementById('borderRadius').value,
                    // Speed indicator settings
                    indicator_x: document.getElementById('indicatorX').value,
                    indicator_y: document.getElementById('indicatorY').value,
                    speed_y: document.getElementById('speedY').value,
                    unit_y: document.getElementById('unitY').value,
                    speed_size: document.getElementById('speedSize').value,
                    unit_size: document.getElementById('unitSize').value,
                    indicator_scale: document.getElementById('indicatorScale').value,
                    // Add visibility settings
                    show_speed: document.getElementById('showSpeed').checked,
                    show_max_speed: document.getElementById('showMaxSpeed').checked,
                    show_voltage: document.getElementById('showVoltage').checked,
                    show_temp: document.getElementById('showTemp').checked,
                    show_battery: document.getElementById('showBattery').checked,
                    show_mileage: document.getElementById('showMileage').checked,
                    show_pwm: document.getElementById('showPWM').checked,
                    show_power: document.getElementById('showPower').checked,
                    show_gps: document.getElementById('showGPS').checked,
                    show_bottom_elements: document.getElementById('showBottomElements').checked
                };

                // Update preview with all current settings
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
                    document.getElementById('previewImage').src = data.preview_url + '?t=' + new Date().getTime();
                })
                .catch(error => {
                    console.error('Error updating preview:', error);
                });
            }
        }, 300);
    });
});

// Add event listeners for visibility checkboxes
const visibilitySettings = [
    'showSpeed', 'showMaxSpeed', 'showVoltage', 'showTemp', 
    'showBattery', 'showMileage', 'showPWM', 'showPower', 
    'showGPS', 'showBottomElements'
];

visibilitySettings.forEach(setting => {
    const checkbox = document.getElementById(setting);
    if (checkbox) {
        checkbox.addEventListener('change', function() {
            const projectId = document.getElementById('startProcessButton').dataset.projectId;
            if (projectId) {
                updatePreview(projectId);
            }
        });
    }
});

// Handle start processing button click
document.getElementById('startProcessButton').addEventListener('click', function() {
    const projectId = this.dataset.projectId;
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');
    const videoProcessingInfo = document.getElementById('videoProcessingInfo');

    // Show progress bar and processing info
    progressDiv.classList.remove('d-none');
    videoProcessingInfo.classList.remove('d-none');
    this.disabled = true;

    // Set initial background processing message
    videoProcessingInfo.textContent = gettext("You can close your browser and come back later - the video processing will continue in the background.");

    // Get all current settings with explicit boolean values for visibility
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
        indicator_x: document.getElementById('indicatorX').value,
        indicator_y: document.getElementById('indicatorY').value,
        speed_y: document.getElementById('speedY').value,
        unit_y: document.getElementById('unitY').value,
        speed_size: document.getElementById('speedSize').value,
        unit_size: document.getElementById('unitSize').value,
        indicator_scale: document.getElementById('indicatorScale').value,
        // Add visibility settings with explicit boolean values
        show_speed: Boolean(document.getElementById('showSpeed').checked),
        show_max_speed: Boolean(document.getElementById('showMaxSpeed').checked),
        show_voltage: Boolean(document.getElementById('showVoltage').checked),
        show_temp: Boolean(document.getElementById('showTemp').checked),
        show_battery: Boolean(document.getElementById('showBattery').checked),
        show_mileage: Boolean(document.getElementById('showMileage').checked),
        show_pwm: Boolean(document.getElementById('showPWM').checked),
        show_power: Boolean(document.getElementById('showPower').checked),
        show_gps: Boolean(document.getElementById('showGPS').checked),
        show_bottom_elements: Boolean(document.getElementById('showBottomElements').checked)
    };

    console.log('Sending settings to generate frames:', settings);  // Add logging

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
                            this.disabled = false;
                            break;

                        default:
                            console.error('Unexpected status:', statusData.status);
                            progressTitle.textContent = gettext('Error: Unexpected status');
                            progressBar.classList.add('bg-danger');
                            videoProcessingInfo.textContent = gettext('An unexpected error occurred.');
                            this.disabled = false;
                    }
                })
                .catch(error => {
                    console.error('Status check error:', error);
                    progressTitle.textContent = gettext('Error checking status: ') + error.message;
                    progressBar.classList.add('bg-danger');
                    videoProcessingInfo.textContent = gettext('An error occurred while checking the processing status.');
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
        this.disabled = false;
    });
});