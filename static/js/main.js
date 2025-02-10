function stopProject(projectId) {
    if (confirm('Are you sure you want to stop and delete this project?')) {
        fetch(`/stop/${projectId}`, {
            method: 'POST',
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                location.reload();
            } else {
                alert('Error stopping project: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Error stopping project');
        });
    }
}

function deleteProject(projectId) {
    if (confirm('Are you sure you want to delete this project?')) {
        fetch(`/delete/${projectId}`, {
            method: 'POST',
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                location.reload();
            } else {
                alert('Error deleting project: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Error deleting project');
        });
    }
}

function updateProjectStatuses() {
    // Find all project status badges
    document.querySelectorAll('[data-project-status]').forEach(statusBadge => {
        const projectId = statusBadge.dataset.projectId;
        const currentStatus = statusBadge.dataset.projectStatus;

        // Only check status for processing or pending projects
        if (currentStatus === 'processing' || currentStatus === 'pending') {
            fetch(`/project_status/${projectId}`)
                .then(response => response.json())
                .then(data => {
                    // Validate status data
                    const validStatus = data.status && typeof data.status === 'string';
                    const status = validStatus ? data.status : 'error';

                    // Update badge class and text only if status changed
                    if (status !== currentStatus) {
                        // Map status to Bootstrap contextual class
                        const statusClasses = {
                            'completed': 'success',
                            'processing': 'warning',
                            'pending': 'secondary',
                            'error': 'danger'
                        };

                        // Get appropriate Bootstrap class or default to 'secondary'
                        const bootstrapClass = statusClasses[status] || 'secondary';

                        // Update badge
                        statusBadge.className = `badge text-bg-${bootstrapClass}`;
                        statusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
                        statusBadge.dataset.projectStatus = status;

                        // Handle error message tooltip
                        if (status === 'error' && data.error_message) {
                            statusBadge.title = data.error_message;
                        }

                        // Refresh page on completion
                        if (status === 'completed') {
                            setTimeout(() => location.reload(), 1000);
                        }
                    }

                    // Update progress if processing
                    if (status === 'processing' && typeof data.progress === 'number') {
                        const progress = Math.round(data.progress);
                        statusBadge.textContent = `${status.charAt(0).toUpperCase() + status.slice(1)} (${progress}%)`;
                    }
                })
                .catch(error => {
                    console.error('Error updating status:', error);
                    // Don't change the badge on error, maintain current state
                });
        }
    });
}

// Start periodic status updates every 2 seconds
setInterval(updateProjectStatuses, 2000);