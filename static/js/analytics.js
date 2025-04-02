document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('uploadForm');
    const csvFileInput = document.getElementById('csvFile');
    const uploadButton = document.getElementById('uploadButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const errorMessage = document.getElementById('errorMessage');
    const analysisResults = document.getElementById('analysisResults');
    const dataColumnsSelect = document.getElementById('dataColumns');
    const plotButton = document.getElementById('plotButton');
    const clearButton = document.getElementById('clearButton');
    const dataChart = document.getElementById('dataChart');
    const statisticsTable = document.getElementById('statisticsTable');
    const dataInfoTable = document.getElementById('dataInfoTable');
    
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
                    tension: 0.1
                }))
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Time'
                        },
                        ticks: {
                            maxTicksLimit: 20
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Values'
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
                        position: 'top'
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
    
    // Function to populate the data columns select
    function populateColumnSelector(data) {
        // Clear existing options
        dataColumnsSelect.innerHTML = '';
        
        // Get the columns from the data
        const columns = Object.keys(data[0]);
        
        // Create options for numeric columns
        columns.forEach(column => {
            if (column.toLowerCase() === 'timestamp') return; // Skip timestamp column
            
            // Check if column has numeric data
            const hasNumericData = data.some(row => {
                const val = parseFloat(row[column]);
                return !isNaN(val);
            });
            
            if (hasNumericData) {
                const option = document.createElement('option');
                option.value = column;
                option.textContent = column;
                dataColumnsSelect.appendChild(option);
            }
        });
        
        // Select the first option by default
        if (dataColumnsSelect.options.length > 0) {
            dataColumnsSelect.options[0].selected = true;
            
            // Plot the first column
            plotSelectedColumns();
        }
    }
    
    // Function to plot selected columns
    function plotSelectedColumns() {
        if (!csvData) return;
        
        // Get selected columns
        const selectedOptions = Array.from(dataColumnsSelect.selectedOptions);
        if (selectedOptions.length === 0) return;
        
        // Get timestamps for x-axis
        const timestamps = csvData.map(row => row.timestamp);
        
        // Create dataset for each selected column
        const datasets = selectedOptions.map(option => {
            const column = option.value;
            return {
                label: column,
                data: csvData.map(row => parseFloat(row[column]) || 0)
            };
        });
        
        // Update statistics for the first selected column
        if (selectedOptions.length > 0) {
            const firstColumn = selectedOptions[0].value;
            const stats = calculateStatistics(csvData.map(row => row[firstColumn]));
            populateStatisticsTable(firstColumn, stats);
        }
        
        // Create multi-line chart
        createMultiChart(timestamps, datasets);
    }
    
    // Function to populate statistics table
    function populateStatisticsTable(column, stats) {
        statisticsTable.innerHTML = '';
        
        if (!stats) return;
        
        const rows = [
            { label: 'Minimum', value: stats.min?.toFixed(2) || 'N/A' },
            { label: 'Maximum', value: stats.max?.toFixed(2) || 'N/A' },
            { label: 'Average', value: stats.avg?.toFixed(2) || 'N/A' },
            { label: 'Median', value: stats.median?.toFixed(2) || 'N/A' }
        ];
        
        rows.forEach(row => {
            const tr = document.createElement('tr');
            
            const tdLabel = document.createElement('td');
            tdLabel.textContent = row.label;
            tr.appendChild(tdLabel);
            
            const tdValue = document.createElement('td');
            tdValue.textContent = row.value;
            tr.appendChild(tdValue);
            
            statisticsTable.appendChild(tr);
        });
    }
    
    // Function to populate data info table
    function populateDataInfoTable(data, csvTypeParam) {
        dataInfoTable.innerHTML = '';
        
        if (!data || data.length === 0) return;
        
        // Use passed parameter or global variable
        const csvType = csvTypeParam || window.csvType;
        
        const startTime = formatTimestamp(data[0].timestamp);
        const endTime = formatTimestamp(data[data.length - 1].timestamp);
        const duration = (data[data.length - 1].timestamp - data[0].timestamp) / 60; // Minutes
        const dataPoints = data.length;
        
        const rows = [
            { label: 'CSV Type', value: csvType },
            { label: 'Start Time', value: startTime },
            { label: 'End Time', value: endTime },
            { label: 'Duration', value: `${duration.toFixed(2)} min` },
            { label: 'Data Points', value: dataPoints }
        ];
        
        rows.forEach(row => {
            const tr = document.createElement('tr');
            
            const tdLabel = document.createElement('td');
            tdLabel.textContent = row.label;
            tr.appendChild(tdLabel);
            
            const tdValue = document.createElement('td');
            tdValue.textContent = row.value;
            tr.appendChild(tdValue);
            
            dataInfoTable.appendChild(tr);
        });
    }
    
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
            
            // Populate column selector
            populateColumnSelector(csvData);
            
            // Populate data info table
            populateDataInfoTable(csvData, window.csvType);
            
            // Hide loading indicator and show results
            loadingIndicator.style.display = 'none';
            analysisResults.style.display = 'block';
        })
        .catch(error => {
            showError(error.message);
        });
    });
    
    // Event listener for Plot button
    plotButton.addEventListener('click', function() {
        plotSelectedColumns();
    });
    
    // Event listener for Clear Selection button
    clearButton.addEventListener('click', function() {
        // Deselect all options
        for (let i = 0; i < dataColumnsSelect.options.length; i++) {
            dataColumnsSelect.options[i].selected = false;
        }
        
        // Clear the chart
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
        
        // Clear statistics table
        statisticsTable.innerHTML = '';
    });
    
    // Event listener for columns selection change
    dataColumnsSelect.addEventListener('change', function() {
        // Don't automatically plot on change - user will use the Plot button
        // This improves performance when selecting multiple columns
    });
});