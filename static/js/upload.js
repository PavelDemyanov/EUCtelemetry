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
        if (!/^[\w\d]+$/.test(projectName)) {
            projectNameInput.classList.add('is-invalid');
            return;
        }
    }

    const formData = new FormData(this);
    const previewSection = document.getElementById('previewSection');
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');
    let projectId;

    // Show progress for upload
    progressDiv.classList.remove('d-none');
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

        // Get preview frame
        return fetch(`/preview/${projectId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                'resolution': document.querySelector('input[name="resolution"]:checked').value
            })
        });
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);

        // Show preview
        progressDiv.classList.add('d-none');
        previewSection.classList.remove('d-none');
        document.getElementById('previewImage').src = data.preview_url;

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
});

// Add real-time validation for project name input
document.getElementById('projectName').addEventListener('input', function() {
    const value = this.value.trim();

    if (value === '') {
        // Empty value is valid (will generate automatic name)
        this.classList.remove('is-invalid');
        return;
    }

    if (value.length > 7 || !/^[\w\d]+$/.test(value)) {
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

    // Show progress bar
    progressDiv.classList.remove('d-none');
    this.disabled = true;

    // Start processing
    fetch(`/generate_frames/${projectId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            'resolution': document.querySelector('input[name="resolution"]:checked').value,
            'fps': document.querySelector('input[name="fps"]:checked').value,
            'codec': document.querySelector('input[name="codec"]:checked').value
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);

        // Start polling for status
        const checkStatus = () => {
            fetch(`/project_status/${projectId}`)
                .then(response => response.json())
                .then(statusData => {
                    switch(statusData.status) {
                        case 'processing':
                            progressTitle.textContent = 'Processing...';
                            progressBar.style.width = '50%';
                            progressBar.textContent = '50%';
                            setTimeout(checkStatus, 2000);  // Poll every 2 seconds
                            break;
                        case 'completed':
                            progressBar.style.width = '100%';
                            progressBar.textContent = '100%';
                            progressTitle.textContent = 'Complete!';
                            setTimeout(() => {
                                window.location.href = '/projects';
                            }, 1000);
                            break;
                        case 'error':
                            throw new Error(statusData.error_message || 'Processing failed');
                        default:
                            throw new Error('Unknown status');
                    }
                })
                .catch(error => {
                    console.error('Status check error:', error);
                    progressTitle.textContent = 'Error: ' + error.message;
                    progressBar.classList.add('bg-danger');
                    this.disabled = false;
                });
        };

        // Start checking status
        checkStatus();
    })
    .catch(error => {
        console.error('Error:', error);
        progressTitle.textContent = 'Error: ' + error.message;
        progressBar.classList.add('bg-danger');
        this.disabled = false;
    });
});