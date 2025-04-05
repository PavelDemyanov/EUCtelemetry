// Wait for DOM to fully load before executing the script
document.addEventListener('DOMContentLoaded', function() {
    // Get UI elements from HTML
    const uploadForm = document.getElementById('uploadForm'); // Upload form
    const csvFileInput = document.getElementById('csvFile'); // CSV file input
    const uploadButton = document.getElementById('uploadButton'); // Upload button
    const loadingIndicator = document.getElementById('loadingIndicator'); // Loading indicator
    const errorMessage = document.getElementById('errorMessage'); // Error message
    const analysisResults = document.getElementById('analysisResults'); // Analysis results block
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
            
            // Находим максимальные значения напряжения и заряда батареи
            const voltageValues = csvData.map(row => parseFloat(row.voltage) || 0);
            const batteryValues = csvData.map(row => parseFloat(row.battery) || 0);
            const maxVoltage = Math.max(...voltageValues);
            const minVoltage = Math.min(...voltageValues);
            const maxBattery = Math.max(...batteryValues);
            
            // Находим текущий процент от максимального напряжения
            if (maxVoltage === minVoltage) return maxBattery; // Предотвращаем деление на ноль
            
            const voltagePercent = ((value - minVoltage) / (maxVoltage - minVoltage)) * 100;
            
            // Преобразуем проценты напряжения с учетом коэффициента 0.25
            // Если батарея снижается на 1%, напряжение снижается на 0.25%
            return maxBattery - ((100 - voltagePercent) * 0.25);
        }
        
        return value;
    }

    // Color palette for different data types
    const colorPalette = {
        speed: { borderColor: '#0000FF', backgroundColor: 'rgba(0, 0, 255, 0.2)' },
        gps: { borderColor: '#00daff', backgroundColor: 'rgba(255, 165, 0, 0.2)' },
        voltage: { borderColor: '#800080', backgroundColor: 'rgba(128, 0, 128, 0.2)' },
        temperature: { borderColor: '#FF00FF', backgroundColor: 'rgba(255, 0, 255, 0.2)' },
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
                                        fillStyle: isHidden ? '#555555' : dataset.borderColor,
                                        strokeStyle: isHidden ? '#555555' : dataset.borderColor,
                                        lineWidth: 2,
                                        hidden: isHidden,
                                        index: i,
                                        fontColor: isHidden ? '#555555' : '#fff'
                                    };
                                });
                            }
                        },
                        onClick: (e, legendItem) => {
                            // Toggle dataset visibility when clicking on legend
                            const index = legendItem.index;
                            const meta = chartInstance.getDatasetMeta(index);
                            meta.hidden = !meta.hidden;
                            chartInstance.update();
                        }
                    },
                    zoom: {
                        pan: {
                            enabled: true, // Enable panning
                            mode: 'x', // Panning on X-axis
                            rangeMin: { x: minTimestamp }, // Panning limits
                            rangeMax: { x: maxTimestamp }
                        },
                        zoom: {
                            wheel: { enabled: true }, // Zoom with mouse wheel
                            pinch: { enabled: true }, // Zoom with gestures
                            mode: 'x', // Zoom on X-axis
                            limits: {
                                x: {
                                    min: minTimestamp, // Minimum X-axis limit
                                    max: maxTimestamp, // Maximum X-axis limit
                                    minRange: fullRange // Minimum visible range (not less than full X-axis)
                                }
                            }
                        }
                    }
                },
                interaction: { mode: 'index', intersect: false } // Interaction mode for tooltips
            }
        });
    }

    // Function to plot chart based on all data columns
    function plotAllColumns(data) {
        if (!data) return;
        const timestamps = data.map(row => row.timestamp); // Extract timestamps
        const columns = Object.keys(data[0]).filter(col => col.toLowerCase() !== 'timestamp' && data.some(row => !isNaN(parseFloat(row[col]))));
        const datasets = columns.map((column) => {
            const originalValues = data.map(row => parseFloat(row[column]) || 0); // Original values
            const normalizedValues = originalValues.map(value => normalizeValueForAdaptiveScale(value, column)); // Normalized values
            return {
                originalColumn: column, // Store original technical column name
                label: window.gettext(column),
                originalColumn: column, // Store original technical column name
                data: isAdaptiveChart ? normalizedValues : originalValues, // Select data based on mode
                originalData: originalValues // Save original data for tooltips
            };
        });
        createMultiChart(timestamps, datasets); // Create chart
        setupManualPanning(); // Setup manual panning
    }

    // Setup manual panning with mouse dragging
    function setupManualPanning() {
        const canvas = dataChart;
        
        // Handle mouse down event to start dragging
        canvas.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return; // Only handle left button
            isDragging = true;
            dragStartX = e.offsetX;
            chartStartMin = chartInstance.options.scales.x.min;
            chartStartMax = chartInstance.options.scales.x.max;
            canvas.style.cursor = 'grabbing';
        });
        
        // Handle mouse move to pan the chart
        canvas.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            
            // Calculate drag distance
            const diffX = e.offsetX - dragStartX;
            const fullWidth = canvas.width;
            const fullRange = chartStartMax - chartStartMin;
            const shiftAmount = (diffX / fullWidth) * fullRange;
            
            // Apply pan if chart exists
            if (chartInstance) {
                chartInstance.options.scales.x.min = chartStartMin - shiftAmount;
                chartInstance.options.scales.x.max = chartStartMax - shiftAmount;
                chartInstance.update('none'); // Update without animation
            }
        });
        
        // End dragging on mouse up or mouse leave
        const endDrag = function() {
            if (isDragging) {
                isDragging = false;
                canvas.style.cursor = 'grab';
            }
        };
        
        canvas.addEventListener('mouseup', endDrag);
        canvas.addEventListener('mouseleave', endDrag);
    }

    // Toggle between adaptive and original scale
    if (adaptiveChartToggle) {
        adaptiveChartToggle.addEventListener('change', function() {
            isAdaptiveChart = this.checked;
            if (csvData) {
                plotAllColumns(csvData);
            }
        });
    }

    // Reset zoom button click handler
    if (resetZoomButton) {
        resetZoomButton.addEventListener('click', function() {
            if (chartInstance) {
                // Get original minimum and maximum timestamps
                const minTimestamp = Math.min(...chartInstance.data.labels);
                const maxTimestamp = Math.max(...chartInstance.data.labels);
                
                // Reset chart boundaries
                chartInstance.options.scales.x.min = minTimestamp;
                chartInstance.options.scales.x.max = maxTimestamp;
                chartInstance.update();
            }
        });
    }

    // Process URL parameters
    function processUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const fileParam = urlParams.get('file');
        if (fileParam) {
            // Show loading indicator
            loadingIndicator.style.display = 'block';
            
            // Fetch CSV data
            fetch(`/analyze_csv?file=${encodeURIComponent(fileParam)}`)
                .then(response => {
                    if (!response.ok) {
                        showError(window.gettext('Could not load the specified file'));
                        return null;
                    }
                    return response.json();
                })
                .then(data => {
                    if (data && data.success && data.csv_data) {
                        // Hide loading, show results
                        loadingIndicator.style.display = 'none';
                        analysisResults.style.display = 'block';
                        
                        // Parse data and create chart
                        csvData = JSON.parse(data.csv_data);
                        plotAllColumns(csvData);
                    } else if (data && data.error) {
                        showError(data.error);
                    }
                })
                .catch(error => {
                    showError(window.gettext('An error occurred while processing the file'));
                    console.error(error);
                });
        }
    }

    // Form submission handler for CSV upload
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        hideError();
        
        const formData = new FormData();
        const file = csvFileInput.files[0];
        
        if (!file) {
            showError(window.gettext('Please select a CSV file'));
            return;
        }
        
        formData.append('file', file);
        
        // Show loading indicator
        loadingIndicator.style.display = 'block';
        analysisResults.style.display = 'none';
        
        // Send request to the server
        fetch('/analyze_csv', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => {
                    throw new Error(err.error || 'Server error');
                });
            }
            return response.json();
        })
        .then(data => {
            // Parse JSON data from the server
            if (data && data.success && data.csv_data) {
                try {
                    csvData = JSON.parse(data.csv_data);
                    
                    // Hide loading, show results
                    loadingIndicator.style.display = 'none';
                    analysisResults.style.display = 'block';
                    
                    // Plot the data
                    plotAllColumns(csvData);
                    
                    // Add file parameter to URL without reloading
                    const url = new URL(window.location);
                    url.searchParams.set('file', data.file_id || 'uploaded');
                    window.history.pushState({}, '', url);
                    
                } catch (e) {
                    showError(window.gettext('Error parsing CSV data: ') + e.message);
                    console.error('Error parsing CSV data:', e);
                }
            } else if (data && data.error) {
                showError(data.error);
            } else {
                showError(window.gettext('Received invalid data format from server'));
            }
        })
        .catch(error => {
            showError(error.message || window.gettext('An error occurred while processing the file'));
            console.error('Error:', error);
        })
        .finally(() => {
            // Ensure loading indicator is hidden
            if (analysisResults.style.display === 'none') {
                loadingIndicator.style.display = 'none';
            }
        });
    });

    // Process URL parameters on page load
    processUrlParams();
});
