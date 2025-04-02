document.addEventListener('DOMContentLoaded', function() {
    const analyticsForm = document.getElementById('analyticsForm');
    const processingStatus = document.getElementById('processingStatus');
    const resultsSection = document.getElementById('resultsSection');
    const processingMessage = document.getElementById('processingMessage');
    const csvTypeElement = document.getElementById('csvType');
    const timeRangeElement = document.getElementById('timeRange');
    const dataPointsElement = document.getElementById('dataPoints');
    const fileSizeElement = document.getElementById('fileSize');
    const dataSelectors = document.getElementById('dataSelectors');
    const chartCanvas = document.getElementById('dataChart');
    
    // Global chart instance
    let dataChart = null;
    
    // Global data storage
    let csvData = null;
    let availableColumns = [];
    let selectedColumns = [];
    
    // Format file size in KB or MB
    function formatFileSize(bytes) {
        if (bytes < 1024) {
            return bytes + ' B';
        } else if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(2) + ' KB';
        } else {
            return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        }
    }
    
    // Format timestamp as human-readable date
    function formatTimestamp(timestamp) {
        return new Date(timestamp * 1000).toLocaleString();
    }
    
    // Generate random color for chart datasets
    function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }
    
    // Create checkboxes for selecting data columns to display
    function createDataSelectors(columns) {
        dataSelectors.innerHTML = '';
        
        columns.forEach(column => {
            if (column === 'timestamp') return; // Skip timestamp column
            
            const checkboxId = `checkbox-${column}`;
            const div = document.createElement('div');
            div.className = 'form-check form-check-inline';
            
            const input = document.createElement('input');
            input.className = 'form-check-input';
            input.type = 'checkbox';
            input.id = checkboxId;
            input.value = column;
            input.checked = selectedColumns.includes(column);
            input.addEventListener('change', function() {
                if (this.checked) {
                    selectedColumns.push(column);
                } else {
                    const index = selectedColumns.indexOf(column);
                    if (index > -1) {
                        selectedColumns.splice(index, 1);
                    }
                }
                updateChart();
            });
            
            const label = document.createElement('label');
            label.className = 'form-check-label btn btn-sm btn-outline-primary ms-1';
            label.htmlFor = checkboxId;
            label.textContent = column.charAt(0).toUpperCase() + column.slice(1); // Capitalize
            
            div.appendChild(input);
            div.appendChild(label);
            dataSelectors.appendChild(div);
        });
    }
    
    // Update or create the chart based on selected columns
    function updateChart() {
        const ctx = chartCanvas.getContext('2d');
        
        // Prepare datasets for the chart
        const datasets = selectedColumns.map(column => {
            const color = getRandomColor();
            return {
                label: column.charAt(0).toUpperCase() + column.slice(1), // Capitalize
                data: csvData[column],
                borderColor: color,
                backgroundColor: color + '20', // Add transparency
                tension: 0.4,
                fill: false,
                pointRadius: 0, // Hide points
                pointHoverRadius: 5 // Show on hover
            };
        });
        
        // Prepare labels (time)
        const labels = csvData.timestamp.map(ts => new Date(ts * 1000).toLocaleTimeString());
        
        // Destroy existing chart if it exists
        if (dataChart) {
            dataChart.destroy();
        }
        
        // Create new chart
        dataChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'start',
                        labels: {
                            boxWidth: 12,
                            boxHeight: 12,
                            padding: 10
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                const index = context[0].dataIndex;
                                return formatTimestamp(csvData.timestamp[index]);
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
                                return index % Math.ceil(labels.length / 10) === 0 ? 
                                    this.getLabelForValue(val) : '';
                            }
                        }
                    },
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }
    
    // Handle form submission
    analyticsForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Show processing status, hide results
        processingStatus.classList.remove('d-none');
        resultsSection.classList.add('d-none');
        processingMessage.textContent = gettext('Processing CSV file...');
        
        // Disable form
        analyticsForm.querySelectorAll('input, button').forEach(el => el.disabled = true);
        
        // Get form data
        const formData = new FormData(analyticsForm);
        
        // Add file size info
        const fileInput = document.getElementById('csvFile');
        const fileSize = fileInput.files[0].size;
        fileSizeElement.textContent = formatFileSize(fileSize);
        
        // Send the file for processing
        fetch('/analyze_csv', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) throw new Error(gettext('Upload failed'));
            return response.json();
        })
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            // Store the data
            csvData = data.csv_data;
            availableColumns = Object.keys(csvData);
            
            // Set initial selected columns (choose 2-3 important ones)
            selectedColumns = ['speed'];
            if (availableColumns.includes('pwm')) selectedColumns.push('pwm');
            if (availableColumns.includes('power')) selectedColumns.push('power');
            
            // Update UI
            csvTypeElement.textContent = data.csv_type.toUpperCase();
            timeRangeElement.textContent = `${formatTimestamp(csvData.timestamp[0])} - ${formatTimestamp(csvData.timestamp[csvData.timestamp.length - 1])}`;
            dataPointsElement.textContent = csvData.timestamp.length;
            
            // Create selectors
            createDataSelectors(availableColumns);
            
            // Create chart
            updateChart();
            
            // Hide processing, show results
            processingStatus.classList.add('d-none');
            resultsSection.classList.remove('d-none');
            
            // Re-enable form
            analyticsForm.querySelectorAll('input, button').forEach(el => el.disabled = false);
        })
        .catch(error => {
            console.error('Error:', error);
            processingMessage.textContent = gettext('Error: ') + error.message;
            analyticsForm.querySelectorAll('input, button').forEach(el => el.disabled = false);
        });
    });
});