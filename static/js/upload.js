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
    progressTitle.textContent = gettext('Uploading CSV...');

    // Disable form
    this.querySelectorAll('input, button').forEach(el => el.disabled = true);

    // Upload CSV and get preview
    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(gettext('Upload failed'));
        }
        return response.json();
    })
    .then(data => {
        if (data.error) throw new Error(data.error);

        projectId = data.project_id;
        console.log('Project ID after upload:', projectId); // Добавляем логирование
        updatePreview(projectId);
    })
    .catch(error => {
        console.error('Error:', error);
        progressTitle.textContent = gettext('Error: ') + error.message;
        progressBar.classList.add('bg-danger');
        // Re-enable form
        this.querySelectorAll('input, button').forEach(el => el.disabled = false);
    });
});

// CSV trimmer variables
let csvTimeRange = {
    min: 0,
    max: 0,
    start: 0,
    end: 0,
    totalRows: 0
};

// Speed chart variables
let speedChart = null;
let speedData = [];

// Function to format timestamp as date string
function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
}

// Function to update trimmer UI based on current selection
function updateTrimmerUI() {
    // Calculate percentages for positioning
    const totalRange = csvTimeRange.max - csvTimeRange.min;
    
    // Prevent division by zero
    if (totalRange === 0) {
        console.warn('Total time range is zero, cannot update UI');
        return;
    }
    
    const startPercent = ((csvTimeRange.start - csvTimeRange.min) / totalRange) * 100;
    const endPercent = ((csvTimeRange.end - csvTimeRange.min) / totalRange) * 100;
    
    console.log('Updating UI - start%:', startPercent, 'end%:', endPercent);
    
    // Update handle positions
    document.getElementById('startHandle').style.left = `${startPercent}%`;
    document.getElementById('endHandle').style.left = `${endPercent}%`;
    
    // Update selected area
    document.getElementById('timelineSelected').style.left = `${startPercent}%`;
    document.getElementById('timelineSelected').style.width = `${endPercent - startPercent}%`;
    
    // Update time displays
    document.getElementById('startTimeDisplay').textContent = formatTimestamp(csvTimeRange.start);
    document.getElementById('endTimeDisplay').textContent = formatTimestamp(csvTimeRange.end);
}

// Function to create or update the speed chart
function createOrUpdateSpeedChart(speedData) {
    console.log('createOrUpdateSpeedChart called with data points:', speedData.length);
    
    const canvas = document.getElementById('speedChart');
    if (!canvas) {
        console.error('Cannot find canvas element with id "speedChart"');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error('Failed to get 2D context from canvas');
        return;
    }
    
    // Prepare data for the chart
    const labels = speedData.map(item => new Date(item.timestamp * 1000));
    const speeds = speedData.map(item => item.speed);
    
    // Get the max speed for scaling the chart properly
    const maxSpeed = Math.max(...speeds, 0);
    console.log('Maximum speed value:', maxSpeed);
    
    if (speedChart) {
        console.log('Updating existing chart');
        // Update existing chart
        speedChart.data.labels = labels;
        speedChart.data.datasets[0].data = speeds;
        speedChart.options.scales.y.suggestedMax = Math.ceil(maxSpeed * 1.1); // Add 10% padding
        speedChart.update();
    } else {
        console.log('Creating new speed chart');
        // Create new chart
        try {
            speedChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Speed (km/h)',
                        data: speeds,
                        borderColor: 'rgba(75, 192, 192, 1)',
                        backgroundColor: 'rgba(75, 192, 192, 0.2)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        tooltip: {
                            callbacks: {
                                title: function(tooltipItems) {
                                    return new Date(tooltipItems[0].parsed.x).toLocaleString();
                                }
                            }
                        },
                        annotation: {
                            annotations: {}
                        }
                    },
                    scales: {
                        x: {
                            type: 'time',
                            time: {
                                unit: 'minute',
                                displayFormats: {
                                    minute: 'HH:mm'
                                }
                            },
                            title: {
                                display: true,
                                text: 'Time'
                            }
                        },
                        y: {
                            beginAtZero: true,
                            suggestedMax: Math.ceil(maxSpeed * 1.1), // Add 10% padding
                            title: {
                                display: true,
                                text: 'Speed (km/h)'
                            }
                        }
                    }
                }
            });
            console.log('Speed chart created successfully');
        } catch (error) {
            console.error('Failed to create chart:', error);
        }
    }
    
    // Update the chart when the selection handles move
    const startHandle = document.getElementById('startHandle');
    const endHandle = document.getElementById('endHandle');
    
    if (startHandle && endHandle) {
        startHandle.addEventListener('mousedown', updateChartSelection);
        endHandle.addEventListener('mousedown', updateChartSelection);
    } else {
        console.error('Cannot find handle elements:', 
            startHandle ? 'startHandle OK' : 'startHandle MISSING', 
            endHandle ? 'endHandle OK' : 'endHandle MISSING');
    }
}

// Function to update chart highlights based on selected range
function updateChartSelection() {
    if (!speedChart) return;
    
    // Calculate percentages for positioning
    const totalRange = csvTimeRange.max - csvTimeRange.min;
    const startPercent = ((csvTimeRange.start - csvTimeRange.min) / totalRange);
    const endPercent = ((csvTimeRange.end - csvTimeRange.min) / totalRange);
    
    // Highlight selected area in chart
    speedChart.options.plugins.annotation = {
        annotations: {
            box1: {
                type: 'box',
                xMin: speedChart.scales.x.min + (speedChart.scales.x.max - speedChart.scales.x.min) * startPercent,
                xMax: speedChart.scales.x.min + (speedChart.scales.x.max - speedChart.scales.x.min) * endPercent,
                backgroundColor: 'rgba(75, 192, 192, 0.3)',
                borderColor: 'rgba(75, 192, 192, 0.8)',
                borderWidth: 1
            }
        }
    };
    
    speedChart.update();
}

function initCsvTrimmer(projectId) {
    console.log('Initializing CSV trimmer for project ID:', projectId);
    
    fetch(`/get_csv_timerange/${projectId}`)
        .then(response => {
            console.log('CSV timerange response status:', response.status);
            return response.json();
        })
        .then(data => {
            if (data.error) {
                console.error('Error in get_csv_timerange response:', data.error);
                throw new Error(data.error);
            }
            
            console.log('CSV timerange data received:', data);
            
            // Store time range data
            csvTimeRange.min = data.min_timestamp;
            csvTimeRange.max = data.max_timestamp;
            csvTimeRange.start = data.min_timestamp;
            csvTimeRange.end = data.max_timestamp;
            csvTimeRange.totalRows = data.total_rows;
            
            // Store speed data for the chart
            if (data.speed_data) {
                speedData = data.speed_data;
                // Create or update the speed chart
                createOrUpdateSpeedChart(speedData);
            }
            
            // Update UI elements
            document.getElementById('totalRecordsInfo').textContent = data.total_rows.toLocaleString();
            document.getElementById('csvTrimmerCard').classList.remove('d-none');
            
            // Initialize trimmer UI
            updateTrimmerUI();
            
            // Set up drag handlers for the slider
            setupTrimmerHandlers();
        })
        .catch(error => {
            console.error('Error initializing CSV trimmer:', error);
            // Keep trimmer hidden if there's an error
        });
}

// Set up drag handlers for the slider
function setupTrimmerHandlers() {
    const startHandle = document.getElementById('startHandle');
    const endHandle = document.getElementById('endHandle');
    const container = document.getElementById('trimRangeContainer');
    let isDragging = false;
    let currentHandle = null;
    
    // Function to calculate timestamp from a pixel position
    function getTimestampFromPosition(position, width) {
        const totalRange = csvTimeRange.max - csvTimeRange.min;
        const percent = Math.max(0, Math.min(100, (position / width) * 100)) / 100;
        return csvTimeRange.min + (totalRange * percent);
    }
    
    // Start dragging
    const startDrag = function(e) {
        console.log('Start dragging handle:', this.id);
        isDragging = true;
        currentHandle = this;
        e.preventDefault();
    };
    
    // Drag handling
    const drag = function(e) {
        if (!isDragging || !currentHandle) return;
        
        // Get updated container position and dimensions
        const containerRect = container.getBoundingClientRect();
        const containerWidth = containerRect.width;
        
        // Calculate position within container
        let position = e.clientX - containerRect.left;
        position = Math.max(0, Math.min(containerWidth, position));
        
        console.log('Dragging at position:', position, 'container width:', containerWidth);
        
        // Calculate new timestamp
        const timestamp = getTimestampFromPosition(position, containerWidth);
        
        if (currentHandle === startHandle) {
            // Ensure start is not after end
            if (timestamp < csvTimeRange.end) {
                csvTimeRange.start = timestamp;
                updateTrimmerUI();
                updateChartSelection(); // Update chart selection on drag
            }
        } else if (currentHandle === endHandle) {
            // Ensure end is not before start
            if (timestamp > csvTimeRange.start) {
                csvTimeRange.end = timestamp;
                updateTrimmerUI();
                updateChartSelection(); // Update chart selection on drag
            }
        }
    };
    
    // End dragging
    const endDrag = function() {
        console.log('End dragging');
        isDragging = false;
        currentHandle = null;
    };
    
    // Add event listeners for mouse and touch
    // Mouse events
    startHandle.addEventListener('mousedown', startDrag);
    endHandle.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', endDrag);
    
    // Touch events for mobile
    startHandle.addEventListener('touchstart', function(e) {
        console.log('Touch start on handle:', this.id);
        isDragging = true;
        currentHandle = this;
        e.preventDefault(); // Prevent scrolling when touching the handles
    });
    
    endHandle.addEventListener('touchstart', function(e) {
        console.log('Touch start on handle:', this.id);
        isDragging = true;
        currentHandle = this;
        e.preventDefault(); // Prevent scrolling when touching the handles
    });
    
    document.addEventListener('touchmove', function(e) {
        if (!isDragging || !currentHandle) return;
        
        // Get updated container position and dimensions
        const containerRect = container.getBoundingClientRect();
        const containerWidth = containerRect.width;
        
        // Use the first touch point
        const touch = e.touches[0];
        
        // Calculate position within container
        let position = touch.clientX - containerRect.left;
        position = Math.max(0, Math.min(containerWidth, position));
        
        console.log('Touch move at position:', position, 'container width:', containerWidth);
        
        // Calculate new timestamp
        const timestamp = getTimestampFromPosition(position, containerWidth);
        
        if (currentHandle === startHandle) {
            // Ensure start is not after end
            if (timestamp < csvTimeRange.end) {
                csvTimeRange.start = timestamp;
                updateTrimmerUI();
                updateChartSelection(); // Update chart selection on drag
            }
        } else if (currentHandle === endHandle) {
            // Ensure end is not before start
            if (timestamp > csvTimeRange.start) {
                csvTimeRange.end = timestamp;
                updateTrimmerUI();
                updateChartSelection(); // Update chart selection on drag
            }
        }
        
        e.preventDefault(); // Prevent scrolling during drag
    });
    
    document.addEventListener('touchend', function() {
        console.log('Touch end');
        isDragging = false;
        currentHandle = null;
    });
    
    // Add trim button handler
    document.getElementById('trimCsvButton').addEventListener('click', function() {
        const projectId = document.getElementById('startProcessButton').dataset.projectId;
        if (!projectId) return;
        
        this.disabled = true;
        this.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ' + gettext('Trimming...');
        
        // Get current display settings
        const settings = {
            resolution: document.querySelector('input[name="resolution"]:checked').value,
            vertical_position: document.getElementById('verticalPosition').value,
            top_padding: document.getElementById('topPadding').value,
            bottom_padding: document.getElementById('bottomPadding').value,
            spacing: document.getElementById('spacing').value,
            font_size: document.getElementById('fontSize').value,
            border_radius: document.getElementById('borderRadius').value,
            indicator_scale: document.getElementById('indicatorScale').value,
            indicator_x: document.getElementById('indicatorX').value,
            indicator_y: document.getElementById('indicatorY').value,
            speed_y: document.getElementById('speedY').value,
            unit_y: document.getElementById('unitY').value,
            speed_size: document.getElementById('speedSize').value,
            unit_size: document.getElementById('unitSize').value,
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
            show_bottom_elements: document.getElementById('showBottomElements').checked,
            start_timestamp: csvTimeRange.start,
            end_timestamp: csvTimeRange.end
        };
        
        // Send request to trim CSV
        fetch(`/trim_csv/${projectId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(settings)
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            // Update time range data
            csvTimeRange.min = data.min_timestamp;
            csvTimeRange.max = data.max_timestamp;
            csvTimeRange.start = data.min_timestamp;
            csvTimeRange.end = data.max_timestamp;
            csvTimeRange.totalRows = data.total_rows;
            
            // Update speed data if available
            if (data.speed_data) {
                speedData = data.speed_data;
                createOrUpdateSpeedChart(speedData);
            }
            
            // Update UI elements
            document.getElementById('totalRecordsInfo').textContent = data.total_rows.toLocaleString();
            updateTrimmerUI();
            
            // Update preview image
            document.getElementById('previewImage').src = data.preview_url + '?t=' + new Date().getTime();
            
            // Re-enable trim button
            this.disabled = false;
            this.innerHTML = '<i class="fas fa-cut me-1"></i> ' + gettext('Trim Data');
        })
        .catch(error => {
            console.error('Error trimming CSV:', error);
            // Re-enable trim button
            this.disabled = false;
            this.innerHTML = '<i class="fas fa-cut me-1"></i> ' + gettext('Trim Data');
            alert(gettext('Error trimming CSV: ') + error.message);
        });
    });
}

// Function to update preview with current settings
function updatePreview(projectId) {
    const previewSection = document.getElementById('previewSection');
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');

    // Check resolution and adjust offsets if needed
    const resolution = document.querySelector('input[name="resolution"]:checked').value;
    if (resolution === '4k') {
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

    // Get current values with updated settings
    const settings = {
        resolution: resolution,
        vertical_position: document.getElementById('verticalPosition').value,
        top_padding: document.getElementById('topPadding').value,
        bottom_padding: document.getElementById('bottomPadding').value,
        spacing: document.getElementById('spacing').value,
        font_size: document.getElementById('fontSize').value,
        border_radius: document.getElementById('borderRadius').value,
        // Speed indicator settings
        indicator_scale: document.getElementById('indicatorScale').value,
        indicator_x: document.getElementById('indicatorX').value,
        indicator_y: document.getElementById('indicatorY').value,
        speed_y: document.getElementById('speedY').value,
        unit_y: document.getElementById('unitY').value,
        speed_size: document.getElementById('speedSize').value,
        unit_size: document.getElementById('unitSize').value,
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
        
        // Initialize CSV trimmer with the current project ID
        initCsvTrimmer(projectId);
    })
    .catch(error => {
        console.error('Error:', error);
        progressTitle.textContent = gettext('Error: ') + error.message;
        progressBar.classList.add('bg-danger');
        // Re-enable form
        document.querySelectorAll('input, button').forEach(el => el.disabled = false);
    });
}

// Add real-time validation for project name input
document.getElementById('projectName').addEventListener('input', function() {
    const value = this.value.trim();

    if (value.length > 7) {
        this.classList.add('is-invalid');
        document.getElementById('projectNameFeedback').textContent = gettext('Project name must be 7 characters or less');
    } else if (value && !/^[\p{L}\d]+$/u.test(value)) {
        this.classList.add('is-invalid');
        document.getElementById('projectNameFeedback').textContent = gettext('Project name must contain only letters and numbers');
    } else {
        this.classList.remove('is-invalid');
    }
});

// Set up range input values display
document.querySelectorAll('input[type="range"]').forEach(range => {
    const valueDisplay = document.getElementById(range.id + 'Value');
    if (valueDisplay) {
        valueDisplay.textContent = range.value;
        range.addEventListener('input', () => {
            valueDisplay.textContent = range.value;
            // For preview updates, debounce to prevent too many requests
            if (previewUpdateTimeout) clearTimeout(previewUpdateTimeout);
            previewUpdateTimeout = setTimeout(schedulePreviewUpdate, 500);
        });
    }
});

// Preview update
let previewUpdateTimeout = null;
let previewUpdateScheduled = false;

function schedulePreviewUpdate() {
    if (previewUpdateScheduled) return;
    previewUpdateScheduled = true;
    
    // Schedule update after UI thread is done updating
    setTimeout(() => {
        const projectId = document.getElementById('startProcessButton')?.dataset?.projectId;
        if (projectId) {
            const button = document.getElementById('updatePreviewButton');
            button.classList.add('pulsing');
            button.disabled = false;
        }
        previewUpdateScheduled = false;
    }, 100);
}

// Add event listener to update preview button
document.getElementById('updatePreviewButton')?.addEventListener('click', function() {
    const projectId = document.getElementById('startProcessButton')?.dataset?.projectId;
    if (!projectId) return;
    
    this.disabled = true;
    this.classList.remove('pulsing');
    updatePreview(projectId);
});

// Wait for checkbox values to be updated when loading page
document.addEventListener('DOMContentLoaded', function() {
    // Default checkbox values
    document.getElementById('showSpeed').checked = false;
    document.getElementById('showMaxSpeed').checked = true;
    document.getElementById('showVoltage').checked = true;
    document.getElementById('showTemp').checked = true;
    document.getElementById('showBattery').checked = true;
    document.getElementById('showMileage').checked = true;
    document.getElementById('showPWM').checked = false;
    document.getElementById('showPower').checked = true;
    document.getElementById('showCurrent').checked = false;
    document.getElementById('showGPS').checked = false;
    document.getElementById('showBottomElements').checked = true;
    
    // Set up checkbox listeners for preview updates
    document.querySelectorAll('.form-check-input').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            if (previewUpdateTimeout) clearTimeout(previewUpdateTimeout);
            previewUpdateTimeout = setTimeout(schedulePreviewUpdate, 250);
        });
    });
    
    // Set up radio button listeners for preview updates
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (previewUpdateTimeout) clearTimeout(previewUpdateTimeout);
            previewUpdateTimeout = setTimeout(schedulePreviewUpdate, 250);
        });
    });
    
    // Load and display presets
    loadPresets();
    
    // Handle start button
    document.getElementById('startProcessButton')?.addEventListener('click', function() {
        const projectId = this.dataset.projectId;
        if (!projectId) return;
        
        // Get current settings to send to server
        const settings = {
            resolution: document.querySelector('input[name="resolution"]:checked').value,
            fps: document.getElementById('fps').value,
            codec: document.querySelector('input[name="codec"]:checked').value,
            vertical_position: document.getElementById('verticalPosition').value,
            top_padding: document.getElementById('topPadding').value,
            bottom_padding: document.getElementById('bottomPadding').value,
            spacing: document.getElementById('spacing').value,
            font_size: document.getElementById('fontSize').value,
            border_radius: document.getElementById('borderRadius').value,
            indicator_scale: document.getElementById('indicatorScale').value,
            indicator_x: document.getElementById('indicatorX').value,
            indicator_y: document.getElementById('indicatorY').value,
            speed_y: document.getElementById('speedY').value,
            unit_y: document.getElementById('unitY').value,
            speed_size: document.getElementById('speedSize').value,
            unit_size: document.getElementById('unitSize').value,
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
            show_bottom_elements: document.getElementById('showBottomElements').checked,
            interpolate_values: document.getElementById('interpolateValues').checked
        };
        
        // Show processing info
        const videoProcessingInfo = document.getElementById('videoProcessingInfo');
        videoProcessingInfo.classList.remove('d-none');
        
        // Disable button to prevent multiple submissions
        this.disabled = true;
        this.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ' + gettext('Starting...');
        
        fetch(`/process/${projectId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(settings)
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            // Hide buttons and show "Started" message
            document.getElementById('projectButtons').classList.add('d-none');
            
            // Show success message
            const successMessage = document.createElement('div');
            successMessage.className = 'alert alert-success mt-3';
            successMessage.innerHTML = `
                <h5>${gettext('Video processing started!')}</h5>
                <p>${gettext('You can close your browser and come back later - the video processing will continue in the background.')}</p>
                <p>${gettext('Alternatively, you can go to the Projects section to monitor the progress there.')}</p>
                <div class="mt-3">
                    <a href="/list" class="btn btn-primary">${gettext('View Projects')}</a>
                </div>
            `;
            
            document.getElementById('processingStatus').appendChild(successMessage);
            
            // Set up status polling
            pollProcessingStatus(projectId);
        })
        .catch(error => {
            console.error('Error starting processing:', error);
            alert(gettext('An error occurred while starting the video processing.'));
            
            // Re-enable button
            this.disabled = false;
            this.innerHTML = gettext('Start Processing');
        });
    });
    
    // Set up preset save button
    document.getElementById('savePresetButton')?.addEventListener('click', function() {
        const presetName = document.getElementById('presetName').value.trim();
        if (!presetName) {
            alert(gettext('Please enter a name for the preset'));
            return;
        }
        
        const settings = {
            preset_name: presetName,
            resolution: document.querySelector('input[name="resolution"]:checked').value,
            fps: document.getElementById('fps').value,
            codec: document.querySelector('input[name="codec"]:checked').value,
            vertical_position: document.getElementById('verticalPosition').value,
            top_padding: document.getElementById('topPadding').value,
            bottom_padding: document.getElementById('bottomPadding').value,
            spacing: document.getElementById('spacing').value,
            font_size: document.getElementById('fontSize').value,
            border_radius: document.getElementById('borderRadius').value,
            indicator_scale: document.getElementById('indicatorScale').value,
            indicator_x: document.getElementById('indicatorX').value,
            indicator_y: document.getElementById('indicatorY').value,
            speed_y: document.getElementById('speedY').value,
            unit_y: document.getElementById('unitY').value,
            speed_size: document.getElementById('speedSize').value,
            unit_size: document.getElementById('unitSize').value,
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
            show_bottom_elements: document.getElementById('showBottomElements').checked,
            interpolate_values: document.getElementById('interpolateValues').checked
        };
        
        fetch('/save_preset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(settings)
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            // Clear preset name
            document.getElementById('presetName').value = '';
            
            // Show success message
            alert(gettext('Preset saved successfully'));
            
            // Reload presets
            loadPresets();
        })
        .catch(error => {
            console.error('Error saving preset:', error);
            alert(gettext('Error saving preset: ') + error.message);
        });
    });
});

// Function to load presets
function loadPresets() {
    fetch('/get_presets')
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            const presetsContainer = document.getElementById('presetsContainer');
            presetsContainer.innerHTML = '';
            
            if (data.presets && data.presets.length > 0) {
                document.getElementById('presetsCard').classList.remove('d-none');
                
                data.presets.forEach(preset => {
                    const presetCard = document.createElement('div');
                    presetCard.className = 'col-md-4 mb-3';
                    presetCard.innerHTML = `
                        <div class="card h-100">
                            <div class="card-body">
                                <h5 class="card-title">${preset.name}</h5>
                                <p class="card-text text-muted small">${new Date(preset.created_at).toLocaleString()}</p>
                                <div class="d-flex justify-content-between">
                                    <button class="btn btn-sm btn-primary load-preset-btn" data-preset-id="${preset.id}">
                                        ${gettext('Load')}
                                    </button>
                                    <button class="btn btn-sm btn-outline-danger delete-preset-btn" data-preset-id="${preset.id}">
                                        ${gettext('Delete')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                    presetsContainer.appendChild(presetCard);
                });
                
                // Add event listeners for preset load buttons
                document.querySelectorAll('.load-preset-btn').forEach(button => {
                    button.addEventListener('click', function() {
                        const presetId = this.dataset.presetId;
                        fetch(`/get_preset/${presetId}`)
                            .then(response => response.json())
                            .then(data => {
                                if (data.error) throw new Error(data.error);
                                
                                const settings = data.settings;
                                
                                // Apply settings
                                document.querySelectorAll('input[name="resolution"]').forEach(radio => {
                                    radio.checked = (radio.value === settings.resolution);
                                });
                                
                                document.getElementById('fps').value = settings.fps;
                                
                                document.querySelectorAll('input[name="codec"]').forEach(radio => {
                                    radio.checked = (radio.value === settings.codec);
                                });
                                
                                // Update range inputs
                                const rangeInputs = [
                                    'verticalPosition', 'topPadding', 'bottomPadding', 'spacing', 'fontSize', 'borderRadius',
                                    'indicatorScale', 'indicatorX', 'indicatorY', 'speedY', 'unitY', 'speedSize', 'unitSize'
                                ];
                                
                                rangeInputs.forEach(input => {
                                    const inputEl = document.getElementById(input);
                                    const valueKey = input.charAt(0).toLowerCase() + input.slice(1);
                                    if (settings[valueKey] !== undefined) {
                                        inputEl.value = settings[valueKey];
                                        document.getElementById(input + 'Value').textContent = settings[valueKey];
                                    }
                                });
                                
                                // Update checkboxes
                                const checkboxes = [
                                    'showSpeed', 'showMaxSpeed', 'showVoltage', 'showTemp', 'showBattery',
                                    'showMileage', 'showPWM', 'showPower', 'showCurrent', 'showGPS',
                                    'showBottomElements', 'interpolateValues'
                                ];
                                
                                checkboxes.forEach(checkbox => {
                                    const checkboxEl = document.getElementById(checkbox);
                                    const valueKey = checkbox.charAt(0).toLowerCase() + checkbox.slice(1);
                                    if (settings[valueKey] !== undefined) {
                                        checkboxEl.checked = settings[valueKey];
                                    }
                                });
                                
                                // Trigger preview update
                                schedulePreviewUpdate();
                            })
                            .catch(error => {
                                console.error('Error loading preset:', error);
                                alert(gettext('Error loading preset: ') + error.message);
                            });
                    });
                });
                
                // Add event listeners for preset delete buttons
                document.querySelectorAll('.delete-preset-btn').forEach(button => {
                    button.addEventListener('click', function() {
                        if (!confirm(gettext('Are you sure you want to delete this preset?'))) return;
                        
                        const presetId = this.dataset.presetId;
                        fetch(`/delete_preset/${presetId}`, { method: 'POST' })
                            .then(response => response.json())
                            .then(data => {
                                if (data.error) throw new Error(data.error);
                                
                                // Reload presets
                                loadPresets();
                            })
                            .catch(error => {
                                console.error('Error deleting preset:', error);
                                alert(gettext('Error deleting preset: ') + error.message);
                            });
                    });
                });
            } else {
                document.getElementById('presetsCard').classList.add('d-none');
            }
        })
        .catch(error => {
            console.error('Error loading presets:', error);
        });
}

// Processing status polling
function pollProcessingStatus(projectId) {
    // Function to update progress bar
    function updateProgressBar(progress, status, message) {
        const progressBar = document.getElementById('processingProgressBar');
        const progressText = document.getElementById('processingProgressText');
        
        if (!progressBar || !progressText) return;
        
        progressBar.style.width = progress + '%';
        progressBar.setAttribute('aria-valuenow', progress);
        
        let statusText = '';
        switch (status) {
            case 'pending':
                statusText = gettext('Waiting to start...');
                break;
            case 'processing':
                statusText = gettext('Processing: ') + progress.toFixed(0) + '%';
                break;
            case 'completed':
                statusText = gettext('Complete!');
                break;
            case 'error':
                statusText = gettext('Error: ') + message;
                break;
            case 'stopped':
                statusText = gettext('Processing stopped');
                break;
            default:
                statusText = gettext('Unknown status');
        }
        
        progressText.textContent = statusText;
        
        if (status === 'completed' || status === 'error' || status === 'stopped') {
            // Stop polling on terminal states
            return false;
        }
        
        return true;
    }
    
    // Set up interval for status polling
    const statusInterval = setInterval(() => {
        fetch(`/project_status/${projectId}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(gettext('No status received from server'));
                }
                return response.json();
            })
            .then(data => {
                if (data.error) throw new Error(data.error);
                
                const shouldContinue = updateProgressBar(
                    data.progress,
                    data.status,
                    data.error_message
                );
                
                if (!shouldContinue) {
                    clearInterval(statusInterval);
                    
                    if (data.status === 'completed') {
                        // Show success message for completed processing
                        document.getElementById('videoProcessingSuccess').classList.remove('d-none');
                        // Update video link
                        document.getElementById('downloadVideoBtn').href = `/download_file/${projectId}/video`;
                    } else if (data.status === 'error') {
                        // Show error message
                        const errorMsg = document.getElementById('videoProcessingError');
                        errorMsg.textContent = gettext('Error: ') + data.error_message;
                        errorMsg.classList.remove('d-none');
                    }
                }
            })
            .catch(error => {
                console.error(gettext('Error checking status: '), error);
                clearInterval(statusInterval);
            });
    }, 2000); // Check every 2 seconds
}