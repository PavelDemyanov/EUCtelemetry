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
    const achievementsCardBody = document.getElementById('achievementsCardBody'); // Achievements card body
    const toggleAchievements = document.getElementById('toggleAchievements'); // Toggle achievements button
    const achievementsToggleIcon = document.getElementById('achievementsToggleIcon'); // Toggle icon
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
                                        strokeStyle: '#fff',
                                        lineWidth: 1,
                                        hidden: isHidden,
                                        index: i,
                                        fontColor: '#fff'
                                    };
                                });
                            }
                        },
                        onClick: (e, legendItem, legend) => {
                            // Toggle dataset visibility on legend click
                            const index = legendItem.index;
                            const meta = chartInstance.getDatasetMeta(index);
                            meta.hidden = meta.hidden ? false : true;
                            chartInstance.update();
                        }
                    },
                    zoom: {
                        pan: {
                            enabled: true,
                            mode: 'x',
                            modifierKey: 'shift',
                            onPanStart: () => {
                                dataChart.style.cursor = 'grabbing';
                            },
                            onPanComplete: () => {
                                dataChart.style.cursor = 'grab';
                            }
                        },
                        zoom: {
                            wheel: { enabled: true },
                            pinch: { enabled: true },
                            mode: 'x',
                            onZoomComplete: (context) => {
                                // Update zoom status
                                isZoomed = context.chart.isZoomed = true;
                            }
                        },
                        limits: {
                            x: {
                                min: minTimestamp - fullRange * 0.05,
                                max: maxTimestamp + fullRange * 0.05,
                                minRange: fullRange * 0.01 // Minimum zoom level is 1% of the total range
                            }
                        }
                    }
                },
                animation: false, // Disable animations
                onResize: (chart, size) => {
                    // Update chart when container size changes
                }
            }
        });

        // Store initial X-axis range for reset functionality
        chartStartMin = minTimestamp;
        chartStartMax = maxTimestamp;
    }

    // Function to parse CSV data from response and prepare for plotting
    function prepareDataForPlot(csvData, type) {
        if (!csvData || !Array.isArray(csvData) || csvData.length === 0) {
            return {
                labels: [],
                datasets: []
            };
        }

        // Get timestamp column as X-axis labels
        const labels = csvData.map(row => parseFloat(row.timestamp));

        // Prepare datasets for plotting
        const datasets = [];
        const columns = [
            { key: 'speed', label: window.gettext('Speed') },
            { key: 'gps', label: window.gettext('GPS') },
            { key: 'voltage', label: window.gettext('Voltage') },
            { key: 'temperature', label: window.gettext('Temperature') },
            { key: 'current', label: window.gettext('Current') },
            { key: 'battery', label: window.gettext('Battery') },
            { key: 'mileage', label: window.gettext('Mileage') },
            { key: 'pwm', label: window.gettext('PWM') },
            { key: 'power', label: window.gettext('Power') }
        ];

        columns.forEach(column => {
            const key = column.key;
            
            // Skip columns that don't exist in the data
            if (!csvData.some(row => key in row)) return;
            
            // Get original data for the column
            const originalData = csvData.map(row => {
                const value = row[key];
                return typeof value === 'string' ? parseFloat(value) : value;
            });
            
            // For adaptive chart, normalize values
            const data = originalData.map((value, index) => {
                return normalizeValueForAdaptiveScale(value, key);
            });
            
            datasets.push({
                label: column.label,
                data: data,
                originalData: originalData,
                originalColumn: key
            });
        });

        return {
            labels: labels,
            datasets: datasets
        };
    }

    // Plot all columns from CSV data
    function plotAllColumns(data) {
        if (!data || data.length === 0) {
            console.error('No valid data to plot');
            return;
        }
        
        // Prepare data for plotting
        const chartData = prepareDataForPlot(data);
        
        // Create chart
        createMultiChart(chartData.labels, chartData.datasets);
    }

    // Toggle between original and adaptive scale
    adaptiveChartToggle.addEventListener('change', function() {
        isAdaptiveChart = this.checked;
        if (csvData) {
            plotAllColumns(csvData);
        }
    });

    // Reset zoom to original chart scale
    resetZoomButton.addEventListener('click', function() {
        if (chartInstance) {
            chartInstance.resetZoom();
        }
    });

    // Handle form submission for CSV upload
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const file = csvFileInput.files[0];
        if (!file) {
            showError(window.gettext('Please select a CSV file'));
            return;
        }
        
        // Check file extension
        const fileExt = file.name.split('.').pop().toLowerCase();
        if (fileExt !== 'csv') {
            showError(window.gettext('Please select a valid CSV file'));
            return;
        }
        
        // Check file size (limit to 50 MB)
        const maxSize = 50 * 1024 * 1024; // 50 MB in bytes
        if (file.size > maxSize) {
            showError(window.gettext('File size exceeds 50 MB limit. Please select a smaller file.'));
            return;
        }
        
        // Hide previous errors
        hideError();
        
        // Show loading indicator
        loadingIndicator.style.display = 'block';
        
        // Hide results while loading
        analysisResults.style.display = 'none';
        
        // Create form data for sending file
        const formData = new FormData();
        formData.append('file', file);
        
        // Send file to server for processing
        fetch('/analyze_csv', {
            method: 'POST',
            body: formData
        })
            .then(response => response.json())
            .then(data => {
                // Hide loading indicator
                loadingIndicator.style.display = 'none';
                
                if (data && data.success) {
                    // Parse CSV data
                    csvData = JSON.parse(data.csv_data);
                    
                    // Show results
                    analysisResults.style.display = 'block';
                    
                    // Display achievements if available
                    if (data.achievements) {
                        displayAchievements(data.achievements);
                    } else {
                        achievementsSection.style.display = 'none';
                    }
                    
                    plotAllColumns(csvData);
                } else if (data && data.error) {
                    showError(data.error);
                }
            })
            .catch(error => {
                showError(window.gettext('An error occurred while processing the file'));
                console.error(error);
            });
    });

    // Check URL for file parameter
    function checkUrlForFileParameter() {
        const urlParams = new URLSearchParams(window.location.search);
        const fileId = urlParams.get('file');
        
        if (fileId) {
            // We have a file ID in URL, try to load it
            loadingIndicator.style.display = 'block';
            
            fetch('/analyze_csv', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ file_id: fileId })
            })
                .then(response => response.json())
                .then(data => {
                    loadingIndicator.style.display = 'none';
                    
                    if (data && data.success) {
                        try {
                            // Parse CSV data
                            csvData = JSON.parse(data.csv_data);
                            
                            // Show results
                            analysisResults.style.display = 'block';
                            
                            // Display achievements if available
                            if (data.achievements) {
                                displayAchievements(data.achievements);
                            } else {
                                achievementsSection.style.display = "none";
                            }
                            
                            // Plot the data
                            plotAllColumns(csvData);
                            
                            // Add file parameter to URL without reloading
                            const url = new URL(window.location);
                            url.searchParams.set('file', data.file_id || 'uploaded');
                            window.history.pushState({}, '', url);
                            
                        } catch (e) {
                            console.error('Error parsing JSON data:', e);
                            showError(window.gettext('Error parsing data. Please try uploading the file again.'));
                        }
                    } else if (data && data.error) {
                        showError(data.error);
                    }
                })
                .catch(error => {
                    loadingIndicator.style.display = 'none';
                    showError(window.gettext('An error occurred while loading the file'));
                    console.error(error);
                });
        }
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
        
        // Create achievement cards
        achievements.forEach(achievement => {
            const achievementDiv = document.createElement('div');
            achievementDiv.className = 'col-md-4 col-lg-3 mb-3';
            
            const card = document.createElement('div');
            card.className = 'card h-100 border-0 shadow-sm achievement-card';
            card.style.borderRadius = '12px';
            card.style.overflow = 'hidden';
            
            // Use icon if available, otherwise use a placeholder
            const iconPath = achievement.icon ? 
                `/static/icons/euc_man_pack/${achievement.icon}` : 
                '/static/icons/achievement-placeholder.svg';
            
            // Create card content
            card.innerHTML = `
                <div class="d-flex justify-content-center align-items-center p-3" style="height: 120px; background-color: #f8f9fa;">
                    <img src="${iconPath}" alt="${achievement.title}" style="height: 100px; width: auto;">
                </div>
                <div class="card-body">
                    <h5 class="card-title">${achievement.title}</h5>
                    <p class="card-text">${achievement.description}</p>
                </div>
            `;
            
            achievementDiv.appendChild(card);
            achievementsContainer.appendChild(achievementDiv);
        });
        
        // Show achievements section
        achievementsSection.style.display = 'block';
        
        // Setup toggle functionality for achievements section
        if (toggleAchievements) {
            toggleAchievements.addEventListener('click', function() {
                if (achievementsCardBody.style.display === 'none') {
                    achievementsCardBody.style.display = 'block';
                    achievementsToggleIcon.classList.remove('bi-chevron-down');
                    achievementsToggleIcon.classList.add('bi-chevron-up');
                } else {
                    achievementsCardBody.style.display = 'none';
                    achievementsToggleIcon.classList.remove('bi-chevron-up');
                    achievementsToggleIcon.classList.add('bi-chevron-down');
                }
            });
        }
    }

    // Check for file parameter in URL when page loads
    checkUrlForFileParameter();
});
