function stopProject(projectId) {
    if (confirm(gettext('Are you sure you want to stop this project processing?'))) {
        fetch(`/stop/${projectId}`, {
            method: 'POST',
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                location.reload();
            } else {
                alert(gettext('Error stopping project: ') + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert(gettext('Error stopping project'));
        });
    }
}

function deleteProject(projectId) {
    if (confirm(gettext('Are you sure you want to delete this project?'))) {
        fetch(`/delete/${projectId}`, {
            method: 'POST',
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                location.reload();
            } else {
                alert(gettext('Error deleting project: ') + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert(gettext('Error deleting project'));
        });
    }
}

function updateProjectStatuses() {
    // Find all project status badges
    document.querySelectorAll('[data-project-status]').forEach(statusBadge => {
        const projectId = statusBadge.dataset.projectId;
        const currentStatus = statusBadge.dataset.projectStatus;

        // Only check status for processing projects
        if (currentStatus === 'processing' || currentStatus === 'pending') {
            fetch(`/project_status/${projectId}`)
                .then(response => response.json())
                .then(data => {
                    if (data.status !== currentStatus) {
                        // Update the badge class and text based on new status
                        statusBadge.className = 'badge text-bg-' + 
                            (data.status === 'completed' ? 'success' : 
                             data.status === 'processing' ? 'warning' : 
                             data.status === 'error' ? 'danger' : 
                             data.status === 'stopped' ? 'secondary' : 'secondary');

                        // Use translated status with first letter capitalized
                        statusBadge.textContent = gettext(data.status.charAt(0).toUpperCase() + data.status.slice(1));
                        statusBadge.dataset.projectStatus = data.status;

                        // If project completed or errored, add/update error message tooltip
                        if ((data.status === 'error' || data.status === 'stopped') && data.error_message) {
                            statusBadge.title = data.error_message;
                        }

                        // Refresh the page if status changed to completed to show new download buttons
                        if (data.status === 'completed') {
                            setTimeout(() => location.reload(), 1000);
                        }
                    }

                    // Update progress if processing
                    if (data.status === 'processing' && data.progress !== undefined) {
                        statusBadge.textContent = `${gettext(data.status.charAt(0).toUpperCase() + data.status.slice(1))} (${Math.round(data.progress)}%)`;
                    }
                })
                .catch(error => console.error('Error updating status:', error));
        }
    });
}

// Start periodic status updates every 2 seconds
setInterval(updateProjectStatuses, 2000);