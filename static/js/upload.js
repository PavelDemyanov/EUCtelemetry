document.getElementById('uploadForm').addEventListener('submit', function(e) {
    e.preventDefault();

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

// Handle start processing button click
document.getElementById('startProcessButton').addEventListener('click', function() {
    const projectId = this.dataset.projectId;
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');

    // Show progress bar
    progressDiv.classList.remove('d-none');
    this.disabled = true;

    // Generate frames
    progressTitle.textContent = 'Generating Frames...';
    progressBar.style.width = '33%';
    progressBar.textContent = '33%';

    fetch(`/generate_frames/${projectId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            'resolution': document.querySelector('input[name="resolution"]:checked').value,
            'fps': document.querySelector('input[name="fps"]:checked').value
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);

        progressTitle.textContent = 'Creating Video...';
        progressBar.style.width = '66%';
        progressBar.textContent = '66%';

        return fetch(`/create_video/${projectId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                'fps': document.querySelector('input[name="fps"]:checked').value,
                'codec': document.querySelector('input[name="codec"]:checked').value,
                'resolution': document.querySelector('input[name="resolution"]:checked').value
            })
        });
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);

        progressBar.style.width = '100%';
        progressBar.textContent = '100%';
        progressTitle.textContent = 'Complete!';

        setTimeout(() => {
            window.location.href = '/projects';
        }, 1000);
    })
    .catch(error => {
        console.error('Error:', error);
        progressTitle.textContent = 'Error: ' + error.message;
        progressBar.classList.add('bg-danger');
        this.disabled = false;
    });
});