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

// Function to initialize CSV trimmer after upload
// Function to create or update the speed chart
function createOrUpdateSpeedChart(speedData) {
    const ctx = document.getElementById('speedChart').getContext('2d');
    
    // Prepare data for the chart
    const labels = speedData.map(item => new Date(item.timestamp * 1000));
    const speeds = speedData.map(item => item.speed);
    
    // Get the max speed for scaling the chart properly
    const maxSpeed = Math.max(...speeds, 0);
    
    if (speedChart) {
        // Update existing chart
        speedChart.data.labels = labels;
        speedChart.data.datasets[0].data = speeds;
        speedChart.options.scales.y.suggestedMax = Math.ceil(maxSpeed * 1.1); // Add 10% padding
        speedChart.update();
    } else {
        // Create new chart
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
    }
    
    // Update the chart when the selection handles move
    document.getElementById('startHandle').addEventListener('mousedown', updateChartSelection);
    document.getElementById('endHandle').addEventListener('mousedown', updateChartSelection);
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
            }
        } else if (currentHandle === endHandle) {
            // Ensure end is not before start
            if (timestamp > csvTimeRange.start) {
                csvTimeRange.end = timestamp;
                updateTrimmerUI();
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
            }
        } else if (currentHandle === endHandle) {
            // Ensure end is not before start
            if (timestamp > csvTimeRange.start) {
                csvTimeRange.end = timestamp;
                updateTrimmerUI();
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

// Add event listeners for text display settings
const textSettings = ['verticalPosition', 'topPadding', 'bottomPadding', 'spacing', 'fontSize', 'borderRadius'];
const speedIndicatorSettings = ['indicatorScale', 'indicatorX', 'indicatorY', 'speedSize', 'speedY', 'unitSize', 'unitY'];

// Combine all settings
const allSettings = [...textSettings, ...speedIndicatorSettings];

// Add event listener for resolution change
document.querySelectorAll('input[name="resolution"]').forEach(radio => {
    radio.addEventListener('change', function() {
        const projectId = document.getElementById('startProcessButton').dataset.projectId;
        if (projectId) {
            // Adjust slider values based on resolution
            if (this.value === '4k') {
                // Set specific values for 4K
                document.getElementById('speedY').value = -50;
                document.getElementById('speedYValue').textContent = '-50';
                document.getElementById('unitY').value = 65;
                document.getElementById('unitYValue').textContent = '65';
            } else {
                // Reset to default values for Full HD
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
        // Update value display without adding unit if it's already in the display text
        const currentText = valueDisplay.textContent;
        const value = this.value;

        // Check if the current text already contains a unit
        if (currentText.includes('%') || currentText.includes('px')) {
            valueDisplay.textContent = value;
        } else {
            // Add unit only if it's not already present
            valueDisplay.textContent = value + (
                this.id === 'speedSize' || this.id === 'unitSize' || this.id.includes('indicator') ? '%' : 'px'
            );
        }

        // Debounce the preview update
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => {
            const projectId = document.getElementById('startProcessButton').dataset.projectId;
            if (projectId) {
                // Get current values for all settings including visibility
                const settings = {
                    resolution: document.querySelector('input[name="resolution"]:checked').value,
                    vertical_position: document.getElementById('verticalPosition').value,
                    top_padding: document.getElementById('topPadding').value,
                    bottom_padding: document.getElementById('bottomPadding').value,
                    spacing: document.getElementById('spacing').value,
                    font_size: document.getElementById('fontSize').value,
                    border_radius: document.getElementById('borderRadius').value,
                    // Speed indicator settings
                    indicator_x: document.getElementById('indicatorX').value,
                    indicator_y: document.getElementById('indicatorY').value,
                    speed_y: document.getElementById('speedY').value,
                    unit_y: document.getElementById('unitY').value,
                    speed_size: document.getElementById('speedSize').value,
                    unit_size: document.getElementById('unitSize').value,
                    indicator_scale: document.getElementById('indicatorScale').value,
                    // Add visibility settings
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

                // Update preview with all current settings
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
                    document.getElementById('previewImage').src = data.preview_url + '?t=' + new Date().getTime();
                })
                .catch(error => {
                    console.error('Error updating preview:', error);
                });
            }
        }, 300);
    });
});

// Add event listeners for visibility checkboxes
const visibilitySettings = [
    'showSpeed', 'showMaxSpeed', 'showVoltage', 'showTemp', 
    'showBattery', 'showMileage', 'showPWM', 'showPower', 
    'showCurrent', 'showGPS', 'showBottomElements'
];

visibilitySettings.forEach(setting => {
    const checkbox = document.getElementById(setting);
    if (checkbox) {
        checkbox.addEventListener('change', function() {
            const projectId = document.getElementById('startProcessButton').dataset.projectId;
            if (projectId) {
                updatePreview(projectId);
            }
        });
    }
});

// Handle start processing button click
document.getElementById('startProcessButton').addEventListener('click', function() {
    const projectId = this.dataset.projectId;
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');
    const videoProcessingInfo = document.getElementById('videoProcessingInfo');
    const previewSection = document.getElementById('previewSection');

    // Show progress bar and processing info
    progressDiv.classList.remove('d-none');
    videoProcessingInfo.classList.remove('d-none');
    
    // Disable all elements in the preview section above the start process button
    // Including all settings sliders, checkboxes, radio buttons and preset controls
    previewSection.querySelectorAll('input, button, select').forEach(el => {
        // Skip the start process button itself as it's already being disabled
        if (el !== this) {
            el.disabled = true;
        }
    });
    
    // Also disable the start process button
    this.disabled = true;

    // Set initial background processing message
    videoProcessingInfo.textContent = gettext("You can close your browser and come back later - the video processing will continue in the background.");

    // Get all current settings
    const settings = {
        resolution: document.querySelector('input[name="resolution"]:checked').value,
        fps: document.querySelector('input[name="fps"]:checked').value,
        codec: document.querySelector('input[name="codec"]:checked').value,
        interpolate_values: document.getElementById('interpolateValues').checked,
        vertical_position: document.getElementById('verticalPosition').value,
        top_padding: document.getElementById('topPadding').value,
        bottom_padding: document.getElementById('bottomPadding').value,
        spacing: document.getElementById('spacing').value,
        font_size: document.getElementById('fontSize').value,
        border_radius: document.getElementById('borderRadius').value,
        indicator_x: document.getElementById('indicatorX').value,
        indicator_y: document.getElementById('indicatorY').value,
        speed_y: document.getElementById('speedY').value,
        unit_y: document.getElementById('unitY').value,
        speed_size: document.getElementById('speedSize').value,
        unit_size: document.getElementById('unitSize').value,
        indicator_scale: document.getElementById('indicatorScale').value,
        // Add visibility settings
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
                        case 'processing':
                            const progress = statusData.progress || 0;
                            progressTitle.textContent = progress <= 50 ? 
                                gettext('Creating frames...') : 
                                gettext('Encoding video...');
                            progressBar.style.width = `${progress}%`;
                            progressBar.textContent = `${progress.toFixed(1)}%`;
                            // Show processing stage below the main message
                            videoProcessingInfo.textContent = gettext('You can close your browser and come back later - the video processing will continue in the background.') + ' ' +
                                gettext('Alternatively, you can go to the Projects section to monitor the progress there.');
                            setTimeout(checkStatus, progress <= 50 ? 200 : 1000);
                            break;

                        case 'completed':
                            progressBar.style.width = '100%';
                            progressBar.textContent = '100%';
                            progressTitle.textContent = gettext('Complete!');
                            videoProcessingInfo.textContent = gettext('Video processing completed successfully!');
                            setTimeout(() => {
                                window.location.href = '/projects';
                            }, 1000);
                            break;

                        case 'pending':
                            progressTitle.textContent = gettext('Waiting to start...');
                            videoProcessingInfo.textContent = gettext('You can close your browser and come back later - the video processing will continue in the background.');
                            setTimeout(checkStatus, 500);
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
                    videoProcessingInfo.textContent = gettext('An error occurred while checking the processing status.');
                    
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

        // Reset resolution
        document.querySelector('input[name="resolution"][value="fullhd"]').checked = true;
        // Reset FPS
        document.querySelector('input[name="fps"][value="14.985"]').checked = true;
        // Reset codec
        document.querySelector('input[name="codec"][value="h264"]').checked = true;
        // Reset interpolation
        document.getElementById('interpolateValues').checked = true;

        // Reset all sliders to their default values
        const defaultValues = {
            'verticalPosition': 1,
            'borderRadius': 13,
            'topPadding': 14,
            'bottomPadding': 45,
            'spacing': 10,
            'fontSize': 23,
            'indicatorScale': 50,
            'indicatorX': 50,
            'indicatorY': 126,
            'speedSize': 75,
            'speedY': -28,
            'unitSize': 40,
            'unitY': 36
        };

        Object.entries(defaultValues).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.value = value;
                const valueDisplay = document.getElementById(id + 'Value');
                if (valueDisplay) {
                    // Add unit if needed
                    const unit = id.includes('Size') || id.includes('indicator') ? '%' : 'px';
                    valueDisplay.textContent = value + (id === 'verticalPosition' ? '%' : unit);
                }
            }
        });

        // Reset visibility checkboxes
        const visibilityDefaults = {
            'showSpeed': false,
            'showMaxSpeed': true,
            'showVoltage': true,
            'showTemp': true,
            'showBattery': true,
            'showMileage': true,
            'showPWM': true,
            'showPower': true,
            'showCurrent': true,
            'showGPS': true,
            'showBottomElements': true
        };

        Object.entries(visibilityDefaults).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.checked = value;
            }
        });

        // Update preview if project is loaded
        const projectId = document.getElementById('startProcessButton').dataset.projectId;
        if (projectId) {
            updatePreview(projectId);
        }
    });

    // Save preset button
    document.getElementById('confirmSavePreset').addEventListener('click', function() {
        const presetName = document.getElementById('presetName').value.trim();
        if (!presetName) {
            alert(gettext('Please enter a preset name'));
            return;
        }

        const settings = {
            resolution: document.querySelector('input[name="resolution"]:checked').value,
            fps: document.querySelector('input[name="fps"]:checked').value,
            codec: document.querySelector('input[name="codec"]:checked').value,
            interpolate_values: document.getElementById('interpolateValues').checked,
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
            show_bottom_elements: document.getElementById('showBottomElements').checked
        };

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
            // Close modal
            bootstrap.Modal.getInstance(document.getElementById('savePresetModal')).hide();
            // Clear input
            document.getElementById('presetName').value = '';
            // Reload presets
            loadPresets();
        })
        .catch(error => {
            console.error('Error:', error);
            alert(gettext('Error saving preset: ') + error.message);
        });
    });

    // Load preset selection
    document.getElementById('presetSelect').addEventListener('change', function() {
        const presetId = this.value;
        document.getElementById('deletePresetButton').disabled = !presetId;

        if (!presetId) return;

        fetch(`/get_preset/${presetId}`)
            .then(response => response.json())
            .then(data => {
                if (data.error) throw new Error(data.error);

                const settings = data.settings;

                // Apply settings
                document.querySelector(`input[name="resolution"][value="${settings.resolution}"]`).checked = true;
                document.querySelector(`input[name="fps"][value="${settings.fps}"]`).checked = true;
                document.querySelector(`input[name="codec"][value="${settings.codec}"]`).checked = true;
                document.getElementById('interpolateValues').checked = settings.interpolate_values;

                // Apply slider values
                const sliderSettings = {
                    'verticalPosition': settings.vertical_position,
                    'topPadding': settings.top_padding,
                    'bottomPadding': settings.bottom_padding,
                    'spacing': settings.spacing,
                    'fontSize': settings.font_size,
                    'borderRadius': settings.border_radius,
                    'indicatorScale': settings.indicator_scale,
                    'indicatorX': settings.indicator_x,
                    'indicatorY': settings.indicator_y,
                    'speedY': settings.speed_y,
                    'unitY': settings.unit_y,
                    'speedSize': settings.speed_size,
                    'unitSize': settings.unit_size
                };

                Object.entries(sliderSettings).forEach(([id, value]) => {
                    const element = document.getElementById(id);
                    if (element) {
                        element.value = value;
                        const valueDisplay = document.getElementById(id + 'Value');
                        if (valueDisplay) {
                            const unit = id.includes('Size') || id.includes('indicator') ? '%' : 'px';
                            valueDisplay.textContent = value + (id === 'verticalPosition' ? '%' : unit);
                        }
                    }
                });

                // Apply visibility settings
                document.getElementById('showSpeed').checked = settings.show_speed;
                document.getElementById('showMaxSpeed').checked = settings.show_max_speed;
                document.getElementById('showVoltage').checked = settings.show_voltage;
                document.getElementById('showTemp').checked = settings.show_temp;
                document.getElementById('showBattery').checked = settings.show_battery;
                document.getElementById('showMileage').checked = settings.show_mileage;
                document.getElementById('showPWM').checked = settings.show_pwm;
                document.getElementById('showPower').checked = settings.show_power;
                document.getElementById('showCurrent').checked = settings.show_current;
                document.getElementById('showGPS').checked = settings.show_gps;
                document.getElementById('showBottomElements').checked = settings.show_bottom_elements;

                // Update preview if project is loaded
                const projectId = document.getElementById('startProcessButton').dataset.projectId;
                if (projectId) {
                    updatePreview(projectId);
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert(gettext('Error loading preset: ') + error.message);
            });
    });

    // Delete preset button
    document.getElementById('deletePresetButton').addEventListener('click', function() {
        const presetSelect = document.getElementById('presetSelect');
        const presetId = presetSelect.value;
        if (!presetId) return;

        if (!confirm(gettext('Are you sure you want to delete this preset?'))) return;

        fetch(`/delete_preset/${presetId}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            loadPresets();
        })
        .catch(error => {
            console.error('Error:', error);
            alert(gettext('Error deleting preset: ') + error.message);
        });
    });
});

// Function to load presets into select
function loadPresets() {
    fetch('/get_presets')
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);

            const presetSelect = document.getElementById('presetSelect');
            presetSelect.innerHTML = `<option value="">${gettext('Select a Preset')}</option>`;

            data.presets.forEach(preset => {
                const option = document.createElement('option');
                option.value = preset.id;
                option.textContent = preset.name;
                presetSelect.appendChild(option);
            });

            // Disable delete button when no preset is selected
            document.getElementById('deletePresetButton').disabled = true;
        })
        .catch(error => {
            console.error('Error:', error);
            alert(gettext('Error loading presets: ') + error.message);
        });
}