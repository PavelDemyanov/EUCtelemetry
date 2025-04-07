// Globals for tracking upload state
let projectId = null;
let csvData = null;
let csvChart = null;

// Helper function to get translated text from hidden span elements
function gettext(text) {
    // First check if we have a hidden span with this translation
    const translationSpan = document.getElementById(`js-translation-${text.toLowerCase().replace(/\s+/g, '-')}`);
    if (translationSpan) {
        return translationSpan.textContent;
    }
    // If not, return the original text
    return text;
}

// Function to validate project name
function validateProjectName(name) {
    if (!name) return true; // Empty name is allowed (auto-generated)
    return /^[a-zA-Z0-9]{1,7}$/.test(name);
}

// Event listeners for the uploadForm
document.getElementById('uploadForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    // Validate project name if provided
    const projectName = document.getElementById('projectName').value.trim();
    if (!validateProjectName(projectName)) {
        document.getElementById('projectName').classList.add('is-invalid');
        return;
    } else {
        document.getElementById('projectName').classList.remove('is-invalid');
    }
    
    // Get selected resolution
    const resolution = document.querySelector('input[name="resolution"]:checked').value;
    
    // Create FormData
    const formData = new FormData();
    formData.append('project_name', projectName);
    formData.append('resolution', resolution);
    
    // Add CSV file
    const fileInput = document.getElementById('csvFile');
    if (fileInput.files.length === 0) {
        alert(gettext('Please select a CSV file'));
        return;
    }
    formData.append('file', fileInput.files[0]);
    
    // Show loading state
    this.classList.add('loading');
    document.getElementById('uploadButton').disabled = true;
    document.getElementById('uploadButton').innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ' + gettext('Uploading...');
    
    // Send the form
    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        
        // Store the project ID for later use
        projectId = data.project_id;
        
        // Update the UI to show preview section
        document.getElementById('previewSection').style.display = 'block';
        document.getElementById('previewImage').src = data.preview_url;
        
        // Scroll to preview section
        document.getElementById('previewSection').scrollIntoView({behavior: 'smooth'});
        
        // Load CSV time range data for the trim interface
        loadCSVTimeRange(projectId);
    })
    .catch(error => {
        console.error('Error:', error);
        alert(gettext('Upload failed: ') + error.message);
    })
    .finally(() => {
        // Reset form state
        this.classList.remove('loading');
        document.getElementById('uploadButton').disabled = false;
        document.getElementById('uploadButton').textContent = gettext('Upload CSV');
    });
});

// Function to load CSV time range data
function loadCSVTimeRange(projectId) {
    const loadingElement = document.getElementById('loadingTrimData');
    const contentElement = document.getElementById('trimDataContent');
    
    loadingElement.style.display = 'block';
    contentElement.style.display = 'none';
    
    fetch(`/get_csv_timerange/${projectId}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            csvData = data;
            
            // Update display elements
            document.getElementById('startTimeDisplay').value = data.min_date;
            document.getElementById('endTimeDisplay').value = data.max_date;
            document.getElementById('totalRecords').textContent = data.total_rows;
            document.getElementById('selectedRecords').textContent = data.total_rows;
            
            // Initialize or update chart
            initializeChart(data.chart_data);
            
            // Initialize noUiSlider once we have the data
            initializeRangeSlider(data.min_timestamp, data.max_timestamp);
            
            // Hide loading, show content
            loadingElement.style.display = 'none';
            contentElement.style.display = 'block';
        })
        .catch(error => {
            console.error('Error loading CSV time range:', error);
            document.getElementById('loadingTrimData').innerHTML = `
                <div class="alert alert-danger">
                    ${gettext('Error loading data: ')} ${error.message}
                </div>
            `;
        });
}

// Initialize Chart.js chart for CSV data visualization
function initializeChart(chartData) {
    const ctx = document.getElementById('dataChart').getContext('2d');
    
    // Destroy existing chart if it exists
    if (csvChart) {
        csvChart.destroy();
    }
    
    // Create timestamps for x-axis that are human-readable
    const labels = chartData.timestamps.map(ts => {
        const date = new Date(ts * 1000);
        return date.toTimeString().substring(0, 8); // HH:MM:SS format
    });
    
    // Create the chart
    csvChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: gettext('Speed'),
                    data: chartData.speed_values,
                    borderColor: 'rgba(75, 192, 192, 1)',
                    tension: 0.1,
                    yAxisID: 'y'
                },
                {
                    label: 'PWM',
                    data: chartData.pwm_values,
                    borderColor: 'rgba(255, 99, 132, 1)',
                    tension: 0.1,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    ticks: {
                        maxTicksLimit: 8,
                        maxRotation: 0,
                        minRotation: 0
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: gettext('Speed')
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'PWM'
                    },
                    grid: {
                        drawOnChartArea: false,
                    },
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                },
                tooltip: {
                    callbacks: {
                        title: function(tooltipItems) {
                            const idx = tooltipItems[0].dataIndex;
                            const timestamp = chartData.timestamps[idx];
                            const date = new Date(timestamp * 1000);
                            return date.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

// Initialize the noUiSlider range slider
function initializeRangeSlider(minTimestamp, maxTimestamp) {
    const sliderElement = document.getElementById('trimRangeSlider');
    
    // Clear existing slider if it exists
    while (sliderElement.firstChild) {
        sliderElement.removeChild(sliderElement.firstChild);
    }
    
    // Create a new slider
    noUiSlider.create(sliderElement, {
        start: [minTimestamp, maxTimestamp],
        connect: true,
        range: {
            'min': minTimestamp,
            'max': maxTimestamp
        }
    });
    
    // Update displays when slider changes
    sliderElement.noUiSlider.on('update', function (values, handle) {
        const startTimestamp = parseFloat(values[0]);
        const endTimestamp = parseFloat(values[1]);
        
        // Update time displays
        document.getElementById('startTimeDisplay').value = new Date(startTimestamp * 1000).toLocaleString();
        document.getElementById('endTimeDisplay').value = new Date(endTimestamp * 1000).toLocaleString();
        
        // Calculate selected records (approximate based on time range)
        const selectedPercentage = (endTimestamp - startTimestamp) / (csvData.max_timestamp - csvData.min_timestamp);
        const selectedRecords = Math.round(csvData.total_rows * selectedPercentage);
        document.getElementById('selectedRecords').textContent = selectedRecords;
    });
}

// Event listener for trim button
document.getElementById('trimDataButton').addEventListener('click', function() {
    if (!projectId || !csvData) {
        console.error('Project ID or CSV data not available');
        return;
    }
    
    // Get current slider values
    const sliderValues = document.getElementById('trimRangeSlider').noUiSlider.get();
    const startTimestamp = parseFloat(sliderValues[0]);
    const endTimestamp = parseFloat(sliderValues[1]);
    
    // Show loading state
    this.disabled = true;
    const originalText = this.textContent;
    this.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ' + 
                      document.getElementById('js-translation-trimming').textContent;
    
    // Get all current settings to update preview after trim
    const settings = getAllSettings();
    
    // Send trim request
    fetch(`/trim_csv/${projectId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            start_timestamp: startTimestamp,
            end_timestamp: endTimestamp,
            ...settings  // Include all current settings for preview update
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        
        // Update preview image
        document.getElementById('previewImage').src = data.preview_url + '?t=' + new Date().getTime();
        
        // Update CSV data and chart
        csvData = data;
        initializeChart(data.chart_data);
        
        // Reinitialize range slider with new values
        initializeRangeSlider(data.min_timestamp, data.max_timestamp);
    })
    .catch(error => {
        console.error('Error:', error);
        alert(gettext('Trim failed: ') + error.message);
    })
    .finally(() => {
        // Reset button state
        this.disabled = false;
        this.textContent = originalText;
    });
});

// Function to get all current settings
function getAllSettings() {
    return {
        // Resolution (from radio buttons)
        resolution: document.querySelector('input[name="resolution"]:checked').value,
        
        // FPS (from radio buttons)
        fps: parseFloat(document.querySelector('input[name="fps"]:checked').value),
        
        // Codec
        codec: document.getElementById('codec').value,
        
        // Interpolate values
        interpolate_values: document.getElementById('interpolateValues').checked,
        
        // Position settings
        vertical_position: parseInt(document.getElementById('verticalPosition').value),
        top_padding: parseInt(document.getElementById('topPadding').value),
        bottom_padding: parseInt(document.getElementById('bottomPadding').value),
        spacing: parseInt(document.getElementById('spacing').value),
        
        // Design settings
        font_size: parseInt(document.getElementById('fontSize').value),
        border_radius: parseInt(document.getElementById('borderRadius').value),
        
        // Speed indicator settings
        indicator_x: parseFloat(document.getElementById('indicatorX').value),
        indicator_y: parseFloat(document.getElementById('indicatorY').value),
        indicator_scale: parseFloat(document.getElementById('indicatorScale').value),
        speed_y: parseInt(document.getElementById('speedY').value),
        unit_y: parseInt(document.getElementById('unitY').value),
        speed_size: parseFloat(document.getElementById('speedSize').value),
        unit_size: parseFloat(document.getElementById('unitSize').value),
        
        // Visibility settings
        show_speed: document.getElementById('showSpeed').checked,
        show_max_speed: document.getElementById('showMaxSpeed').checked,
        show_voltage: document.getElementById('showVoltage').checked,
        show_temp: document.getElementById('showTemp').checked,
        show_battery: document.getElementById('showBattery').checked,
        show_mileage: document.getElementById('showMileage').checked,
        show_pwm: document.getElementById('showPWM').checked,
        show_power: document.getElementById('showPower').checked,
        show_current: document.getElementById('showCurrent').checked,
        show_gps: document.getElementById('showGPS').checked,
        show_bottom_elements: document.getElementById('showBottomElements').checked
    };
}

// Event listeners for settings changes
const settingsElements = [
    'verticalPosition', 'topPadding', 'bottomPadding', 'spacing',
    'fontSize', 'borderRadius', 'indicatorX', 'indicatorY', 
    'speedY', 'unitY', 'speedSize', 'unitSize', 'indicatorScale'
];

settingsElements.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener('input', function() {
            // Update any value displays
            const valueDisplay = document.getElementById(`${id}Value`);
            if (valueDisplay) {
                if (id.includes('Size') || id === 'indicatorScale') {
                    valueDisplay.textContent = this.value;
                } else {
                    valueDisplay.textContent = this.value;
                }
            }
        });
    }
});

// Start processing button
document.getElementById('startProcessButton').addEventListener('click', function() {
    if (!projectId) {
        console.error('No project ID available');
        return;
    }
    
    // Disable button and show processing section
    this.disabled = true;
    document.getElementById('processingProgress').style.display = 'block';
    
    // Reset progress UI
    const progressBar = document.getElementById('progressBar');
    progressBar.style.width = '0%';
    progressBar.setAttribute('aria-valuenow', 0);
    progressBar.className = 'progress-bar progress-bar-striped progress-bar-animated';
    document.getElementById('progressTitle').textContent = gettext('Processing...');
    document.getElementById('framesProcessed').textContent = '0';
    document.getElementById('totalFrames').textContent = '0';
    document.getElementById('elapsedTime').textContent = '0:00';
    document.getElementById('videoProcessingInfo').textContent = '';
    
    // Disable all controls in the preview section
    const previewSection = document.getElementById('previewSection');
    previewSection.querySelectorAll('input, button, select').forEach(el => {
        if (el !== this && el.id !== 'stopProcessingButton') {
            el.disabled = true;
        }
    });
    
    // Get all current settings
    const settings = getAllSettings();
    
    // Send request to start processing
    fetch(`/generate_frames/${projectId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings)
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            // Check if the error is about CSV file being too long
            if (data.error.includes('video longer than 2 hours')) {
                // Show modal with error message
                const modalBody = document.getElementById('csvTooLongModalBody');
                modalBody.textContent = data.error;
                const modal = new bootstrap.Modal(document.getElementById('csvTooLongModal'));
                modal.show();
            }
            throw new Error(data.error);
        }

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
                        case 'pending':
                            // Still waiting to start, check again in a moment
                            setTimeout(checkStatus, 1000);
                            break;
                            
                        case 'processing':
                            // Update progress
                            const progress = statusData.progress || 0;
                            progressBar.style.width = `${progress}%`;
                            progressBar.setAttribute('aria-valuenow', progress);
                            
                            // Update frame count if available
                            if (statusData.frame_count) {
                                document.getElementById('framesProcessed').textContent = statusData.frame_count;
                                
                                // Calculate total frames based on percent and frames done
                                if (progress > 0) {
                                    const totalFrames = Math.round(statusData.frame_count / (progress / 100));
                                    document.getElementById('totalFrames').textContent = totalFrames;
                                }
                            }
                            
                            // Update processing time
                            if (statusData.processing_time) {
                                document.getElementById('elapsedTime').textContent = statusData.processing_time;
                            }
                            
                            // Check again in a moment
                            setTimeout(checkStatus, 1000);
                            break;
                            
                        case 'completed':
                            progressBar.style.width = '100%';
                            progressBar.setAttribute('aria-valuenow', 100);
                            progressBar.classList.remove('progress-bar-animated');
                            progressBar.classList.add('bg-success');
                            progressTitle.textContent = gettext('Processing complete!');
                            
                            if (statusData.video_file) {
                                const videoUrl = `/download/${projectId}/video`;
                                videoProcessingInfo.innerHTML = `
                                    <div class="alert alert-success">
                                        ${gettext('Video processing completed successfully.')}
                                        <a href="${videoUrl}" class="btn btn-primary btn-sm ms-2" download>
                                            <i class="fas fa-download"></i> ${gettext('Download Video')}
                                        </a>
                                    </div>
                                `;
                            }
                            
                            // Re-enable all controls in the preview section
                            previewSection.querySelectorAll('input, button, select').forEach(el => {
                                el.disabled = false;
                            });
                            
                            this.disabled = false;
                            break;
                            
                        case 'error':
                            const errorMsg = statusData.error_message || gettext('Processing failed');
                            progressTitle.textContent = gettext('Error: ') + errorMsg;
                            progressBar.classList.add('bg-danger');
                            videoProcessingInfo.textContent = gettext('An error occurred during video processing.');
                            
                            // Re-enable all controls in the preview section
                            previewSection.querySelectorAll('input, button, select').forEach(el => {
                                el.disabled = false;
                            });
                            
                            this.disabled = false;
                            break;

                        default:
                            console.error('Unexpected status:', statusData.status);
                            progressTitle.textContent = gettext('Error: Unexpected status');
                            progressBar.classList.add('bg-danger');
                            videoProcessingInfo.textContent = gettext('An unexpected error occurred.');
                            
                            // Re-enable all controls in the preview section
                            previewSection.querySelectorAll('input, button, select').forEach(el => {
                                el.disabled = false;
                            });
                            
                            this.disabled = false;
                    }
                })
                .catch(error => {
                    console.error('Status check error:', error);
                    progressTitle.textContent = gettext('Error checking status: ') + error.message;
                    progressBar.classList.add('bg-danger');
                    
                    // Re-enable all controls in the preview section
                    previewSection.querySelectorAll('input, button, select').forEach(el => {
                        el.disabled = false;
                    });
                    
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

// Add preset management functionality
document.addEventListener('DOMContentLoaded', function() {
    loadPresets();  // Load presets when page loads

    // Reset to defaults button
    document.getElementById('resetDefaultsButton').addEventListener('click', function() {
        // Reset preset selection dropdown
        const presetSelect = document.getElementById('presetSelect');
        presetSelect.value = '';
        document.getElementById('deletePresetButton').disabled = true;
        
        // Reset all settings to defaults
        document.querySelector('input[value="fullhd"]').checked = true;
        document.querySelector('input[value="14.985"]').checked = true;
        document.getElementById('codec').value = 'h264';
        document.getElementById('interpolateValues').checked = true;
        
        // Position settings
        document.getElementById('verticalPosition').value = 50;
        document.getElementById('topPadding').value = 10;
        document.getElementById('bottomPadding').value = 30;
        document.getElementById('spacing').value = 20;
        
        // Design settings
        document.getElementById('fontSize').value = 26;
        document.getElementById('borderRadius').value = 13;
        
        // Speed indicator settings
        document.getElementById('indicatorX').value = 50;
        document.getElementById('indicatorY').value = 80;
        document.getElementById('speedY').value = 0;
        document.getElementById('unitY').value = 0;
        document.getElementById('speedSize').value = 100;
        document.getElementById('unitSize').value = 100;
        document.getElementById('indicatorScale').value = 100;
        
        // Visibility settings
        document.getElementById('showSpeed').checked = true;
        document.getElementById('showMaxSpeed').checked = true;
        document.getElementById('showVoltage').checked = true;
        document.getElementById('showTemp').checked = true;
        document.getElementById('showBattery').checked = true;
        document.getElementById('showGPS').checked = false;
        document.getElementById('showMileage').checked = true;
        document.getElementById('showPWM').checked = true;
        document.getElementById('showPower').checked = true;
        document.getElementById('showCurrent').checked = true;
        document.getElementById('showBottomElements').checked = true;
        
        // Update value displays
        settingsElements.forEach(id => {
            const valueDisplay = document.getElementById(`${id}Value`);
            if (valueDisplay) {
                valueDisplay.textContent = document.getElementById(id).value;
            }
        });
        
        // If we have a project ID, update the preview
        if (projectId) {
            updatePreview();
        }
    });
    
    // Save preset button (in modal)
    document.getElementById('confirmSavePreset').addEventListener('click', function() {
        const presetName = document.getElementById('presetName').value.trim();
        if (!presetName) {
            alert(gettext('Please enter a preset name'));
            return;
        }
        
        const settings = getAllSettings();
        
        // Send request to save preset
        fetch('/save_preset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: presetName,
                settings: settings
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            // Hide modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('savePresetModal'));
            modal.hide();
            
            // Clear preset name field
            document.getElementById('presetName').value = '';
            
            // Refresh presets list
            loadPresets();
        })
        .catch(error => {
            console.error('Error saving preset:', error);
            alert(gettext('Error saving preset: ') + error.message);
        });
    });
    
    // Preset select change event
    document.getElementById('presetSelect').addEventListener('change', function() {
        const presetId = this.value;
        document.getElementById('deletePresetButton').disabled = !presetId;
        
        if (!presetId) return;
        
        // Load preset
        fetch(`/get_preset/${presetId}`)
            .then(response => response.json())
            .then(data => {
                if (data.error) throw new Error(data.error);
                
                // Apply settings from preset
                applySettings(data.settings);
                
                // If we have a project ID, update the preview
                if (projectId) {
                    updatePreview();
                }
            })
            .catch(error => {
                console.error('Error loading preset:', error);
                alert(gettext('Error loading preset: ') + error.message);
            });
    });
    
    // Delete preset button
    document.getElementById('deletePresetButton').addEventListener('click', function() {
        const presetSelect = document.getElementById('presetSelect');
        const presetId = presetSelect.value;
        if (!presetId) return;
        
        const presetName = presetSelect.options[presetSelect.selectedIndex].text;
        
        if (!confirm(gettext('Are you sure you want to delete the preset "') + presetName + '"?')) {
            return;
        }
        
        // Send request to delete preset
        fetch(`/delete_preset/${presetId}`, {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            // Refresh presets list
            loadPresets();
        })
        .catch(error => {
            console.error('Error deleting preset:', error);
            alert(gettext('Error deleting preset: ') + error.message);
        });
    });
    
    // Stop processing button
    document.getElementById('stopProcessingButton').addEventListener('click', function() {
        if (!projectId) return;
        
        this.disabled = true;
        this.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ' + 
                          gettext('Stopping...');
        
        fetch(`/stop/${projectId}`, {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            // Update UI to show stopped state
            document.getElementById('progressTitle').textContent = gettext('Processing stopped');
            document.getElementById('progressBar').classList.remove('progress-bar-animated');
            document.getElementById('progressBar').classList.add('bg-warning');
            document.getElementById('videoProcessingInfo').textContent = gettext('Video processing was stopped by user.');
            
            // Re-enable buttons
            document.getElementById('startProcessButton').disabled = false;
            
            // Re-enable all controls in the preview section
            const previewSection = document.getElementById('previewSection');
            previewSection.querySelectorAll('input, button, select').forEach(el => {
                el.disabled = false;
            });
        })
        .catch(error => {
            console.error('Error stopping processing:', error);
            alert(gettext('Error stopping processing: ') + error.message);
        })
        .finally(() => {
            this.disabled = false;
            this.textContent = gettext('Stop Processing');
        });
    });
});

// Function to load presets
function loadPresets() {
    fetch('/get_presets')
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            const presetSelect = document.getElementById('presetSelect');
            
            // Clear current options except the first one
            while (presetSelect.options.length > 1) {
                presetSelect.remove(1);
            }
            
            // Add new options
            data.presets.forEach(preset => {
                const option = document.createElement('option');
                option.value = preset.id;
                option.textContent = preset.name;
                presetSelect.appendChild(option);
            });
            
            // Reset selected option and disable delete button
            presetSelect.value = '';
            document.getElementById('deletePresetButton').disabled = true;
        })
        .catch(error => {
            console.error('Error loading presets:', error);
        });
}

// Function to apply settings from a preset
function applySettings(settings) {
    // Only apply settings that exist in the UI
    
    // Resolution (radio buttons)
    if (settings.resolution) {
        const resolutionInput = document.querySelector(`input[name="resolution"][value="${settings.resolution}"]`);
        if (resolutionInput) resolutionInput.checked = true;
    }
    
    // FPS (radio buttons)
    if (settings.fps) {
        const fpsInput = document.querySelector(`input[name="fps"][value="${settings.fps}"]`);
        if (fpsInput) fpsInput.checked = true;
    }
    
    // Codec (select)
    if (settings.codec) {
        document.getElementById('codec').value = settings.codec;
    }
    
    // Interpolate values (checkbox)
    if (settings.hasOwnProperty('interpolate_values')) {
        document.getElementById('interpolateValues').checked = settings.interpolate_values;
    }
    
    // Slider settings
    const sliderSettings = [
        'vertical_position', 'top_padding', 'bottom_padding', 'spacing',
        'font_size', 'border_radius', 'indicator_x', 'indicator_y',
        'speed_y', 'unit_y', 'speed_size', 'unit_size', 'indicator_scale'
    ];
    
    sliderSettings.forEach(setting => {
        if (settings.hasOwnProperty(setting)) {
            const elementId = setting.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
            const element = document.getElementById(elementId);
            if (element) {
                element.value = settings[setting];
                
                // Update value display if it exists
                const valueDisplay = document.getElementById(`${elementId}Value`);
                if (valueDisplay) {
                    valueDisplay.textContent = settings[setting];
                }
            }
        }
    });
    
    // Visibility checkboxes
    const visibilitySettings = [
        'show_speed', 'show_max_speed', 'show_voltage', 'show_temp',
        'show_battery', 'show_mileage', 'show_pwm', 'show_power',
        'show_current', 'show_gps', 'show_bottom_elements'
    ];
    
    visibilitySettings.forEach(setting => {
        if (settings.hasOwnProperty(setting)) {
            const elementId = setting.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
            const element = document.getElementById(elementId);
            if (element) {
                element.checked = settings[setting];
            }
        }
    });
}

// Function to update preview with current settings
function updatePreview() {
    if (!projectId) return;
    
    const settings = getAllSettings();
    
    fetch(`/trim_csv/${projectId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            // Use current timestamps from the slider
            start_timestamp: parseFloat(document.getElementById('trimRangeSlider').noUiSlider.get()[0]),
            end_timestamp: parseFloat(document.getElementById('trimRangeSlider').noUiSlider.get()[1]),
            ...settings
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        
        // Update preview image with cache-busting query parameter
        document.getElementById('previewImage').src = data.preview_url + '?t=' + new Date().getTime();
        
        // Update CSV data and chart if needed
        if (data.chart_data) {
            csvData = data;
            initializeChart(data.chart_data);
        }
    })
    .catch(error => {
        console.error('Error updating preview:', error);
    });
}

// Add event listeners for all setting changes to update preview
document.addEventListener('DOMContentLoaded', function() {
    // Get all setting inputs
    const settingInputs = document.querySelectorAll('#previewSection input, #previewSection select');
    
    settingInputs.forEach(input => {
        // Skip the preset management elements
        if (input.id === 'presetSelect' || input.id === 'presetName') {
            return;
        }
        
        // Add appropriate event listener based on input type
        if (input.type === 'range') {
            input.addEventListener('change', updatePreview);
        } else if (input.type === 'radio' || input.type === 'checkbox' || input.tagName === 'SELECT') {
            input.addEventListener('change', updatePreview);
        }
    });
});

// Add event listener for project name validation
document.getElementById('projectName').addEventListener('input', function() {
    if (this.value.trim() === '') {
        // Empty is valid (auto-generated)
        this.classList.remove('is-invalid');
        return;
    }
    
    if (validateProjectName(this.value.trim())) {
        this.classList.remove('is-invalid');
    } else {
        this.classList.add('is-invalid');
    }
});
