document.getElementById('uploadForm').addEventListener('submit', function(e) {
    e.preventDefault();

    const formData = new FormData(this);
    const previewSection = document.getElementById('previewSection');
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');
    let tempId;
    let projectData = {};

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

        tempId = data.temp_id;
        projectData = {
            csv_type: data.csv_type,
            original_filename: data.original_filename,
            project_name: formData.get('project_name')
        };

        // Get preview frame
        return fetch(`/preview/${tempId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                'resolution': document.querySelector('input[name="resolution"]:checked').value,
                'filename': data.original_filename
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

        // Store temp ID for the start processing button
        document.getElementById('startProcessButton').dataset.tempId = tempId;
        // Store project data
        document.getElementById('startProcessButton').dataset.projectData = JSON.stringify(projectData);
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
    const tempId = this.dataset.tempId;
    const projectData = JSON.parse(this.dataset.projectData);
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

    fetch(`/generate_frames/${tempId}`, {
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

        // Store frame count and duration for the final step
        projectData.frame_count = data.frame_count;
        projectData.duration = data.duration;

        progressTitle.textContent = 'Creating Video...';
        progressBar.style.width = '66%';
        progressBar.textContent = '66%';

        return fetch(`/create_video/${tempId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                'fps': document.querySelector('input[name="fps"]:checked').value,
                'codec': document.querySelector('input[name="codec"]:checked').value,
                'resolution': document.querySelector('input[name="resolution"]:checked').value,
                'project_name': projectData.project_name,
                'csv_type': projectData.csv_type,
                'frame_count': projectData.frame_count,
                'duration': projectData.duration
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