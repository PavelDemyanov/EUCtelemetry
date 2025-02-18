// Function to safely get element value with default
function getElementValueOrDefault(elementId, defaultValue) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.log(`Element ${elementId} not found, using default value: ${defaultValue}`);
        return defaultValue;
    }
    console.log(`Got value for ${elementId}: ${element.value}`);
    return element.value;
}

// Function to update preview with current settings
function updatePreview(projectId) {
    console.log('Updating preview for project:', projectId);
    const previewSection = document.getElementById('previewSection');
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');

    // Get all current settings with safe defaults
    const settings = {
        resolution: document.querySelector('input[name="resolution"]:checked')?.value || 'fullhd',
        // Text Display Settings
        vertical_position: getElementValueOrDefault('verticalPosition', 1),
        font_size: getElementValueOrDefault('fontSize', 26),
        border_radius: getElementValueOrDefault('borderRadius', 13),
        box_width: getElementValueOrDefault('boxWidth', 0),
        box_height: getElementValueOrDefault('boxHeight', 47),
        spacing: getElementValueOrDefault('spacing', 10),
        // Speed Indicator Settings
        indicator_scale: getElementValueOrDefault('indicatorScale', 100),
        indicator_x: getElementValueOrDefault('indicatorX', 50),
        indicator_y: getElementValueOrDefault('indicatorY', 80),
        speed_y: getElementValueOrDefault('speedY', -28),
        unit_y: getElementValueOrDefault('unitY', 36),
        speed_size: getElementValueOrDefault('speedSize', 100),
        unit_size: getElementValueOrDefault('unitSize', 100)
    };

    console.log('Preview settings:', settings);

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

        progressDiv.classList.add('d-none');
        previewSection.classList.remove('d-none');
        document.getElementById('previewImage').src = data.preview_url + '?t=' + new Date().getTime();

        // Store project ID for the start processing button
        document.getElementById('startProcessButton').dataset.projectId = projectId;
    })
    .catch(error => {
        console.error('Error:', error);
        progressTitle.textContent = gettext('Error: ') + error.message;
        progressBar.classList.add('bg-danger');
    });
}

// Add event listeners for text display settings
const textSettings = ['verticalPosition', 'fontSize', 'borderRadius', 'boxWidth', 'boxHeight', 'spacing'];
const speedIndicatorSettings = ['indicatorScale', 'indicatorX', 'indicatorY', 'speedSize', 'speedY', 'unitSize', 'unitY'];

// Combine all settings
const allSettings = [...textSettings, ...speedIndicatorSettings];

// Add event listener for resolution change
document.querySelectorAll('input[name="resolution"]').forEach(radio => {
    radio.addEventListener('change', function() {
        console.log('Resolution changed to:', this.value);
        const projectId = document.getElementById('startProcessButton').dataset.projectId;
        if (projectId) {
            updatePreview(projectId);
        }
    });
});

// Add event listeners for all settings
allSettings.forEach(setting => {
    const input = document.getElementById(setting);
    const valueDisplay = document.getElementById(setting + 'Value');
    if (!input || !valueDisplay) {
        console.log(`Skipping setup for ${setting} - elements not found`);
        return;
    }

    input.addEventListener('input', function() {
        console.log(`${setting} changed to:`, this.value);

        // Update value display
        const unit = this.id === 'speedSize' || this.id === 'unitSize' || this.id.includes('indicator') ? '%' : 'px';
        valueDisplay.textContent = this.value + unit;

        // Get projectId and update preview
        const projectId = document.getElementById('startProcessButton').dataset.projectId;
        if (projectId) {
            clearTimeout(this.timeout);
            this.timeout = setTimeout(() => {
                updatePreview(projectId);
            }, 300);
        }
    });
});

// Handle file upload form submission
document.getElementById('uploadForm').addEventListener('submit', function(e) {
    e.preventDefault();
    console.log('Upload form submitted');

    const projectNameInput = document.getElementById('projectName');
    const projectName = projectNameInput.value.trim();

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

    // Show progress for upload
    progressDiv.classList.remove('d-none');
    videoProcessingInfo.classList.add('d-none');
    progressTitle.textContent = gettext('Uploading CSV...');

    // Disable form
    this.querySelectorAll('input, button').forEach(el => el.disabled = true);

    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) throw new Error(gettext('Upload failed'));
        return response.json();
    })
    .then(data => {
        if (data.error) throw new Error(data.error);
        console.log('Upload successful, project ID:', data.project_id);
        updatePreview(data.project_id);
    })
    .catch(error => {
        console.error('Upload error:', error);
        progressTitle.textContent = gettext('Error: ') + error.message;
        progressBar.classList.add('bg-danger');
        this.querySelectorAll('input, button').forEach(el => el.disabled = false);
    });
});

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

    // Get all current settings with safe defaults
    const settings = {
        resolution: document.querySelector('input[name="resolution"]:checked')?.value || 'fullhd',
        fps: document.querySelector('input[name="fps"]:checked')?.value || '29.97',
        codec: document.querySelector('input[name="codec"]:checked')?.value || 'h264',
        interpolate_values: document.getElementById('interpolateValues')?.checked || true,
        // Text Display Settings
        vertical_position: getElementValueOrDefault('verticalPosition', 1),
        font_size: getElementValueOrDefault('fontSize', 26),
        border_radius: getElementValueOrDefault('borderRadius', 13),
        box_width: getElementValueOrDefault('boxWidth', 0),
        box_height: getElementValueOrDefault('boxHeight', 47),
        spacing: getElementValueOrDefault('spacing', 10),
        // Speed Indicator Settings
        indicator_scale: getElementValueOrDefault('indicatorScale', 100),
        indicator_x: getElementValueOrDefault('indicatorX', 50),
        indicator_y: getElementValueOrDefault('indicatorY', 80),
        speed_y: getElementValueOrDefault('speedY', -28),
        unit_y: getElementValueOrDefault('unitY', 36),
        speed_size: getElementValueOrDefault('speedSize', 100),
        unit_size: getElementValueOrDefault('unitSize', 100)
    };

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