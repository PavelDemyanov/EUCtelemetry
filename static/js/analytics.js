document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('uploadForm');
    const csvFileInput = document.getElementById('csvFile');
    const uploadButton = document.getElementById('uploadButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const errorMessage = document.getElementById('errorMessage');
    const analysisResults = document.getElementById('analysisResults');
    const dataColumnSelect = document.getElementById('dataColumn');
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
    
    // Function to create a new chart
    function createChart(labels, data, label) {
        if (chartInstance) {
            chartInstance.destroy();
        }
        
        const ctx = dataChart.getContext('2d');
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: label,
                    data: data,
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
                            text: label
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
                    }
                }
            }
        });
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
    
    // Function to populate the data column dropdown
    function populateColumnSelector(data) {
        // Clear existing options
        dataColumnSelect.innerHTML = '';
        
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
                dataColumnSelect.appendChild(option);
            }
        });
        
        // Trigger change event to load the first chart
        if (dataColumnSelect.options.length > 0) {
            dataColumnSelect.dispatchEvent(new Event('change'));
        }
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
    function populateDataInfoTable(data, csvType) {
        dataInfoTable.innerHTML = '';
        
        if (!data || data.length === 0) return;
        
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
            if (!data.success) {
                throw new Error(data.error || 'Error processing CSV file');
            }
            
            // Store CSV data
            try {
                csvData = JSON.parse(data.csv_data);
                const csvType = data.csv_type;
                console.log("Data loaded successfully:", csvType);
            } catch (error) {
                console.error("JSON parsing error:", error);
                throw new Error("Error parsing data from server");
            }
            
            // Populate column selector
            populateColumnSelector(csvData);
            
            // Populate data info table
            populateDataInfoTable(csvData, csvType);
            
            // Hide loading indicator and show results
            loadingIndicator.style.display = 'none';
            analysisResults.style.display = 'block';
        })
        .catch(error => {
            showError(error.message);
        });
    });
    
    // Event listener for column selection change
    dataColumnSelect.addEventListener('change', function() {
        if (!csvData) return;
        
        const selectedColumn = this.value;
        
        // Extract data for the selected column
        const timestamps = csvData.map(row => row.timestamp);
        const values = csvData.map(row => parseFloat(row[selectedColumn]) || 0);
        
        // Calculate statistics
        const stats = calculateStatistics(csvData.map(row => row[selectedColumn]));
        
        // Update statistics table
        populateStatisticsTable(selectedColumn, stats);
        
        // Create chart
        createChart(timestamps, values, selectedColumn);
    });
});