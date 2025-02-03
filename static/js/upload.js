document.getElementById('uploadForm').addEventListener('submit', function(e) {
    e.preventDefault();

    const formData = new FormData(this);
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');
    let projectId;

    // Show progress bar
    progressDiv.classList.remove('d-none');
    progressTitle.textContent = 'Uploading CSV...';

    // Disable form
    this.querySelectorAll('input, button').forEach(el => el.disabled = true);

    // Upload CSV
    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);

        projectId = data.project_id; // Store project ID
        progressTitle.textContent = 'Generating Frames...';
        progressBar.style.width = '33%';
        progressBar.textContent = '33%';

        // Generate frames
        return fetch(`/generate_frames/${projectId}`, {
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

        progressTitle.textContent = 'Creating Video...';
        progressBar.style.width = '66%';
        progressBar.textContent = '66%';

        // Create video using stored projectId
        return fetch(`/create_video/${projectId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                'fps': document.getElementById('fps').value,
                'codec': document.querySelector('input[name="codec"]:checked').value
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
    })
    .finally(() => {
        // Re-enable form
        this.querySelectorAll('input, button').forEach(el => el.disabled = false);
    });
});