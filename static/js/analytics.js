// Wait for DOM to fully load before executing the script
document.addEventListener('DOMContentLoaded', function() {
    // Get UI elements from HTML
    const uploadForm = document.getElementById('uploadForm'); // Upload form
    const csvFileInput = document.getElementById('csvFile'); // CSV file input
    const uploadButton = document.getElementById('uploadButton'); // Upload button
    const loadingIndicator = document.getElementById('loadingIndicator'); // Loading indicator
    const errorMessage = document.getElementById('errorMessage'); // Error message
    const analysisResults = document.getElementById('analysisResults'); // Analysis results block
    const achievementsSection = document.getElementById('achievementsSection'); // Achievements section
    const achievementsContainer = document.getElementById('achievementsContainer'); // Achievements container
    const dataChart = document.getElementById('dataChart'); // Chart canvas
    const adaptiveChartToggle = document.getElementById('adaptiveChartToggle'); // Adaptive scale toggle
    const resetZoomButton = document.getElementById('resetZoomButton'); // Reset zoom button

    // Initialize global variables
    let chartInstance = null; // Chart.js instance
    let csvData = null; // CSV file data
    let isAdaptiveChart = true; // Adaptive scaling flag
    let isDragging = false; // Dragging state flag
    let dragStartX = 0; // Initial X position when dragging
    let chartStartMin = 0; // Initial minimum X-axis value
    let chartStartMax = 0; // Initial maximum X-axis value

    // Добавим отладочную функцию, чтобы посмотреть данные
    function processResponse(data) {
        console.log("Received data from server:", data);
        console.log("CSV Type:", data.csv_type);
        console.log("Achievements:", data.achievements);
        try {
            const parsedData = JSON.parse(data.csv_data);
            console.log("Parsed data:", parsedData);
            console.log("Timestamp length:", parsedData.timestamp ? parsedData.timestamp.length : 'No timestamps');
            console.log("Speed data:", parsedData.speed ? parsedData.speed.slice(0, 5) : 'No speed data');
        } catch (e) {
            console.error("Error parsing data:", e);
        }
        return data;
    }

    // Register crosshair plugin to display vertical line on hover
    const crosshairPlugin = {
        id: 'crosshair',
        afterDraw: (chart, args, options) => {
            if (!chart.tooltip._active || !chart.tooltip._active.length) return;
            const activePoint = chart.tooltip._active[0];
            const ctx = chart.ctx;
            const x = activePoint.element.x;
            const topY = chart.scales.y.top;
            const bottomY = chart.scales.y.bottom;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, topY);
            ctx.lineTo(x, bottomY);
            ctx.lineWidth = options.line?.width || 1;
            ctx.strokeStyle = options.line?.color || 'rgba(255, 255, 255, 0.5)';
            if (options.line?.dashPattern) ctx.setLineDash(options.line.dashPattern);
            ctx.stroke();
            ctx.restore();
        }
    };
    Chart.register(crosshairPlugin);

    // Function to display error message
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        loadingIndicator.style.display = 'none';
    }

    // Function to hide error message
    function hideError() {
        errorMessage.style.display = 'none';
    }

    // Format X-axis labels as time (hours:minutes:seconds)
    function formatXAxisLabel(value) {
        if (value === undefined || value === null) return '';
        const date = new Date(value * 1000);
        if (isNaN(date.getTime())) return '';
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const secs = date.getUTCSeconds().toString().padStart(2, '0');
        return `${hours}:${minutes}:${secs}`;
    }

    // Format time for tooltip with milliseconds and date in DD.MM.YYYY format
    function formatTooltipTimestamp(timestamp) {
        if (timestamp === undefined || timestamp === null) return window.gettext('Unknown');
        const date = new Date(timestamp * 1000);
        if (isNaN(date.getTime())) return window.gettext('Invalid time');
        const day = date.getUTCDate().toString().padStart(2, '0');
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        const year = date.getUTCFullYear();
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const secs = date.getUTCSeconds().toString().padStart(2, '0');
        const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
        return `${day}.${month}.${year} ${hours}:${minutes}:${secs}.${ms}`;
    }

    // Normalize values for adaptive scale
    function normalizeValueForAdaptiveScale(value, columnName) {
        if (!isAdaptiveChart) return value;
        columnName = columnName.toLowerCase();
        
        if (columnName === 'power') {
            // For power, find the min and max values in current data to calculate dynamic scaling
            // Min power should be 0%, max power should match the max PWM value
            if (!csvData) return value; // No data yet
            
            // Find min power value and max PWM value in current data
            const powerValues = csvData.map(row => parseFloat(row.power) || 0);
            const pwmValues = csvData.map(row => parseFloat(row.pwm) || 0);
            const minPower = Math.min(...powerValues);
            const maxPower = Math.max(...powerValues);
            const maxPwm = Math.max(...pwmValues);
            
            // Scale from min power to max power, but limit to max PWM value
            if (maxPower === minPower) return 50; // Prevent division by zero, return middle value
            
            // First normalize power to 0-100 range
            const normalizedValue = ((value - minPower) / (maxPower - minPower)) * 100;
            
            // Then scale it to match max PWM (if max PWM is 80%, power shouldn't exceed 80%)
            return normalizedValue * (maxPwm / 100);
        }
        
        if (columnName === 'current') {
            // Для тока используем ту же логику нормализации, что и для мощности
            if (!csvData) return value; // Нет данных
            
            // Находим минимальное значение тока и максимальное значение PWM
            const currentValues = csvData.map(row => parseFloat(row.current) || 0);
            const pwmValues = csvData.map(row => parseFloat(row.pwm) || 0);
            const minCurrent = Math.min(...currentValues);
            const maxCurrent = Math.max(...currentValues);
            const maxPwm = Math.max(...pwmValues);
            
            // Нормализуем от минимального до максимального, но ограничиваем максимальным PWM
            if (maxCurrent === minCurrent) return 50; // Предотвращаем деление на ноль
            
            // Сначала нормализуем ток в диапазоне 0-100
            const normalizedValue = ((value - minCurrent) / (maxCurrent - minCurrent)) * 100;
            
            // Затем масштабируем, чтобы соответствовать максимальному PWM
            return normalizedValue * (maxPwm / 100);
        }
        
        if (columnName === 'voltage') {
            // Для напряжения используем новую логику нормализации
            if (!csvData) return value; // Нет данных
            
            // Находим минимальные и максимальные значения напряжения и заряда батареи
            const voltageValues = csvData.map(row => parseFloat(row.voltage) || 0);
            const batteryValues = csvData.map(row => parseFloat(row.battery) || 0);
            const maxVoltage = Math.max(...voltageValues);
            const minVoltage = Math.min(...voltageValues);
            const maxBattery = Math.max(...batteryValues);
            const minBattery = Math.min(...batteryValues);
            
            // Если нет разницы между мин. и макс. напряжением, возвращаем среднее значение батареи
            if (maxVoltage === minVoltage) return (minBattery + maxBattery) / 2;
            
            // Линейное отображение из диапазона напряжения [minVoltage, maxVoltage] 
            // в диапазон батареи [minBattery, maxBattery]
            return minBattery + ((value - minVoltage) / (maxVoltage - minVoltage)) * (maxBattery - minBattery);
        }
        
        return value;
    }

    // Color palette for different data types
    const colorPalette = {
        speed: { borderColor: '#0000FF', backgroundColor: 'rgba(0, 0, 255, 0.2)' },
        gps: { borderColor: '#00daff', backgroundColor: 'rgba(255, 165, 0, 0.2)' },
        voltage: { borderColor: '#800080', backgroundColor: 'rgba(128, 0, 128, 0.2)' },
        temperature: { borderColor: '#ffa8ff', backgroundColor: 'rgba(255, 0, 255, 0.2)' },
        current: { borderColor: '#FFFF00', backgroundColor: 'rgba(255, 255, 0, 0.2)' },
        battery: { borderColor: '#008000', backgroundColor: 'rgba(0, 128, 0, 0.2)' },
        mileage: { borderColor: '#FF8C00', backgroundColor: 'rgba(255, 140, 0, 0.2)' },
        pwm: { borderColor: '#FF0000', backgroundColor: 'rgba(255, 0, 0, 0.2)' },
        power: { borderColor: '#ed5165', backgroundColor: 'rgba(199, 21, 133, 0.2)' }
    };

    // Units for tooltips with translations
    const units = {
        speed: window.gettext('km/h'),
        gps: window.gettext('km/h'),
        voltage: window.gettext('V'),
        temperature: window.gettext('°C'),
        current: window.gettext('A'),
        battery: window.gettext('%'),
        mileage: window.gettext('km'),
        pwm: window.gettext('%'),
        power: window.gettext('W')
    };

    // Function to create a linear chart with multiple datasets
    function createMultiChart(labels, datasets) {
        if (chartInstance) chartInstance.destroy(); // Destroy old chart if it exists
        const ctx = dataChart.getContext('2d');
        const minTimestamp = Math.min(...labels); // Minimum X-axis value
        const maxTimestamp = Math.max(...labels); // Maximum X-axis value
        const fullRange = maxTimestamp - minTimestamp; // Full X-axis length

        chartInstance = new Chart(ctx, {
            type: 'line', // Chart type - linear
            data: {
                labels: labels, // X-axis labels (timestamps)
                datasets: datasets.map((ds) => {
                    const columnName = ds.originalColumn.toLowerCase();
                    const color = colorPalette[columnName] || { borderColor: '#808080', backgroundColor: 'rgba(128, 128, 128, 0.2)' };
                    return {
                        label: ds.label, // Dataset name
                        data: ds.data, // Normalized or original data
                        borderColor: color.borderColor, // Line color
                        backgroundColor: color.backgroundColor, // Fill color
                        borderWidth: 2, // Line thickness
                        fill: false, // No fill under the line
                        tension: 0.1, // Line smoothness
                        pointRadius: 0, // Point radius (0 - not visible)
                        pointHoverRadius: 3, // Point radius on hover
                        originalData: ds.originalData, // Original data for tooltips
                        pointStyle: 'rectRounded', // Rounded corners for markers in tooltip
                        originalColumn: ds.originalColumn // Store original technical column name
                    };
                })
            },
            options: {
                responsive: true, // Chart adapts to container size
                maintainAspectRatio: false, // Disable fixed aspect ratio
                scales: {
                    x: {
                        type: 'linear', // Linear scale for X-axis
                        min: minTimestamp, // X-axis start
                        max: maxTimestamp, // X-axis end
                        title: { display: true, text: window.gettext('Time'), color: '#fff' }, // Axis title
                        ticks: { 
                            callback: formatXAxisLabel, // Label formatting
                            color: '#fff', // Text color
                            maxTicksLimit: 20, // Maximum number of labels
                            autoSkip: true // Automatic label skipping
                        },
                        grid: { 
                            display: true, // Enable grid
                            color: 'rgba(255, 255, 255, 0.1)', // Very light color
                            lineWidth: 0.5, // Thin lines
                            drawTicks: false // Don't draw ticks
                        }
                    },
                    y: {
                        title: { display: true, text: window.gettext('Values'), color: '#fff' }, // Y-axis title
                        ticks: { color: '#fff' }, // Label text color
                        grid: { 
                            display: true, // Enable grid
                            color: 'rgba(255, 255, 255, 0.1)', // Very light color
                            lineWidth: 0.5, // Thin lines
                            drawTicks: false // Don't draw ticks
                        },
                        beginAtZero: false // Don't start axis at zero
                    }
                },
                plugins: {
                    tooltip: {
                        enabled: true, // Enable tooltips
                        mode: 'index', // Show data for all lines at current position
                        intersect: false, // Tooltip shown without intersection with point
                        usePointStyle: true, // Use point style for markers
                        callbacks: {
                            // Format tooltip title (time)
                            title: (tooltipItems) => tooltipItems.length > 0 ? formatTooltipTimestamp(tooltipItems[0].parsed.x) : '',
                            // Format tooltip text (value and units)
                            label: (context) => {
                                const dataset = context.dataset;
                                const index = context.dataIndex;
                                let value = dataset.originalData[index];
                                value = (typeof value === 'number' && !isNaN(value)) ? Math.round(value).toString() : '—';
                                const unit = units[dataset.originalColumn.toLowerCase()] || '';
                                return `${window.gettext(dataset.originalColumn.toLowerCase())}: \u200B${value} ${unit}`;
                            },
                            // Configure marker color in tooltip
                            labelColor: (tooltipItem) => {
                                const dataset = chartInstance.data.datasets[tooltipItem.datasetIndex];
                                return {
                                    borderColor: dataset.borderColor,
                                    backgroundColor: dataset.borderColor // Solid color without outline
                                };
                            }
                        },
                        backgroundColor: 'rgba(0, 0, 0, 0.9)', // Tooltip background color
                        titleFont: { size: 14, weight: 'bold' }, // Title font
                        bodyFont: { size: 14, weight: 'bold' }, // Text font
                        padding: 12 // Padding inside tooltip
                    },
                    crosshair: {
                        line: { color: 'rgba(255, 255, 255, 0.5)', width: 1, dashPattern: [5, 5] } // Crosshair line settings
                    },
                    legend: {
                        display: true, // Enable legend
                        position: 'top', // Legend position
                        labels: {
                            color: '#fff', // Text color
                            generateLabels: (chart) => {
                                const datasets = chart.data.datasets;
                                return datasets.map((dataset, i) => {
                                    const meta = chart.getDatasetMeta(i);
                                    const isHidden = meta.hidden;
                                    return {
                                        text: window.gettext(dataset.originalColumn.toLowerCase()),
                                        fillStyle: dataset.borderColor,
                                        strokeStyle: '#fff',
                                        lineWidth: 2,
                                        hidden: isHidden,
                                        index: i,
                                        fontColor: '#fff'
                                    };
                                });
                            },
                            boxWidth: 20,
                            padding: 10
                        },
                        onClick: (e, legendItem, legend) => {
                            // Toggle visibility when clicking legend
                            const index = legendItem.index;
                            const ci = legend.chart;
                            const meta = ci.getDatasetMeta(index);
                            meta.hidden = meta.hidden === null ? !ci.data.datasets[index].hidden : null;
                            ci.update();
                        }
                    },
                    zoom: {
                        zoom: {
                            wheel: { enabled: true }, // Enable mouse wheel zoom
                            pinch: { enabled: true }, // Enable pinch zoom
                            mode: 'x', // Zoom along X-axis
                            speed: 100 // Zoom speed
                        },
                        pan: {
                            enabled: true, // Enable panning
                            mode: 'x', // Pan along X-axis
                            modifierKey: '' // No modifier key required
                        },
                        limits: {
                            x: {
                                min: minTimestamp, // Minimum X-axis value for zoom limit
                                max: maxTimestamp, // Maximum X-axis value for zoom limit
                                minRange: fullRange * 0.01 // Minimum range for zoom
                            }
                        }
                    }
                },
                animation: false, // Disable animations
                interaction: {
                    mode: 'index', // Interaction mode
                    intersect: false // Don't require intersection
                },
                elements: {
                    line: {
                        tension: 0.1 // Line smoothness
                    },
                    point: {
                        radius: 0 // Don't show points
                    }
                }
            }
        });

        // Store initial axis limits for reset function
        chartStartMin = minTimestamp;
        chartStartMax = maxTimestamp;
    }

    // Handle form submission
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Check if file is selected
        const file = csvFileInput.files[0];
        if (!file) {
            showError(window.gettext('Please select a CSV file to upload.'));
            return;
        }
        
        // Check file extension
        if (!file.name.toLowerCase().endsWith('.csv')) {
            showError(window.gettext('Selected file is not a CSV file. Please upload a CSV file.'));
            return;
        }

        // Hide previous error message and show loading indicator
        hideError();
        loadingIndicator.style.display = 'block';
        analysisResults.style.display = 'none';
        
        // Create form data for upload
        const formData = new FormData();
        formData.append('file', file);

        // Send file to server
        fetch('/analyze_csv', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            // Parse JSON response
            return response.json().then(data => {
                if (!response.ok) {
                    throw new Error(data.error || window.gettext('Error processing CSV file'));
                }
                return data;
            });
        })
        .then(data => {
            // Process successful response
            data = processResponse(data);
            loadingIndicator.style.display = 'none';
            
            if (data.csv_type && data.csv_data) {
                try {
                    // Parse CSV data
                    const parsedData = JSON.parse(data.csv_data);
                    
                    if (parsedData && typeof parsedData === 'object') {
                        // Store data for adaptive scaling
                        csvData = [];
                        
                        // Create arrays for chart datasets
                        const timestamps = parsedData.timestamp || [];
                        const chartDatasets = [];
                        
                        // Process each data column
                        for (const key in parsedData) {
                            if (key === 'timestamp') continue; // Skip timestamp column
                            
                            const values = parsedData[key] || [];
                            const normalizedValues = [];
                            const originalValues = [];
                            
                            // Process data points
                            for (let i = 0; i < timestamps.length; i++) {
                                const timestamp = timestamps[i];
                                const value = values[i];
                                
                                if (timestamp !== null && value !== null && 
                                    !isNaN(parseFloat(timestamp)) && !isNaN(parseFloat(value))) {
                                    const floatValue = parseFloat(value);
                                    
                                    // Store original and normalized values
                                    normalizedValues.push({
                                        x: parseFloat(timestamp),
                                        y: normalizeValueForAdaptiveScale(floatValue, key)
                                    });
                                    
                                    originalValues.push(floatValue);
                                    
                                    // Populate csvData array for adaptive scaling
                                    if (i >= csvData.length) {
                                        csvData.push({});
                                    }
                                    csvData[i][key] = floatValue;
                                }
                            }
                            
                            // Add dataset if it has data
                            if (normalizedValues.length > 0) {
                                chartDatasets.push({
                                    label: window.gettext(key.toLowerCase()),
                                    data: normalizedValues,
                                    originalData: originalValues,
                                    originalColumn: key
                                });
                            }
                        }
                        
                        // Create chart if we have data
                        if (chartDatasets.length > 0 && timestamps.length > 0) {
                            createMultiChart(timestamps, chartDatasets);
                            analysisResults.style.display = 'block';
                            
                            // Display achievements if available
                            if (data.achievements) {
                                displayAchievements(data.achievements);
                            } else {
                                achievementsSection.style.display = 'none';
                            }
                            
                            // Setup adaptive chart toggle
                            adaptiveChartToggle.addEventListener('change', function() {
                                isAdaptiveChart = this.checked;
                                
                                // Update chart with new normalized values
                                chartInstance.data.datasets.forEach((dataset, i) => {
                                    const columnName = dataset.originalColumn;
                                    const originalData = dataset.originalData;
                                    
                                    for (let j = 0; j < originalData.length; j++) {
                                        const originalValue = originalData[j];
                                        dataset.data[j].y = isAdaptiveChart 
                                            ? normalizeValueForAdaptiveScale(originalValue, columnName)
                                            : originalValue;
                                    }
                                });
                                
                                chartInstance.update();
                            });
                            
                            // Setup reset zoom button
                            resetZoomButton.addEventListener('click', function() {
                                if (chartInstance) {
                                    chartInstance.resetZoom();
                                }
                            });
                            
                            // Accessibility: Add keyboard navigation for chart
                            dataChart.tabIndex = 0;
                            dataChart.setAttribute('role', 'img');
                            dataChart.setAttribute('aria-label', window.gettext('Trip telemetry chart'));
                        } else {
                            showError(window.gettext('No valid data found in the CSV file.'));
                        }
                    } else {
                        showError(window.gettext('Invalid data format received from server.'));
                    }
                } catch (error) {
                    console.error('Error parsing chart data:', error);
                    showError(window.gettext('Error parsing data for visualization.'));
                }
            } else {
                showError(window.gettext('No data received from server.'));
            }
        })
        .catch(error => {
            // Handle errors
            console.error('Error:', error);
            loadingIndicator.style.display = 'none';
            showError(error.message || window.gettext('An error occurred while processing the file.'));
        });
    });

    // Function to handle drag operations on the chart
    function setupDragHandling() {
        // Mouse events
        dataChart.addEventListener('mousedown', function(e) {
            isDragging = true;
            dragStartX = e.clientX;
            dataChart.style.cursor = 'grabbing';
        });
        
        window.addEventListener('mousemove', function(e) {
            if (!isDragging || !chartInstance) return;
            
            const dx = e.clientX - dragStartX;
            const rangePerPixel = (chartInstance.scales.x.max - chartInstance.scales.x.min) / dataChart.width;
            const offsetX = dx * rangePerPixel;
            
            chartInstance.scales.x.min -= offsetX;
            chartInstance.scales.x.max -= offsetX;
            chartInstance.update();
            
            dragStartX = e.clientX;
        });
        
        window.addEventListener('mouseup', function() {
            if (isDragging) {
                isDragging = false;
                dataChart.style.cursor = 'grab';
            }
        });
        
        dataChart.style.cursor = 'grab';
    }
    
    // Set up drag handling
    setupDragHandling();
    
    // Function to display achievements
    function displayAchievements(achievements) {
        // Hide achievements section if no achievements to display
        if (!achievements || achievements.length === 0) {
            achievementsSection.style.display = 'none';
            return;
        }
        
        // Clear previous achievements
        achievementsContainer.innerHTML = '';
        
        // Create achievement cards
        achievements.forEach(achievement => {
            const achievementDiv = document.createElement('div');
            achievementDiv.className = 'col-md-6 col-lg-4 mb-3';
            
            // Create a new achievement card with the custom style
            const card = document.createElement('div');
            card.className = 'achievement-card';
            
            // Create achievement icon
            const icon = document.createElement('img');
            icon.src = `/static/icons/euc_man_pack/${achievement.icon}`;
            icon.alt = achievement.title;
            icon.className = 'achievement-icon';
            
            // Create content container
            const contentDiv = document.createElement('div');
            contentDiv.className = 'achievement-content';
            
            // Create achievement title
            const title = document.createElement('h5');
            title.className = 'achievement-title';
            title.textContent = achievement.title;
            
            // Create achievement description
            const description = document.createElement('p');
            description.className = 'achievement-description';
            description.textContent = achievement.description;
            
            // Assemble the card
            contentDiv.appendChild(title);
            contentDiv.appendChild(description);
            card.appendChild(icon);
            card.appendChild(contentDiv);
            achievementDiv.appendChild(card);
            
            // Add to container
            achievementsContainer.appendChild(achievementDiv);
        });
        
        // Show achievements section
        achievementsSection.style.display = 'block';
    }
    
    // Check for file input when the page loads
    if (csvFileInput.files.length > 0) {
        uploadButton.click();
    }
});
