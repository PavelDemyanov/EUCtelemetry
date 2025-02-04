document.getElementById('uploadForm').addEventListener('submit', function(e) {
    e.preventDefault();

    const formData = new FormData(this);
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');
    const previewSection = document.getElementById('previewSection');
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

        projectId = data.project_id;

        // Show preview section after successful upload
        previewSection.classList.remove('d-none');
        previewSection.dataset.projectId = projectId; //added to set project id in preview section
        progressDiv.classList.add('d-none');

        // Re-enable form
        this.querySelectorAll('input, button').forEach(el => el.disabled = false);
    })
    .catch(error => {
        console.error('Error:', error);
        progressTitle.textContent = 'Error: ' + error.message;
        progressBar.classList.add('bg-danger');
        // Re-enable form
        this.querySelectorAll('input, button').forEach(el => el.disabled = false);
    });
});

document.getElementById('showPreviewBtn').addEventListener('click', function() {
    const resolution = document.querySelector('input[name="resolution"]:checked').value;
    const projectId = document.querySelector('#previewSection').dataset.projectId;
    const previewImage = document.getElementById('previewImage');

    this.disabled = true;

    fetch('/generate_preview', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            'project_id': projectId,
            'resolution': resolution
        })
    })
    .then(response => response.blob())
    .then(blob => {
        const imageUrl = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.src = imageUrl;
        img.className = 'img-fluid';
        previewImage.innerHTML = '';
        previewImage.appendChild(img);
    })
    .catch(error => {
        console.error('Error:', error);
        previewImage.innerHTML = '<div class="alert alert-danger">Error generating preview</div>';
    })
    .finally(() => {
        this.disabled = false;
    });
});

document.getElementById('startProcessing').addEventListener('click', function() {
    const projectId = document.querySelector('#previewSection').dataset.projectId;
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');

    // Show progress bar
    progressDiv.classList.remove('d-none');
    progressTitle.textContent = 'Generating Frames...';

    // Generate frames
    fetch(`/generate_frames/${projectId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            'resolution': document.querySelector('input[name="resolution"]:checked').value,
            'fps': document.getElementById('fps').value
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);

        progressTitle.textContent = 'Creating Video...';
        progressBar.style.width = '66%';
        progressBar.textContent = '66%';

        // Create video
        return fetch(`/create_video/${projectId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                'fps': document.getElementById('fps').value,
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
    });
});