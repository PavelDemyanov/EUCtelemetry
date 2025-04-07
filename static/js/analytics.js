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
                                        strokeStyle: dataset.borderColor,
                                        lineWidth: 2,
                                        hidden: isHidden,
                                        index: i,
                                        datasetIndex: i
                                    };
                                });
                            },
                            boxWidth: 20, // Legend marker width
                            padding: 10, // Padding between legend items
                            font: { size: 12 } // Legend font size
                        },
                        onClick: (e, legendItem, legend) => {
                            const index = legendItem.datasetIndex;
                            const ci = legend.chart;
                            const meta = ci.getDatasetMeta(index);
                            meta.hidden = meta.hidden === null ? !ci.data.datasets[index].hidden : null;
                            ci.update(); // Update chart
                        }
                    },
                    zoom: {
                        zoom: {
                            wheel: { enabled: true }, // Enable zoom with mouse wheel
                            pinch: { enabled: true }, // Enable zoom with pinch
                            mode: 'x', // Zoom only along X-axis
                            speed: 100, // Zoom speed
                            threshold: 2, // Zoom threshold
                            sensitivity: 3 // Zoom sensitivity
                        },
                        pan: {
                            enabled: true, // Enable panning
                            mode: 'x', // Pan only along X-axis
                            threshold: 10, // Minimum drag distance
                            speed: 10, // Panning speed
                            onPanStart: ({ chart }) => {
                                isDragging = true;
                                const scales = chart.scales;
                                dragStartX = scales.x.min;
                                chartStartMin = scales.x.min;
                                chartStartMax = scales.x.max;
                                return true; // Allow panning
                            }
                        },
                        limits: {
                            x: { min: minTimestamp, max: maxTimestamp, minRange: fullRange * 0.01 } // Limits for X-axis
                        }
                    }
                },
                interaction: {
                    mode: 'index', // Show tooltip for all datasets at current X position
                    intersect: false, // No need for direct intersection with point
                }
            },
        });
    }

    // Function to display achievements
    function displayAchievements(achievements) {
        // Hide achievements section if no achievements to display
        if (!achievements || achievements.length === 0) {
            achievementsSection.style.display = 'none';
            return;
        }
        
        // Clear previous achievements
        achievementsContainer.innerHTML = '';
        
        // Create a row for the achievements
        const row = document.createElement('div');
        row.className = 'row';
        achievementsContainer.appendChild(row);
        
        // Create achievement cards
        achievements.forEach(achievement => {
            // Create column container - 4 columns on desktop (3 achievements per row), 12 on mobile (1 per row)
            const achievementDiv = document.createElement('div');
            achievementDiv.className = 'col-md-4 col-12 mb-3';
            
            // Create card container
            const card = document.createElement('div');
            card.className = 'achievement-card';
            
            // Create achievement icon
            const icon = document.createElement('img');
            icon.src = `/static/icons/euc_man_pack/${achievement.icon}`;
            icon.alt = achievement.title;
            icon.className = 'achievement-icon';
            
            // Create content container
            const content = document.createElement('div');
            content.className = 'achievement-content';
            
            // Create achievement title
            const title = document.createElement('h5');
            title.className = 'achievement-title';
            title.textContent = achievement.title;
            
            // Create achievement description
            const description = document.createElement('p');
            description.className = 'achievement-description';
            description.textContent = achievement.description;
            
            // Assemble the card
            content.appendChild(title);
            content.appendChild(description);
            card.appendChild(icon);
            card.appendChild(content);
            achievementDiv.appendChild(card);
            
            // Add to row
            row.appendChild(achievementDiv);
        });
        
        // Show achievements section
        achievementsSection.style.display = 'block';
    }
    // Event listener for form submission
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Get the selected file
        const file = csvFileInput.files[0];
        if (!file) {
            showError(window.gettext('Please select a CSV file to upload'));
            return;
        }
        
        // Check file size (warn if over 20MB)
        const maxSizeMB = 20;
        if (file.size > maxSizeMB * 1024 * 1024) {
            if (!confirm(window.gettext('The file is larger than {0}MB, which may take a long time to process. Do you want to continue?').replace('{0}', maxSizeMB))) {
                return;
            }
        }
        
        // Check file type (must be CSV)
        if (file.type && !file.type.includes('csv') && !file.name.toLowerCase().endsWith('.csv')) {
            showError(window.gettext('Please upload a CSV file'));
            return;
        }
        
        // UI updates for loading state
        uploadButton.disabled = true;
        hideError();
        achievementsSection.style.display = 'none';
        analysisResults.style.display = 'none';
        loadingIndicator.style.display = 'block';
        
        // Create form data and send request
        const formData = new FormData();
        formData.append('file', file);
        
        // Send AJAX request
        fetch('/analyze_csv', {
            method: 'POST',
            body: formData
        })
            .then(response => response.json())
            .then(data => {
                uploadButton.disabled = false;
                loadingIndicator.style.display = 'none';
                
                if (data.error) {
                    showError(data.error);
                    return;
                }
                
                try {
                    if (!data.csv_data) {
                        showError(window.gettext('No data returned from server'));
                        return;
                    }
                    
                    // Parse returned data
                    const parsedData = JSON.parse(data.csv_data);
                    
                    // Ensure we have timestamp data
                    if (!parsedData.timestamp || parsedData.timestamp.length === 0) {
                        showError(window.gettext('No valid timestamp data found in the CSV file'));
                        return;
                    }
                    
                    // Store the data for future use (adaptive scaling)
                    csvData = [];
                    for (let i = 0; i < parsedData.timestamp.length; i++) {
                        const row = {};
                        Object.keys(parsedData).forEach(key => {
                            if (parsedData[key][i] !== null && parsedData[key][i] !== undefined) {
                                row[key] = parsedData[key][i];
                            } else {
                                row[key] = null;
                            }
                        });
                        csvData.push(row);
                    }
                    
                    // Prepare data for chart
                    updateChart(parsedData);
                    
                    // Display achievements if available
                    if (data.achievements) {
                        displayAchievements(data.achievements);
                    } else {
                        achievementsSection.style.display = 'none';
                    }
                    
                    // Show results
                    analysisResults.style.display = 'block';
                } catch (e) {
                    console.error('Error processing data:', e);
                    showError(window.gettext('Error processing data: ') + e.message);
                }
            })
            .catch(error => {
                console.error('Request error:', error);
                uploadButton.disabled = false;
                loadingIndicator.style.display = 'none';
                showError(window.gettext('Error sending request: ') + error.message);
            });
    });
    
    // Event listener for adaptive chart toggle
    adaptiveChartToggle.addEventListener('change', function() {
        isAdaptiveChart = this.checked;
        if (csvData) {
            const parsedData = {};
            
            // Convert from array of objects to object of arrays (for chart)
            Object.keys(csvData[0]).forEach(key => {
                parsedData[key] = csvData.map(row => row[key]);
            });
            
            updateChart(parsedData);
        }
    });
    
    // Event listener for reset zoom button
    resetZoomButton.addEventListener('click', function() {
        if (chartInstance) {
            chartInstance.resetZoom();
        }
    });
    
    // Function to update chart with new data
    function updateChart(data) {
        if (!data.timestamp || data.timestamp.length === 0) return;
        
        const labels = data.timestamp;
        const datasets = [];
        
        // Add datasets in specific order
        const order = ['speed', 'gps', 'battery', 'voltage', 'current', 'power', 'pwm', 'temperature', 'mileage'];
        
        // Add available datasets in preferred order
        order.forEach(key => {
            if (data[key] && data[key].length > 0) {
                const originalData = data[key];
                
                // Process data for chart (normalize if adaptive)
                const chartData = originalData.map((value, i) => {
                    if (value === null || value === undefined || isNaN(value)) return null;
                    return normalizeValueForAdaptiveScale(parseFloat(value), key);
                });
                
                datasets.push({
                    label: window.gettext(key),
                    data: chartData,
                    originalData: originalData,
                    originalColumn: key
                });
            }
        });
        
        // Create multi-line chart with all datasets
        createMultiChart(labels, datasets);
    }
});
