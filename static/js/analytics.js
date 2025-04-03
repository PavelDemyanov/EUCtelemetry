document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('uploadForm');
    const csvFileInput = document.getElementById('csvFile');
    const uploadButton = document.getElementById('uploadButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const errorMessage = document.getElementById('errorMessage');
    const analysisResults = document.getElementById('analysisResults');
    const dataChart = document.getElementById('dataChart');
    const adaptiveChartToggle = document.getElementById('adaptiveChartToggle');
    const resetZoomButton = document.getElementById('resetZoomButton');

    let chartInstance = null;
    let csvData = null;
    let isAdaptiveChart = true;
    let isDragging = false;
    let dragStartX = 0;
    let chartStartMin = 0;
    let chartStartMax = 0;

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

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        loadingIndicator.style.display = 'none';
    }

    function hideError() {
        errorMessage.style.display = 'none';
    }

    function formatXAxisLabel(value) {
        if (value === undefined || value === null) return '';
        const date = new Date(value * 1000);
        if (isNaN(date.getTime())) return '';
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const secs = date.getUTCSeconds().toString().padStart(2, '0');
        return `${hours}:${minutes}:${secs}`;
    }

    function formatTooltipTimestamp(timestamp) {
        if (timestamp === undefined || timestamp === null) return 'Unknown';
        const date = new Date(timestamp * 1000);
        if (isNaN(date.getTime())) return 'Invalid time';
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const secs = date.getUTCSeconds().toString().padStart(2, '0');
        const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
        return `${hours}:${minutes}:${secs}.${ms}`;
    }

    function normalizeValueForAdaptiveScale(value, columnName) {
        if (!isAdaptiveChart) return value;
        columnName = columnName.toLowerCase();
        if (columnName === 'power') return ((value + 6000) / 12000) * 100;
        if (columnName === 'current') return ((value + 100) / 200) * 100;
        if (columnName === 'voltage') return ((value - 50) / (150 - 50)) * 100;
        return value;
    }

    const colorPalette = {
        speed: { borderColor: '#0000FF', backgroundColor: 'rgba(0, 0, 255, 0.2)' },    // Синий
        gps: { borderColor: '#00daff', backgroundColor: 'rgba(255, 165, 0, 0.2)' },    // Голубой
        voltage: { borderColor: '#800080', backgroundColor: 'rgba(128, 0, 128, 0.2)' }, // Темно-фиолетовый
        temperature: { borderColor: '#FF00FF', backgroundColor: 'rgba(255, 0, 255, 0.2)' }, // Ярко-розовый
        current: { borderColor: '#FFFF00', backgroundColor: 'rgba(255, 255, 0, 0.2)' }, // Желтый
        battery: { borderColor: '#008000', backgroundColor: 'rgba(0, 128, 0, 0.2)' },  // Зеленый
        mileage: { borderColor: '#FF8C00', backgroundColor: 'rgba(255, 140, 0, 0.2)' }, // Светло-оранжевый
        pwm: { borderColor: '#FF0000', backgroundColor: 'rgba(255, 0, 0, 0.2)' },      // Красный
        power: { borderColor: '#ed5165', backgroundColor: 'rgba(199, 21, 133, 0.2)' }  // бирюбзовый
    };

    function createMultiChart(labels, datasets) {
        if (chartInstance) chartInstance.destroy();
        const ctx = dataChart.getContext('2d');
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets.map((ds) => {
                    const columnName = ds.label.toLowerCase();
                    const color = colorPalette[columnName] || { borderColor: '#808080', backgroundColor: 'rgba(128, 128, 128, 0.2)' }; // Серый для неизвестных
                    return {
                        label: ds.label,
                        data: ds.data,
                        borderColor: color.borderColor,
                        backgroundColor: color.backgroundColor,
                        borderWidth: 2,
                        fill: false,
                        tension: 0.1,
                        pointRadius: 0,
                        pointHoverRadius: 3,
                        originalData: ds.originalData
                    };
                })
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: { display: true, text: 'Время', color: '#fff' },
                        ticks: { callback: formatXAxisLabel, color: '#fff', maxTicksLimit: 20, autoSkip: true },
                        grid: { display: false }
                    },
                    y: {
                        title: { display: true, text: 'Значения', color: '#fff' },
                        ticks: { color: '#fff' },
                        grid: { display: false },
                        beginAtZero: false
                    }
                },
                plugins: {
                    tooltip: {
                        enabled: true,
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            title: (tooltipItems) => tooltipItems.length > 0 ? formatTooltipTimestamp(tooltipItems[0].parsed.x) : '',
                            label: (context) => {
                                const dataset = context.dataset;
                                const index = context.dataIndex;
                                let value = dataset.originalData[index];
                                value = (typeof value === 'number' && !isNaN(value)) ? value.toFixed(2) : '—';
                                return `${dataset.label}: ${value}`;
                            }
                        },
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleFont: { size: 12, weight: 'bold' },
                        bodyFont: { size: 12 },
                        padding: 8
                    },
                    crosshair: {
                        line: { color: 'rgba(255, 255, 255, 0.5)', width: 1, dashPattern: [5, 5] }
                    },
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#fff',
                            generateLabels: (chart) => {
                                const datasets = chart.data.datasets;
                                return datasets.map((dataset, i) => {
                                    const meta = chart.getDatasetMeta(i);
                                    const isHidden = meta.hidden;
                                    return {
                                        text: dataset.label,
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
                            const index = legendItem.index;
                            const meta = chartInstance.getDatasetMeta(index);
                            meta.hidden = !meta.hidden;
                            chartInstance.update();
                        }
                    },
                    zoom: {
                        pan: { enabled: false },
                        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, drag: { enabled: false }, mode: 'x' }
                    }
                },
                interaction: { mode: 'index', intersect: false }
            }
        });
    }

    function plotAllColumns(data) {
        if (!data) return;
        const timestamps = data.map(row => row.timestamp);
        const columns = Object.keys(data[0]).filter(col => col.toLowerCase() !== 'timestamp' && data.some(row => !isNaN(parseFloat(row[col]))));
        const datasets = columns.map((column) => {
            const originalValues = data.map(row => parseFloat(row[column]) || 0);
            const normalizedValues = originalValues.map(value => normalizeValueForAdaptiveScale(value, column));
            return {
                label: column,
                data: isAdaptiveChart ? normalizedValues : originalValues,
                originalData: originalValues
            };
        });
        createMultiChart(timestamps, datasets);
        setupManualPanning();
    }

    function setupManualPanning() {
        const canvas = dataChart;
        if (!canvas) return;
        canvas.style.cursor = 'grab';
        canvas.addEventListener('mousedown', (e) => {
            if (!chartInstance) return;
            isDragging = true;
            dragStartX = e.clientX;
            chartStartMin = chartInstance.scales.x.min;
            chartStartMax = chartInstance.scales.x.max;
            canvas.style.cursor = 'grabbing';
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging || !chartInstance) return;
            const deltaX = e.clientX - dragStartX;
            const rangeX = chartStartMax - chartStartMin;
            const pixelPerValue = canvas.width / rangeX;
            const valueShift = -deltaX / pixelPerValue;
            chartInstance.options.scales.x.min = chartStartMin + valueShift;
            chartInstance.options.scales.x.max = chartStartMax + valueShift;
            chartInstance.update('none');
        });
        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                canvas.style.cursor = 'grab';
            }
        });
        window.addEventListener('mouseleave', () => {
            if (isDragging) {
                isDragging = false;
                canvas.style.cursor = 'grab';
            }
        });
    }

    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        if (!csvFileInput.files || csvFileInput.files.length === 0) {
            showError('Пожалуйста, выберите CSV-файл для загрузки.');
            return;
        }
        const file = csvFileInput.files[0];
        if (!file.name.toLowerCase().endsWith('.csv')) {
            showError('Пожалуйста, загрузите действительный CSV-файл.');
            return;
        }
        hideError();
        loadingIndicator.style.display = 'block';
        analysisResults.style.display = 'none';
        const formData = new FormData();
        formData.append('file', file);
        fetch('/analyze_csv', {
            method: 'POST',
            body: formData
        })
        .then(response => response.ok ? response.json() : response.json().then(data => { throw new Error(data.error || 'Ошибка обработки CSV'); }))
        .then(data => {
            if (!data.success) throw new Error(data.error || 'Ошибка обработки CSV');
            csvData = JSON.parse(data.csv_data);
            window.csvType = data.csv_type;
            plotAllColumns(csvData);
            loadingIndicator.style.display = 'none';
            analysisResults.style.display = 'block';
        })
        .catch(error => showError(error.message));
    });

    if (resetZoomButton) {
        resetZoomButton.addEventListener('click', () => {
            if (chartInstance) {
                delete chartInstance.options.scales.x.min;
                delete chartInstance.options.scales.x.max;
                chartInstance.update();
            }
        });
    }

    if (adaptiveChartToggle) {
        adaptiveChartToggle.checked = isAdaptiveChart;
        adaptiveChartToggle.addEventListener('change', () => {
            isAdaptiveChart = adaptiveChartToggle.checked;
            if (csvData) plotAllColumns(csvData);
        });
    }
});