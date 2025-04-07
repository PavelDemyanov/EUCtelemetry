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
                                        lineWidth: 0,
                                        hidden: isHidden,
                                        index: i
                                    };
                                });
                            },
                            padding: 10 // Padding around legend items
                        },
                        onClick: (e, legendItem, legend) => {
                            // Toggle visibility of clicked dataset
                            const index = legendItem.index;
                            const chart = legend.chart;
                            const meta = chart.getDatasetMeta(index);
                            meta.hidden = meta.hidden === null ? !chart.data.datasets[index].hidden : null;
                            chart.update();
                        }
                    },
                    zoom: {
                        limits: {
                            x: { min: minTimestamp, max: maxTimestamp }, // Set zoom limits to data range
                            y: { min: 'original', max: 'original' } // Automatic Y-axis limits
                        },
                        pan: {
                            enabled: true, // Enable panning
                            mode: 'x', // Pan only in X direction
                            modifierKey: 'shift' // Hold shift key for panning instead of zooming
                        },
                        zoom: {
                            wheel: { enabled: true }, // Enable mouse wheel zooming
                            mode: 'x', // Zoom only in X direction
                            drag: { enabled: true, borderColor: 'rgba(255,255,255,0.3)', borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.1)' }
                        }
                    }
                },
                onHover: (event, chartElements) => {
                    // Change cursor to grab if hovering over chart area (for panning)
                    event.native.target.style.cursor = chartElements.length ? 'pointer' : 'grab';
                },
                animation: false // Disable animations for better performance
            },
        });

        // Store initial X-axis range for zoom reset
        chartStartMin = minTimestamp;
        chartStartMax = maxTimestamp;

        // Setup mouse drag events for chart panning
        dataChart.addEventListener('mousedown', (e) => {
            isDragging = true;
            dragStartX = e.offsetX;
            dataChart.style.cursor = 'grabbing';
        });

        dataChart.addEventListener('mousemove', (e) => {
            if (!isDragging || !chartInstance) return;
            const deltaX = e.offsetX - dragStartX;
            const chart = chartInstance;
            const dx = (chart.scales.x.max - chart.scales.x.min) * (deltaX / chart.width);
            chart.scales.x.min -= dx;
            chart.scales.x.max -= dx;
            chart.update();
            dragStartX = e.offsetX;
        });

        // Use window events to catch mouse release even outside chart
        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                dataChart.style.cursor = 'grab';
            }
        });

        // Update chart on window resize
        window.addEventListener('resize', () => {
            if (chartInstance) chartInstance.resize();
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
        
        // Add each achievement
        achievements.forEach(achievement => {
            // Create column container - 4 columns on desktop (3 achievements per row), 12 on mobile (1 per row)
            const colDiv = document.createElement('div');
            colDiv.className = 'col-12 col-md-4 mb-3';
            
            // Create achievement container
            const achievementDiv = document.createElement('div');
            achievementDiv.className = 'achievement-card';
            achievementDiv.dataset.achievementId = achievement.id;
            
            // Create card layout for achievement
            const cardLayout = document.createElement('div');
            cardLayout.className = 'achievement-layout';
            
            // Create icon container
            const iconContainer = document.createElement('div');
            iconContainer.className = 'achievement-icon';
            
            // Create icon image
            const iconImg = document.createElement('img');
            iconImg.src = `/static/icons/euc_man_pack/${achievement.icon}`;
            iconImg.alt = achievement.title;
            iconImg.className = 'img-fluid'; // Responsive image
            iconContainer.appendChild(iconImg);
            
            // Create content container
            const contentDiv = document.createElement('div');
            contentDiv.className = 'achievement-content';
            
            // Create title
            const titleElem = document.createElement('h5');
            titleElem.textContent = achievement.title;
            titleElem.className = 'achievement-title';
            
            // Create description
            const descElem = document.createElement('p');
            descElem.textContent = achievement.description;
            descElem.className = 'achievement-description';
            
            // Assemble the achievement card
            contentDiv.appendChild(titleElem);
            contentDiv.appendChild(descElem);
            
            cardLayout.appendChild(iconContainer);
            cardLayout.appendChild(contentDiv);
            achievementDiv.appendChild(cardLayout);
            
            colDiv.appendChild(achievementDiv);
            row.appendChild(colDiv);
        });
        
        // Show achievements section
        achievementsSection.style.display = 'block';
    }

    // Initialize with empty state
    function resetUI() {
        // Clear data and reset UI
        if (chartInstance) chartInstance.destroy();
        chartInstance = null;
        csvData = null;
        
        // Hide elements
        analysisResults.style.display = 'none';
        achievementsSection.style.display = 'none';
        errorMessage.style.display = 'none';
        
        // Reset form elements
        uploadForm.reset();
    }

    // Handle file upload
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault(); // Prevent form submission
        hideError(); // Hide previous errors
        
        // Validate file input
        if (!csvFileInput.files || csvFileInput.files.length === 0) {
            showError(window.gettext('Please select a CSV file to upload'));
            return;
        }
        
        const file = csvFileInput.files[0];
        
        // Validate file type
        if (!file.name.toLowerCase().endsWith('.csv')) {
            showError(window.gettext('Please upload a valid CSV file'));
            return;
        }
        
        // Set UI state to loading
        uploadButton.disabled = true;
        loadingIndicator.style.display = 'block';
        
        // Prepare form data for upload
        const formData = new FormData();
        formData.append('file', file);
        
        // Send file to server for processing
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
                    
                    // Debug data structure
                    console.log('Data type received:', typeof data.csv_data);
                    
                    // Use data as is since the server already sent it in the correct format
                    const parsedData = data.csv_data;
                    
                    // Debug data structure
                    console.log('Data structure:', parsedData.length > 0 ? 'Array of objects' : 'Unknown format');
                    console.log('First record keys:', parsedData.length > 0 ? Object.keys(parsedData[0]) : 'No data');
                    
                    // Check if we have data with timestamp
                    if (!parsedData || parsedData.length === 0 || !parsedData[0].timestamp) {
                        showError(window.gettext('No valid timestamp data found in the CSV file'));
                        return;
                    }
                    
                    // Store the data for future use (adaptive scaling)
                    csvData = parsedData;
                    
                    // Extract data for chart
                    const timestamps = csvData.map(row => parseFloat(row.timestamp));
                    
                    // Create datasets
                    const datasets = [];
                    const columns = ['speed', 'gps', 'voltage', 'temperature', 'current', 'battery', 'mileage', 'pwm', 'power'];
                    
                    columns.forEach(column => {
                        // Skip columns that don't exist in data
                        if (!csvData.some(row => column in row)) return;
                        
                        const values = csvData.map(row => {
                            const value = parseFloat(row[column]);
                            return isNaN(value) ? null : value;
                        });
                        
                        // Skip columns with no valid data
                        if (values.every(v => v === null)) return;
                        
                        // Create two datasets - one with original values for tooltips, one with normalized values for display
                        if (isAdaptiveChart) {
                            const normalizedValues = values.map((value, i) => 
                                value === null ? null : normalizeValueForAdaptiveScale(value, column)
                            );
                            
                            datasets.push({
                                label: window.gettext(column),
                                data: normalizedValues,
                                originalData: values,
                                originalColumn: column
                            });
                        } else {
                            datasets.push({
                                label: window.gettext(column),
                                data: values,
                                originalData: values,
                                originalColumn: column
                            });
                        }
                    });
                    
                    // Create chart
                    createMultiChart(timestamps, datasets);
                    
                    // Display achievements if available
                    if (data.achievements) {
                        displayAchievements(data.achievements);
                    } else {
                        achievementsSection.style.display = 'none';
                    }
                    
                    // Show results section
                    analysisResults.style.display = 'block';
                    
                } catch (error) {
                    console.error('Error processing data:', error);
                    showError(window.gettext('Error processing data:') + ' ' + error.message);
                }
            })
            .catch(error => {
                console.error('Fetch error:', error);
                uploadButton.disabled = false;
                loadingIndicator.style.display = 'none';
                showError(window.gettext('Error uploading file:') + ' ' + error.message);
            });
    });

    // Handle adaptive toggle change
    adaptiveChartToggle.addEventListener('change', function() {
        isAdaptiveChart = this.checked;
        
        // Re-process data with current settings if we have data
        if (csvData && csvData.length > 0) {
            // Extract timestamps again
            const timestamps = csvData.map(row => parseFloat(row.timestamp));
            
            // Create datasets with updated normalization
            const datasets = [];
            const columns = ['speed', 'gps', 'voltage', 'temperature', 'current', 'battery', 'mileage', 'pwm', 'power'];
            
            columns.forEach(column => {
                // Skip columns that don't exist
                if (!csvData.some(row => column in row)) return;
                
                const values = csvData.map(row => {
                    const value = parseFloat(row[column]);
                    return isNaN(value) ? null : value;
                });
                
                // Skip columns with no valid data
                if (values.every(v => v === null)) return;
                
                if (isAdaptiveChart) {
                    const normalizedValues = values.map((value, i) => 
                        value === null ? null : normalizeValueForAdaptiveScale(value, column)
                    );
                    
                    datasets.push({
                        label: window.gettext(column),
                        data: normalizedValues,
                        originalData: values,
                        originalColumn: column
                    });
                } else {
                    datasets.push({
                        label: window.gettext(column),
                        data: values,
                        originalData: values,
                        originalColumn: column
                    });
                }
            });
            
            // Recreate chart with updated data
            createMultiChart(timestamps, datasets);
        }
    });

    // Handle reset zoom button click
    resetZoomButton.addEventListener('click', function() {
        if (chartInstance) {
            // Reset to initial range
            chartInstance.scales.x.min = chartStartMin;
            chartInstance.scales.x.max = chartStartMax;
            chartInstance.update();
        }
    });
});
