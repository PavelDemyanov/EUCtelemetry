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
    progressTitle.textContent = 'Uploading CSV...';

    // Disable form
    this.querySelectorAll('input, button').forEach(el => el.disabled = true);

    // Upload CSV and get preview
    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);

        projectId = data.project_id;
        updatePreview(projectId);
    })
    .catch(error => {
        console.error('Error:', error);
        progressTitle.textContent = 'Error: ' + error.message;
        progressBar.classList.add('bg-danger');
        // Re-enable form
        document.querySelectorAll('input, button').forEach(el => el.disabled = false);
    });
});

// Function to update preview with current settings
function updatePreview(projectId) {
    const previewSection = document.getElementById('previewSection');
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');

    // Get current values with updated settings
    const settings = {
        resolution: document.querySelector('input[name="resolution"]:checked').value,
        vertical_position: document.getElementById('verticalPosition').value,
        top_padding: document.getElementById('topPadding').value,
        bottom_padding: document.getElementById('bottomPadding').value,
        spacing: document.getElementById('spacing').value,
        font_size: document.getElementById('fontSize').value,
        border_radius: document.getElementById('borderRadius').value,
        // Speed indicator settings
        arc_width: document.getElementById('arcWidth').value,
        indicator_scale: document.getElementById('indicatorScale').value,
        indicator_x: document.getElementById('indicatorX').value,
        indicator_y: document.getElementById('indicatorY').value,
        speed_y: document.getElementById('speedY').value,
        unit_y: document.getElementById('unitY').value,
        speed_size: document.getElementById('speedSize').value,
        unit_size: document.getElementById('unitSize').value
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
        progressTitle.textContent = 'Error: ' + error.message;
        progressBar.classList.add('bg-danger');
        // Re-enable form
        document.querySelectorAll('input, button').forEach(el => el.disabled = false);
    });
}

// Add event listeners for all settings
const allSettings = [
    'verticalPosition', 'topPadding', 'bottomPadding', 'spacing', 'fontSize', 'borderRadius',
    'arcWidth', 'indicatorScale', 'indicatorX', 'indicatorY', 'speedSize', 'speedY', 'unitSize', 'unitY'
];

// Add event listener for resolution change
document.querySelectorAll('input[name="resolution"]').forEach(radio => {
    radio.addEventListener('change', function() {
        const projectId = document.getElementById('startProcessButton').dataset.projectId;
        if (projectId) {
            // Adjust slider values based on resolution
            if (this.value === '4k') {
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
        // Update value display
        const value = this.value;
        console.log(`${setting} changed to: ${value}`); // Debug log

        // Update the display text with appropriate unit
        valueDisplay.textContent = value + (
            setting === 'speedSize' || setting === 'unitSize' || 
            setting === 'indicatorScale' || setting === 'verticalPosition' ? '%' : 'px'
        );

        // Debounce the preview update
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => {
            const projectId = document.getElementById('startProcessButton').dataset.projectId;
            if (projectId) {
                updatePreview(projectId);
            }
        }, 300);
    });
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

    // Get all current settings
    const settings = {
        resolution: document.querySelector('input[name="resolution"]:checked').value,
        fps: document.querySelector('input[name="fps"]:checked').value,
        codec: document.querySelector('input[name="codec"]:checked').value,
        vertical_position: document.getElementById('verticalPosition').value,
        top_padding: document.getElementById('topPadding').value,
        bottom_padding: document.getElementById('bottomPadding').value,
        spacing: document.getElementById('spacing').value,
        font_size: document.getElementById('fontSize').value,
        border_radius: document.getElementById('borderRadius').value,
        arc_width: document.getElementById('arcWidth').value,
        indicator_x: document.getElementById('indicatorX').value,
        indicator_y: document.getElementById('indicatorY').value,
        speed_y: document.getElementById('speedY').value,
        unit_y: document.getElementById('unitY').value,
        speed_size: document.getElementById('speedSize').value,
        unit_size: document.getElementById('unitSize').value,
        indicator_scale: document.getElementById('indicatorScale').value
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
        console.log('Processing started with settings:', settings);
        // Start polling for status
        checkStatus();
    })
    .catch(error => {
        console.error('Error:', error);
        progressTitle.textContent = 'Error: ' + error.message;
        progressBar.classList.add('bg-danger');
        videoProcessingInfo.textContent = 'An error occurred while starting the video processing.';
        this.disabled = false;
    });

    function checkStatus() {
        fetch(`/project_status/${projectId}`)
            .then(response => response.json())
            .then(statusData => {
                if (!statusData.status) {
                    throw new Error('No status received from server');
                }

                switch(statusData.status) {
                    case 'processing':
                        const progress = statusData.progress || 0;
                        progressTitle.textContent = progress <= 50 ? 
                            'Creating frames...' : 
                            'Encoding video...';
                        progressBar.style.width = `${progress}%`;
                        progressBar.textContent = `${progress.toFixed(1)}%`;
                        setTimeout(checkStatus, progress <= 50 ? 200 : 1000);
                        break;

                    case 'completed':
                        progressBar.style.width = '100%';
                        progressBar.textContent = '100%';
                        progressTitle.textContent = 'Complete!';
                        videoProcessingInfo.textContent = 'Video processing completed successfully!';
                        setTimeout(() => {
                            window.location.href = '/projects';
                        }, 1000);
                        break;

                    case 'pending':
                        progressTitle.textContent = 'Waiting to start...';
                        setTimeout(checkStatus, 500);
                        break;

                    case 'error':
                        const errorMsg = statusData.error_message || 'Processing failed';
                        progressTitle.textContent = 'Error: ' + errorMsg;
                        progressBar.classList.add('bg-danger');
                        videoProcessingInfo.textContent = 'An error occurred during video processing.';
                        break;

                    default:
                        console.error('Unexpected status:', statusData.status);
                        progressTitle.textContent = 'Error: Unexpected status';
                        progressBar.classList.add('bg-danger');
                }
            })
            .catch(error => {
                console.error('Status check error:', error);
                progressTitle.textContent = 'Error checking status: ' + error.message;
                progressBar.classList.add('bg-danger');
            });
    }
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