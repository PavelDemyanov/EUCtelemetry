document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('uploadForm');
    const csvFileInput = document.getElementById('csvFile');
    const uploadButton = document.getElementById('uploadButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const errorMessage = document.getElementById('errorMessage');
    const analysisResults = document.getElementById('analysisResults');
    const dataChart = document.getElementById('dataChart');
    
    let chartInstance = null;
    let csvData = null;
    
    // Function to show error message
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        loadingIndicator.style.display = 'none';
    }
    
    // Function to hide error message
    function hideError() {
        errorMessage.style.display = 'none';
    }
    
    // Function to format timestamps as HH:MM:SS
    function formatTimestamp(seconds) {
        const date = new Date(seconds * 1000);
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const secs = date.getUTCSeconds().toString().padStart(2, '0');
        return `${hours}:${minutes}:${secs}`;
    }
    
    // Function to format X-axis labels in human-readable format
    function formatXAxisLabel(value, index, values) {
        const date = new Date(value * 1000);
        
        // If we have many values, show fewer labels
        if (values.length > 20 && index % Math.ceil(values.length / 20) !== 0) {
            return '';
        }
        
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const secs = date.getUTCSeconds().toString().padStart(2, '0');
        return `${hours}:${minutes}:${secs}`;
    }
    
    // Color palette for multiple datasets
    const colorPalette = [
        { borderColor: 'rgba(75, 192, 192, 1)', backgroundColor: 'rgba(75, 192, 192, 0.2)' },  // Teal
        { borderColor: 'rgba(255, 99, 132, 1)', backgroundColor: 'rgba(255, 99, 132, 0.2)' },  // Red
        { borderColor: 'rgba(54, 162, 235, 1)', backgroundColor: 'rgba(54, 162, 235, 0.2)' },  // Blue
        { borderColor: 'rgba(255, 206, 86, 1)', backgroundColor: 'rgba(255, 206, 86, 0.2)' },  // Yellow
        { borderColor: 'rgba(153, 102, 255, 1)', backgroundColor: 'rgba(153, 102, 255, 0.2)' }, // Purple
        { borderColor: 'rgba(255, 159, 64, 1)', backgroundColor: 'rgba(255, 159, 64, 0.2)' },  // Orange
        { borderColor: 'rgba(76, 175, 80, 1)', backgroundColor: 'rgba(76, 175, 80, 0.2)' },    // Green
        { borderColor: 'rgba(244, 67, 54, 1)', backgroundColor: 'rgba(244, 67, 54, 0.2)' }     // Deep Red
    ];

    // Function to create a new chart with multiple datasets
    function createMultiChart(labels, datasets) {
        if (chartInstance) {
            chartInstance.destroy();
        }
        
        const ctx = dataChart.getContext('2d');
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets.map((ds, index) => ({
                    label: ds.label,
                    data: ds.data,
                    borderColor: colorPalette[index % colorPalette.length].borderColor,
                    backgroundColor: colorPalette[index % colorPalette.length].backgroundColor,
                    borderWidth: 2,
                    fill: false, // Set to false for multiple datasets to avoid overlapping
                    tension: 0.1,
                    pointRadius: 0, // Remove points on the line
                    pointHoverRadius: 3 // Show points only on hover
                }))
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Время',
                            color: '#fff'
                        },
                        ticks: {
                            callback: formatXAxisLabel,
                            color: '#fff'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Значения',
                            color: '#fff'
                        },
                        ticks: {
                            color: '#fff'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        beginAtZero: false
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                const index = context[0].dataIndex;
                                return formatTimestamp(labels[index]);
                            }
                        }
                    },
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#fff'
                        },
                        onClick: function(e, legendItem, legend) {
                            // Toggle visibility
                            const index = legendItem.datasetIndex;
                            const meta = chartInstance.getDatasetMeta(index);
                            meta.hidden = meta.hidden === null ? !chartInstance.data.datasets[index].hidden : null;
                            chartInstance.update();
                        }
                    },
                    zoom: {
                        pan: {
                            enabled: true,
                            mode: 'x',
                            threshold: 5,
                            onPanStart: function() {
                                const canvas = document.getElementById('dataChart');
                                if (canvas) canvas.style.cursor = 'grabbing';
                            },
                            onPanComplete: function() {
                                const canvas = document.getElementById('dataChart');
                                if (canvas) canvas.style.cursor = 'grab';
                            }
                        },
                        zoom: {
                            wheel: {
                                enabled: true
                            },
                            pinch: {
                                enabled: true
                            },
                            drag: {
                                enabled: false // Выключаем зум с помощью выделения области
                            },
                            mode: 'x',
                            onZoomComplete: function({chart}) {
                                chart.update('none');
                            }
                        }
                    }
                },
                interaction: {
                    mode: 'index',
                    intersect: false
                }
            }
        });
    }
    
    // Legacy function for backward compatibility
    function createChart(labels, data, label) {
        createMultiChart(labels, [{label: label, data: data}]);
    }
    
    // Function to calculate statistics
    function calculateStatistics(data) {
        if (!data || data.length === 0) return {};
        
        const numericData = data.filter(val => !isNaN(parseFloat(val)));
        if (numericData.length === 0) return {};
        
        const values = numericData.map(val => parseFloat(val));
        values.sort((a, b) => a - b);
        
        return {
            min: values[0],
            max: values[values.length - 1],
            avg: values.reduce((sum, val) => sum + val, 0) / values.length,
            median: values.length % 2 === 0 
                ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
                : values[Math.floor(values.length / 2)]
        };
    }
    
    // Function to plot all available columns
    function plotAllColumns(data) {
        if (!data) return;
        
        // Get timestamps for x-axis
        const timestamps = data.map(row => row.timestamp);
        
        // Get all numeric columns
        const columns = Object.keys(data[0]).filter(column => {
            if (column.toLowerCase() === 'timestamp') return false; // Skip timestamp column
            
            // Check if column has numeric data
            return data.some(row => {
                const val = parseFloat(row[column]);
                return !isNaN(val);
            });
        });
        
        // Create dataset for each column
        const datasets = columns.map(column => {
            return {
                label: column,
                data: data.map(row => parseFloat(row[column]) || 0)
            };
        });
        
        // Create multi-line chart
        createMultiChart(timestamps, datasets);
    }
    
    // Statistics functions removed as per requirements
    
    // Event listener for form submission
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Check if a file is selected
        if (!csvFileInput.files || csvFileInput.files.length === 0) {
            showError('Please select a CSV file to upload.');
            return;
        }
        
        const file = csvFileInput.files[0];
        
        // Check file extension
        if (!file.name.toLowerCase().endsWith('.csv')) {
            showError('Please upload a valid CSV file.');
            return;
        }
        
        // Hide error message and show loading indicator
        hideError();
        loadingIndicator.style.display = 'block';
        analysisResults.style.display = 'none';
        
        // Create form data
        const formData = new FormData();
        formData.append('file', file);
        
        // Send AJAX request
        fetch('/analyze_csv', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || 'Error processing CSV file');
                });
            }
            return response.json();
        })
        .then(data => {
            console.log("Response received:", data);
            
            if (!data.success) {
                throw new Error(data.error || 'Error processing CSV file');
            }
            
            // Store CSV data
            try {
                if (!data.csv_data) {
                    throw new Error("No CSV data returned from server");
                }
                
                console.log("Raw CSV data:", data.csv_data.substring(0, 100) + "...");
                csvData = JSON.parse(data.csv_data);
                // Store CSV type at global level
                window.csvType = data.csv_type;
                console.log("Data loaded successfully:", window.csvType);
                console.log("First record sample:", csvData.length > 0 ? JSON.stringify(csvData[0]) : "No records");
            } catch (error) {
                console.error("JSON parsing error:", error);
                throw new Error("Error parsing data from server: " + error.message);
            }
            
            // Plot all data columns
            plotAllColumns(csvData);
            
            // Hide loading indicator and show results
            loadingIndicator.style.display = 'none';
            analysisResults.style.display = 'block';
        })
        .catch(error => {
            showError(error.message);
        });
    });
    
    // Event listener for reset zoom button
    const resetZoomButton = document.getElementById('resetZoomButton');
    if (resetZoomButton) {
        resetZoomButton.addEventListener('click', function() {
            if (chartInstance) {
                chartInstance.resetZoom();
            }
        });
    }
});