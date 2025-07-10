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

// Speed chart variable
let speedChart = null;

// Function to format timestamp as date string
function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
}

// Function to update trimmer UI based on current selection
function updateTrimmerUI() {
    // Calculate percentages for positioning (для скрытых элементов, которые больше не видны в UI)
    const totalRange = csvTimeRange.max - csvTimeRange.min;
    
    // Prevent division by zero
    if (totalRange === 0) {
        console.warn('Total time range is zero, cannot update UI');
        return;
    }
    
    const startPercent = ((csvTimeRange.start - csvTimeRange.min) / totalRange) * 100;
    const endPercent = ((csvTimeRange.end - csvTimeRange.min) / totalRange) * 100;
    
    console.log('Updating UI - start%:', startPercent, 'end%:', endPercent);
    
    // Устанавливаем положения скрытых ползунков (для поддержки совместимости)
    if (document.getElementById('startHandle')) {
        document.getElementById('startHandle').style.left = `${startPercent}%`;
    }
    
    if (document.getElementById('endHandle')) {
        document.getElementById('endHandle').style.left = `${endPercent}%`;
    }
    
    // Обновляем скрытую выделенную область (для поддержки совместимости)
    if (document.getElementById('timelineSelected')) {
        document.getElementById('timelineSelected').style.left = `${startPercent}%`;
        document.getElementById('timelineSelected').style.width = `${endPercent - startPercent}%`;
    }
    
    // Update time displays
    const startDisplay = document.getElementById('startTimeDisplay');
    const endDisplay = document.getElementById('endTimeDisplay');
    
    if (startDisplay) {
        startDisplay.textContent = formatTimestamp(csvTimeRange.start);
    }
    
    if (endDisplay) {
        endDisplay.textContent = formatTimestamp(csvTimeRange.end);
    }
    
    // Обновляем график и его маркеры, если он существует
    if (speedChart) {
        // Обновление достаточно просто вызвать update() для перерисовки графика
        // Наш плагин trimMarkers автоматически получит актуальные значения csvTimeRange
        speedChart.update();
    }
}

// Function to create or update the speed chart
function createSpeedChart(timestamps, speedValues, pwmValues) {
    const ctx = document.getElementById('speed-chart').getContext('2d');
    
    // Destroy existing chart if it exists
    if (speedChart) {
        speedChart.destroy();
    }
    
    // Datasets for the chart
    const datasets = [
        {
            label: gettext('Speed (km/h)'),
            data: speedValues,
            borderColor: 'rgba(75, 192, 192, 1)',
            backgroundColor: 'rgba(75, 192, 192, 0.2)',
            tension: 0.4,
            fill: true,
            pointRadius: 0, // Remove individual data points
            pointHoverRadius: 5 // Show points on hover
        }
    ];
    
    // Add PWM dataset if available
    if (pwmValues && pwmValues.length > 0) {
        datasets.push({
            label: gettext('PWM'),
            data: pwmValues,
            borderColor: 'rgba(255, 99, 132, 1)',
            backgroundColor: 'rgba(255, 99, 132, 0.2)',
            tension: 0.4,
            fill: false,
            pointRadius: 0, // Remove individual data points
            pointHoverRadius: 5, // Show points on hover
            yAxisID: 'y1' // Use secondary Y axis for PWM
        });
    }
    
    // Create data for the chart
    const data = {
        labels: timestamps.map(ts => new Date(ts * 1000).toLocaleTimeString()),
        datasets: datasets
    };
    
    // Create chart configuration
    const config = {
        type: 'line',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    align: 'center',
                    labels: {
                        boxHeight: 12,
                        boxWidth: 12,
                        padding: 10
                    },
                    onClick: function(e, legendItem, legend) {
                        // Получаем индекс элемента легенды
                        const index = legendItem.datasetIndex;
                        const ci = legend.chart;
                        
                        // Изменяем видимость датасета
                        ci.data.datasets[index].hidden = !ci.data.datasets[index].hidden;
                        
                        // Обновляем график без анимации
                        ci.update(0); // передаем 0 для отключения анимации
                    }
                },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            const index = context[0].dataIndex;
                            return formatTimestamp(timestamps[index]);
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        maxTicksLimit: 10,
                        callback: function(val, index) {
                            // Show fewer labels for better readability
                            return index % Math.ceil(timestamps.length / 10) === 0 ? 
                                this.getLabelForValue(val) : '';
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: gettext('Speed (km/h)')
                    }
                },
                y1: {
                    beginAtZero: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: gettext('PWM')
                    },
                    grid: {
                        drawOnChartArea: false // only want the grid lines for the PWM axis
                    }
                }
            }
        },
        plugins: [{
            id: 'trimMarkers',
            afterDraw: function(chart) {
                if (csvTimeRange && csvTimeRange.min !== csvTimeRange.max) {
                    const ctx = chart.ctx;
                    const xAxis = chart.scales.x;
                    const yAxis = chart.scales.y;
                    const chartArea = chart.chartArea;
                    
                    const totalRange = csvTimeRange.max - csvTimeRange.min;
                    
                    // Находим ближайшие к точкам обрезки индексы на графике
                    let startIndex = 0;
                    let endIndex = timestamps.length - 1;
                    let minDistance = Number.MAX_VALUE;
                    
                    for (let i = 0; i < timestamps.length; i++) {
                        const distToStart = Math.abs(timestamps[i] - csvTimeRange.start);
                        if (distToStart < minDistance) {
                            minDistance = distToStart;
                            startIndex = i;
                        }
                    }
                    
                    minDistance = Number.MAX_VALUE;
                    for (let i = 0; i < timestamps.length; i++) {
                        const distToEnd = Math.abs(timestamps[i] - csvTimeRange.end);
                        if (distToEnd < minDistance) {
                            minDistance = distToEnd;
                            endIndex = i;
                        }
                    }
                    
                    // Расчет координат X для начала и конца выбранного диапазона
                    const startX = xAxis.getPixelForValue(startIndex);
                    const endX = xAxis.getPixelForValue(endIndex);
                    
                    // Сохраняем контекст для восстановления после рисования
                    ctx.save();
                    
                    // Затемняем области за пределами выбранного диапазона
                    // Левая часть (до startX)
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                    ctx.fillRect(chartArea.left, chartArea.top, startX - chartArea.left, chartArea.bottom - chartArea.top);
                    
                    // Правая часть (после endX)
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                    ctx.fillRect(endX, chartArea.top, chartArea.right - endX, chartArea.bottom - chartArea.top);
                    
                    // Рисуем вертикальную линию для начала выделения
                    ctx.beginPath();
                    ctx.setLineDash([]); // Сплошная линия
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = 'rgba(0, 128, 255, 0.8)'; // Синяя линия
                    ctx.moveTo(startX, chartArea.top);
                    ctx.lineTo(startX, chartArea.bottom);
                    ctx.stroke();
                    
                    // Рисуем вертикальную линию для конца выделения
                    ctx.beginPath();
                    ctx.setLineDash([]); // Сплошная линия
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = 'rgba(255, 128, 0, 0.8)'; // Оранжевая линия
                    ctx.moveTo(endX, chartArea.top);
                    ctx.lineTo(endX, chartArea.bottom);
                    ctx.stroke();
                    
                    // Рисуем маркеры-ручки для перетаскивания (круги на конце линий)
                    // Маркер начала
                    ctx.beginPath();
                    ctx.arc(startX, chartArea.bottom - 15, 8, 0, 2 * Math.PI);
                    ctx.fillStyle = 'rgba(0, 128, 255, 0.9)';
                    ctx.fill();
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = 'white';
                    ctx.stroke();
                    
                    // Маркер конца
                    ctx.beginPath();
                    ctx.arc(endX, chartArea.bottom - 15, 8, 0, 2 * Math.PI);
                    ctx.fillStyle = 'rgba(255, 128, 0, 0.9)';
                    ctx.fill();
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = 'white';
                    ctx.stroke();
                    
                    // Удаляем метки с временем
                    
                    // Сохраняем позиции маркеров для использования в обработчике событий мыши
                    chart.trimMarkers = {
                        startX: startX,
                        endX: endX,
                        startIndex: startIndex,
                        endIndex: endIndex,
                        chartArea: chartArea
                    };
                    
                    ctx.restore();
                }
            }
        }]
    };
    
    // Create the chart
    speedChart = new Chart(ctx, config);
    
    // Добавляем обработчики для перетаскивания линий непосредственно на графике
    const chartCanvas = document.getElementById('speed-chart');
    let isDraggingMarker = false;
    let activeMarker = null; // 'start' or 'end'
    
    // Функция для проверки, находится ли курсор над маркером
    function isOverMarker(event, chart) {
        if (!chart.trimMarkers) return false;
        
        const rect = chartCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        // Проверяем, находится ли указатель мыши рядом с маркером начала
        const distanceToStart = Math.sqrt(
            Math.pow(x - chart.trimMarkers.startX, 2) + 
            Math.pow(y - (chart.trimMarkers.chartArea.bottom - 15), 2)
        );
        
        // Проверяем, находится ли указатель мыши рядом с маркером конца
        const distanceToEnd = Math.sqrt(
            Math.pow(x - chart.trimMarkers.endX, 2) + 
            Math.pow(y - (chart.trimMarkers.chartArea.bottom - 15), 2)
        );
        
        // Визуальный радиус захвата маркера (немного больше, чем размер маркера)
        const grabRadius = 12;
        
        if (distanceToStart <= grabRadius) {
            return 'start';
        } else if (distanceToEnd <= grabRadius) {
            return 'end';
        }
        
        return false;
    }
    
    // Изменяем курсор при наведении на маркеры
    chartCanvas.addEventListener('mousemove', function(e) {
        const markerType = isOverMarker(e, speedChart);
        if (markerType) {
            this.style.cursor = 'ew-resize'; // Горизонтальный курсор изменения размера
        } else {
            this.style.cursor = 'default';
        }
        
        // Если происходит перетаскивание маркера
        if (isDraggingMarker && activeMarker) {
            const rect = chartCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            
            // Находим ближайшую временную метку к текущей позиции X
            const xScale = speedChart.scales.x;
            const valueIndex = Math.round(xScale.getValueForPixel(x));
            
            if (valueIndex >= 0 && valueIndex < timestamps.length) {
                const newTimestamp = timestamps[valueIndex];
                
                if (activeMarker === 'start' && newTimestamp < csvTimeRange.end) {
                    csvTimeRange.start = newTimestamp;
                    updateTrimmerUI();
                } else if (activeMarker === 'end' && newTimestamp > csvTimeRange.start) {
                    csvTimeRange.end = newTimestamp;
                    updateTrimmerUI();
                }
            }
        }
    });
    
    // Начало перетаскивания маркера
    chartCanvas.addEventListener('mousedown', function(e) {
        const markerType = isOverMarker(e, speedChart);
        if (markerType) {
            isDraggingMarker = true;
            activeMarker = markerType;
            e.preventDefault(); // Предотвращаем выделение текста
        }
    });
    
    // Окончание перетаскивания маркера
    document.addEventListener('mouseup', function(e) {
        if (isDraggingMarker) {
            isDraggingMarker = false;
            activeMarker = null;
        }
    });
    
    // Добавляем поддержку сенсорных устройств
    
    // Начало касания (аналог mousedown)
    chartCanvas.addEventListener('touchstart', function(e) {
        // Эмулируем событие mousedown для проверки маркеров
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousedown', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        
        const markerType = isOverMarker(mouseEvent, speedChart);
        if (markerType) {
            isDraggingMarker = true;
            activeMarker = markerType;
            e.preventDefault(); // Предотвращаем прокрутку
        }
    });
    
    // Движение пальца (аналог mousemove)
    chartCanvas.addEventListener('touchmove', function(e) {
        if (isDraggingMarker && activeMarker) {
            const touch = e.touches[0];
            const rect = chartCanvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            
            // Находим ближайшую временную метку к текущей позиции X
            const xScale = speedChart.scales.x;
            const valueIndex = Math.round(xScale.getValueForPixel(x));
            
            if (valueIndex >= 0 && valueIndex < timestamps.length) {
                const newTimestamp = timestamps[valueIndex];
                
                if (activeMarker === 'start' && newTimestamp < csvTimeRange.end) {
                    csvTimeRange.start = newTimestamp;
                    updateTrimmerUI();
                } else if (activeMarker === 'end' && newTimestamp > csvTimeRange.start) {
                    csvTimeRange.end = newTimestamp;
                    updateTrimmerUI();
                }
            }
            
            e.preventDefault(); // Предотвращаем прокрутку при перетаскивании
        }
    });
    
    // Окончание касания (аналог mouseup)
    chartCanvas.addEventListener('touchend', function(e) {
        if (isDraggingMarker) {
            isDraggingMarker = false;
            activeMarker = null;
        }
    });
    
    return speedChart;
}

// Function to initialize CSV trimmer after upload
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
            
            // Update UI elements
            document.getElementById('totalRecordsInfo').textContent = data.total_rows.toLocaleString();
            document.getElementById('csvTrimmerCard').classList.remove('d-none');
            
            // Initialize trimmer UI
            updateTrimmerUI();
            
            // Create speed chart if we have speed data
            if (data.chart_data && data.chart_data.timestamps && data.chart_data.speed_values) {
                createSpeedChart(
                    data.chart_data.timestamps, 
                    data.chart_data.speed_values,
                    data.chart_data.pwm_values
                );
            }
            
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
        const trimmingText = document.getElementById('js-translation-trimming') ? 
                           document.getElementById('js-translation-trimming').textContent : 'Trimming...';
        this.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ' + trimmingText;
        
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
            use_icons: document.getElementById('useIcons').checked,
            icon_vertical_offset: document.getElementById('iconVerticalOffset').value,
            icon_horizontal_spacing: document.getElementById('iconHorizontalSpacing').value,
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
            
            // Update speed chart if data is available
            if (data.chart_data && data.chart_data.timestamps && data.chart_data.speed_values) {
                createSpeedChart(
                    data.chart_data.timestamps, 
                    data.chart_data.speed_values,
                    data.chart_data.pwm_values
                );
            }
            
            // Re-enable trim button
            this.disabled = false;
            const trimDataText = document.getElementById('js-translation-trim-data') ? 
                              document.getElementById('js-translation-trim-data').textContent : 'Trim Data';
            this.innerHTML = '<i class="fas fa-cut me-1"></i> ' + trimDataText;
        })
        .catch(error => {
            console.error('Error trimming CSV:', error);
            // Re-enable trim button
            this.disabled = false;
            const trimDataText = document.getElementById('js-translation-trim-data') ? 
                              document.getElementById('js-translation-trim-data').textContent : 'Trim Data';
            this.innerHTML = '<i class="fas fa-cut me-1"></i> ' + trimDataText;
            const errorTrimmingText = document.getElementById('js-translation-error-trimming') ? 
                                       document.getElementById('js-translation-error-trimming').textContent : 'Error trimming CSV: ';
            alert(errorTrimmingText + error.message);
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
        show_bottom_elements: document.getElementById('showBottomElements').checked,
        use_icons: document.getElementById('useIcons').checked,
        icon_vertical_offset: document.getElementById('iconVerticalOffset').value,
        icon_horizontal_spacing: document.getElementById('iconHorizontalSpacing').value,
        static_box_size: document.getElementById('staticBoxSize').checked
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
                document.getElementById('speedYValue').textContent = '-50px';
                document.getElementById('unitY').value = 65;
                document.getElementById('unitYValue').textContent = '65px';
                document.getElementById('topPadding').value = 15;
                document.getElementById('topPaddingValue').textContent = '15px';
                document.getElementById('iconVerticalOffset').value = 12;
                document.getElementById('iconOffsetValue').textContent = '12';
            } else {
                // Reset to default values for Full HD
                document.getElementById('speedY').value = -28;
                document.getElementById('speedYValue').textContent = '-28px';
                document.getElementById('unitY').value = 36;
                document.getElementById('unitYValue').textContent = '36px';
                document.getElementById('topPadding').value = 14;
                document.getElementById('topPaddingValue').textContent = '14px';
                document.getElementById('iconVerticalOffset').value = 5;
                document.getElementById('iconOffsetValue').textContent = '5';
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
                    show_bottom_elements: document.getElementById('showBottomElements').checked,
                    use_icons: document.getElementById('useIcons').checked,
                    icon_vertical_offset: document.getElementById('iconVerticalOffset').value,
                    icon_horizontal_spacing: document.getElementById('iconHorizontalSpacing').value
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
    'showCurrent', 'showGPS', 'showBottomElements', 'useIcons', 'staticBoxSize'
];

visibilitySettings.forEach(setting => {
    const checkbox = document.getElementById(setting);
    if (checkbox) {
        checkbox.addEventListener('change', function() {
            // Special handling for useIcons checkbox
            if (setting === 'useIcons') {
                const iconOffsetContainer = document.getElementById('iconVerticalOffsetContainer');
                const iconSpacingContainer = document.getElementById('iconHorizontalSpacingContainer');
                if (iconOffsetContainer) {
                    iconOffsetContainer.style.display = this.checked ? 'block' : 'none';
                }
                if (iconSpacingContainer) {
                    iconSpacingContainer.style.display = this.checked ? 'block' : 'none';
                }
                
                // Set default spacing values based on resolution when icons are enabled
                if (this.checked) {
                    const selectedResolution = document.querySelector('input[name="resolution"]:checked').value;
                    const defaultSpacing = selectedResolution === '4k' ? 20 : 10;
                    const spacingSlider = document.getElementById('iconHorizontalSpacing');
                    const spacingValue = document.getElementById('iconSpacingValue');
                    
                    spacingSlider.value = defaultSpacing;
                    if (spacingValue) {
                        spacingValue.textContent = defaultSpacing;
                    }
                }
            }
            
            const projectId = document.getElementById('startProcessButton').dataset.projectId;
            if (projectId) {
                updatePreview(projectId);
            }
        });
    }
});

// Add event listener for icon vertical offset slider
const iconVerticalOffsetSlider = document.getElementById('iconVerticalOffset');
if (iconVerticalOffsetSlider) {
    iconVerticalOffsetSlider.addEventListener('input', function() {
        // Update the displayed value
        const valueSpan = document.getElementById('iconOffsetValue');
        if (valueSpan) {
            valueSpan.textContent = this.value;
        }
        
        const projectId = document.getElementById('startProcessButton').dataset.projectId;
        if (projectId) {
            updatePreview(projectId);
        }
    });
}

// Add event listener for icon horizontal spacing slider
const iconHorizontalSpacingSlider = document.getElementById('iconHorizontalSpacing');
if (iconHorizontalSpacingSlider) {
    iconHorizontalSpacingSlider.addEventListener('input', function() {
        // Update the displayed value
        const valueSpan = document.getElementById('iconSpacingValue');
        if (valueSpan) {
            valueSpan.textContent = this.value;
        }
        
        const projectId = document.getElementById('startProcessButton').dataset.projectId;
        if (projectId) {
            updatePreview(projectId);
        }
    });
}

// Handle start processing button click
document.getElementById('startProcessButton').addEventListener('click', async function() {
    const projectId = this.dataset.projectId;
    const progressDiv = document.getElementById('progress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    const progressTitle = document.getElementById('progressTitle');
    const videoProcessingInfo = document.getElementById('videoProcessingInfo');
    const previewSection = document.getElementById('previewSection');
    
    // Check if CSV file is longer than 2 hours (7200 seconds)
    if (csvTimeRange.end - csvTimeRange.start > 7200) {
        // Show error message and prevent processing
        alert(gettext("Error: Cannot process files longer than 2 hours. Please upload a different file or trim the file length in the \"Trim CSV Data\" section before starting the video creation process."));
        return; // Prevent processing long files completely
    }

    // Check if user already has 2 or more projects in processing state
    try {
        const response = await fetch('/check_processing_projects');
        if (!response.ok) {
            throw new Error('Error checking processing projects status');
        }
        
        const data = await response.json();
        if (!data.can_process_more) {
            // Show error message and prevent processing
            alert(gettext("Error: You already have 2 videos being processed. Please wait for them to complete before starting a new processing job."));
            return; // Prevent processing more than 2 videos at a time
        }
    } catch (error) {
        console.error('Error checking processing projects:', error);
    }

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
        show_bottom_elements: document.getElementById('showBottomElements').checked,
        use_icons: document.getElementById('useIcons').checked,
        icon_vertical_offset: document.getElementById('iconVerticalOffset').value,
        icon_horizontal_spacing: document.getElementById('iconHorizontalSpacing').value,
        static_box_size: document.getElementById('staticBoxSize').checked
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

        // Reset icon settings with resolution-based defaults
        document.getElementById('useIcons').checked = false;
        document.getElementById('iconVerticalOffset').value = 5;
        
        // Set default horizontal spacing based on resolution
        const selectedResolution = document.querySelector('input[name="resolution"]:checked').value;
        const defaultSpacing = selectedResolution === '4k' ? 20 : 10;
        document.getElementById('iconHorizontalSpacing').value = defaultSpacing;
        // Hide icon containers
        const iconOffsetContainer = document.getElementById('iconVerticalOffsetContainer');
        const iconSpacingContainer = document.getElementById('iconHorizontalSpacingContainer');
        if (iconOffsetContainer) {
            iconOffsetContainer.style.display = 'none';
        }
        if (iconSpacingContainer) {
            iconSpacingContainer.style.display = 'none';
        }
        // Update displayed values
        const valueSpan = document.getElementById('iconOffsetValue');
        const spacingSpan = document.getElementById('iconSpacingValue');
        if (valueSpan) {
            valueSpan.textContent = '5';
        }
        if (spacingSpan) {
            spacingSpan.textContent = defaultSpacing;
        }

        // Reset static box size setting
        document.getElementById('staticBoxSize').checked = false;

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
            show_bottom_elements: document.getElementById('showBottomElements').checked,
            use_icons: document.getElementById('useIcons').checked,
            icon_vertical_offset: document.getElementById('iconVerticalOffset').value,
            icon_horizontal_spacing: document.getElementById('iconHorizontalSpacing').value,
            static_box_size: document.getElementById('staticBoxSize').checked
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

                // Apply icon settings
                if (settings.use_icons !== undefined) {
                    document.getElementById('useIcons').checked = settings.use_icons;
                    // Show/hide icon containers based on use_icons setting
                    const iconOffsetContainer = document.getElementById('iconVerticalOffsetContainer');
                    const iconSpacingContainer = document.getElementById('iconHorizontalSpacingContainer');
                    if (iconOffsetContainer) {
                        iconOffsetContainer.style.display = settings.use_icons ? 'block' : 'none';
                    }
                    if (iconSpacingContainer) {
                        iconSpacingContainer.style.display = settings.use_icons ? 'block' : 'none';
                    }
                }
                if (settings.icon_vertical_offset !== undefined) {
                    document.getElementById('iconVerticalOffset').value = settings.icon_vertical_offset;
                    // Update displayed value
                    const valueSpan = document.getElementById('iconOffsetValue');
                    if (valueSpan) {
                        valueSpan.textContent = settings.icon_vertical_offset;
                    }
                }
                if (settings.icon_horizontal_spacing !== undefined) {
                    document.getElementById('iconHorizontalSpacing').value = settings.icon_horizontal_spacing;
                    // Update displayed value
                    const spacingSpan = document.getElementById('iconSpacingValue');
                    if (spacingSpan) {
                        spacingSpan.textContent = settings.icon_horizontal_spacing;
                    }
                }

                // Apply static box size setting
                if (settings.static_box_size !== undefined) {
                    document.getElementById('staticBoxSize').checked = settings.static_box_size;
                }

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

    // Add event listeners for resolution changes to update icon horizontal spacing
    document.querySelectorAll('input[name="resolution"]').forEach(radio => {
        radio.addEventListener('change', function() {
            const useIconsCheckbox = document.getElementById('useIcons');
            const spacingSlider = document.getElementById('iconHorizontalSpacing');
            const spacingValue = document.getElementById('iconSpacingValue');
            
            // Only update if icons are enabled
            if (useIconsCheckbox.checked) {
                const defaultSpacing = this.value === '4k' ? 20 : 10;
                spacingSlider.value = defaultSpacing;
                if (spacingValue) {
                    spacingValue.textContent = defaultSpacing;
                }
                
                // Update preview if project is loaded
                const projectId = document.getElementById('startProcessButton').dataset.projectId;
                if (projectId) {
                    updatePreview(projectId);
                }
            }
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
