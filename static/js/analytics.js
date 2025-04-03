document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('uploadForm');
    const csvFileInput = document.getElementById('csvFile');
    const uploadButton = document.getElementById('uploadButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const errorMessage = document.getElementById('errorMessage');
    const analysisResults = document.getElementById('analysisResults');
    const dataChart = document.getElementById('dataChart');
    const adaptiveChartToggle = document.getElementById('adaptiveChartToggle');
    
    let chartInstance = null;
    let csvData = null;
    let isAdaptiveChart = true; // По умолчанию адаптивный график включен
    
    // Переменные для собственной реализации перетаскивания
    let isDragging = false;
    let dragStartX = 0;
    let chartStartMin = 0;
    let chartStartMax = 0;
    
    // Создаем и регистрируем плагин для вертикальной линии под курсором
    const crosshairPlugin = {
        id: 'crosshair',
        afterDraw: (chart, args, options) => {
            if (!chart.tooltip._active || !chart.tooltip._active.length) return;
            
            const activePoint = chart.tooltip._active[0];
            const ctx = chart.ctx;
            const x = activePoint.element.x;
            const topY = chart.scales.y.top;
            const bottomY = chart.scales.y.bottom;
            
            // Рисуем вертикальную линию
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, topY);
            ctx.lineTo(x, bottomY);
            ctx.lineWidth = options.line?.width || 1;
            ctx.strokeStyle = options.line?.color || 'rgba(255, 255, 255, 0.5)';
            
            // Устанавливаем штриховую линию, если задан шаблон
            if (options.line?.dashPattern) {
                ctx.setLineDash(options.line.dashPattern);
            }
            
            ctx.stroke();
            ctx.restore();
        }
    };
    
    // Регистрируем плагин
    Chart.register(crosshairPlugin);
    
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
        // Проверяем, что value не пустое значение
        if (value === undefined || value === null) {
            return '';
        }

        const date = new Date(value * 1000);
        
        // Проверяем, что дата валидна
        if (isNaN(date.getTime())) {
            console.warn("Invalid timestamp value:", value);
            return '';
        }
        
        // Форматируем метку времени
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const secs = date.getUTCSeconds().toString().padStart(2, '0');
        return `${hours}:${minutes}:${secs}`;
    }
    
    // Функция для форматирования времени в человекочитаемом формате для tooltip
    function formatTooltipTimestamp(timestamp) {
        if (timestamp === undefined || timestamp === null) {
            return 'Unknown';
        }
        
        const date = new Date(timestamp * 1000);
        
        if (isNaN(date.getTime())) {
            return 'Invalid time';
        }
        
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const secs = date.getUTCSeconds().toString().padStart(2, '0');
        const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
        
        return `${hours}:${minutes}:${secs}.${ms}`;
    }
    
    // Функция для нормализации значений в адаптивном режиме
    function normalizeValueForAdaptiveScale(value, columnName) {
        if (!isAdaptiveChart) {
            return value; // Возвращаем исходное значение, если адаптивный режим выключен
        }
        
        // Нормализуем значения в зависимости от типа данных
        columnName = columnName.toLowerCase();
        
        if (columnName === 'power') {
            // Power: 6000 -> 100, -6000 -> 0, линейная шкала между ними
            return ((value + 6000) / 12000) * 100;
        } else if (columnName === 'current') {
            // Current: 100 -> 100, -100 -> 0, линейная шкала между ними
            return ((value + 100) / 200) * 100;
        } else if (columnName === 'voltage') {
            // Если точный минимум неизвестен, используем 50 как примерное минимальное значение
            // Voltage: 150 -> 100, минимум -> 0
            const minVoltage = 50; // Примерное минимальное значение
            return ((value - minVoltage) / (150 - minVoltage)) * 100;
        }
        
        // Для остальных столбцов возвращаем исходное значение
        return value;
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
        
        // Добавляем CSS стили для контроля курсора
        const styleId = 'chart-cursor-styles';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                /* Стиль для легенды - обычный курсор */
                .chartjs-legend-item,
                li.chartjs-legend-item,
                ul.chartjs-legend-ul li {
                    cursor: pointer !important;
                }
                
                /* Стиль для области графика - рука */
                #dataChart {
                    cursor: grab !important;
                }
                
                /* Стиль при активном перетаскивании */
                #dataChart.grabbing {
                    cursor: grabbing !important;
                }
            `;
            document.head.appendChild(style);
        }
        
        const ctx = dataChart.getContext('2d');
        // Создаем новый экземпляр Chart.js
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
                            color: '#fff',
                            maxTicksLimit: 20, // Фиксированное количество меток независимо от масштаба
                            autoSkip: true, // Включаем автоматический пропуск меток
                            autoSkipPadding: 20, // Добавляем отступ между метками
                            major: {
                                enabled: true
                            }
                        },
                        grid: {
                            display: false  // Убираем сетку на фоне графика
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
                            display: false  // Убираем сетку на фоне графика
                        },
                        beginAtZero: false
                    }
                },
                plugins: {
                    tooltip: {
                        enabled: false, // Отключаем встроенный tooltip, будем использовать только наш кастомный
                        callbacks: {
                            title: function(context) {
                                // Форматируем заголовок (время) в человекочитаемом формате
                                if (context[0] && context[0].parsed && context[0].parsed.x !== undefined) {
                                    return formatTooltipTimestamp(context[0].parsed.x);
                                }
                                return '';
                            },
                            label: function(context) {
                                // ВАЖНО: Этот callback не используется для отображения tooltip
                                // Мы полностью заменили его своей реализацией с доступом к исходным данным
                                // См. функцию external tooltip
                                return "";
                            }
                        },
                        external: function(context) {
                            // Получаем существующий или создаем новый tooltip
                            const tooltipEl = document.getElementById('chartjs-tooltip') || document.createElement('div');
                            tooltipEl.id = 'chartjs-tooltip';
                            
                            // Если нет активных элементов, скрываем tooltip и выходим
                            if (!context.tooltip._active || context.tooltip._active.length === 0) {
                                tooltipEl.style.opacity = 0;
                                return;
                            }
                            
                            tooltipEl.innerHTML = '<table></table>';
                            
                            // Применяем стили
                            const position = context.chart.canvas.getBoundingClientRect();
                            tooltipEl.style.background = 'rgba(0, 0, 0, 0.85)';
                            tooltipEl.style.borderRadius = '4px';
                            tooltipEl.style.color = 'white';
                            tooltipEl.style.opacity = 1;
                            tooltipEl.style.pointerEvents = 'none';
                            tooltipEl.style.position = 'absolute';
                            tooltipEl.style.transform = 'translate(0, 0)'; // Убираем смещение по горизонтали через transform
                            tooltipEl.style.transition = 'all .1s ease';
                            tooltipEl.style.boxShadow = '0 2px 5px rgba(0,0,0,0.5)';
                            tooltipEl.style.fontFamily = 'Arial, sans-serif';
                            tooltipEl.style.fontSize = '12px';
                            
                            const table = tooltipEl.querySelector('table');
                            table.style.margin = '0px';
                            table.style.borderCollapse = 'collapse';
                            table.style.width = '100%';
                            
                            // Заполняем содержимое
                            if (context.tooltip.body) {
                                const titleLines = context.tooltip.title || [];
                                const bodyLines = context.tooltip.body.map(b => b.lines);
                                
                                let innerHtml = '<thead>';
                                titleLines.forEach(title => {
                                    innerHtml += '<tr><th style="padding: 4px 8px; text-align: center; font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.2);">' + 
                                        title + '</th></tr>';
                                });
                                innerHtml += '</thead><tbody>';
                                
                                // Собираем все видимые датасеты для корректного отображения
                                const visibleDatasets = [];
                                chartInstance.data.datasets.forEach((dataset, index) => {
                                    const meta = chartInstance.getDatasetMeta(index);
                                    if (!meta.hidden) {
                                        visibleDatasets.push({
                                            dataset: dataset,
                                            index: index
                                        });
                                    }
                                });
                                
                                // Отображаем только видимые датасеты в правильном порядке их цветов и с оригинальными значениями
                                visibleDatasets.forEach((item, i) => {
                                    // Берем цвета напрямую из датасета, но учитываем только видимые датасеты
                                    const dataset = item.dataset;
                                    // Используем оригинальный индекс датасета для получения правильного цвета
                                    const originalIndex = item.index;
                                    const color = colorPalette[originalIndex % colorPalette.length].borderColor;
                                    
                                    // Получаем индекс точки данных для текущей позиции курсора
                                    const dataIndex = context.tooltip.dataPoints[0].dataIndex;
                                    let value;
                                    
                                    // Шаг 1: Пытаемся использовать новое поле rawData (содержит оригинальные строки)
                                    if (dataset.rawData && dataset.rawData[dataIndex] !== undefined) {
                                        const rawValue = dataset.rawData[dataIndex];
                                        // Если это строка с числом, преобразуем её для форматирования
                                        const numValue = parseFloat(rawValue);
                                        if (!isNaN(numValue)) {
                                            value = numValue.toFixed(2);
                                        } else {
                                            value = rawValue || "—"; // Em dash если значение отсутствует
                                        }
                                    }
                                    // Шаг 2: Пробуем старый подход с originalData
                                    else if (dataset.originalData && dataset.originalData[dataIndex] !== undefined) {
                                        const origValue = dataset.originalData[dataIndex];
                                        if (typeof origValue === 'number' && !isNaN(origValue)) {
                                            value = origValue.toFixed(2);
                                        } else {
                                            value = origValue || "—";
                                        }
                                    }
                                    // Шаг 3: Пытаемся получить значение напрямую из данных CSV
                                    else if (csvData && dataset.columnName) {
                                        const columnName = dataset.columnName;
                                        if (csvData[dataIndex] && csvData[dataIndex][columnName] !== undefined) {
                                            const csvValue = csvData[dataIndex][columnName];
                                            const numValue = parseFloat(csvValue);
                                            if (!isNaN(numValue)) {
                                                value = numValue.toFixed(2);
                                            } else {
                                                value = csvValue || "—";
                                            }
                                        } else {
                                            value = "—"; // Em dash если данные отсутствуют
                                        }
                                    }
                                    // Шаг 4: Последний вариант - берем текущее значение с графика
                                    else {
                                        const pointData = context.tooltip.dataPoints.find(p => p.datasetIndex === originalIndex);
                                        if (pointData && pointData.raw !== undefined) {
                                            const rawValue = pointData.raw;
                                            if (typeof rawValue === 'number' && !isNaN(rawValue)) {
                                                value = rawValue.toFixed(2);
                                            } else {
                                                value = rawValue || "—";
                                            }
                                        } else {
                                            value = "—"; // Em dash если ничего не найдено
                                        }
                                    }
                                    
                                    // Создаем стиль для цветового маркера
                                    let style = 'background:' + color;
                                    style += '; border: none'; // Убираем рамку, делая цвет сплошным
                                    style += '; margin-right: 10px';
                                    style += '; display: inline-block';
                                    style += '; width: 10px; height: 10px';
                                    style += '; border-radius: 50%'; // Делаем цветовые метки круглыми
                                    const span = '<span style="' + style + '"></span>';
                                    
                                    // Строка с названием датасета и оригинальным значением
                                    const label = dataset.label || 'Unknown';
                                    innerHtml += '<tr><td style="padding: 3px 8px;">' + span + label + ': ' + value + '</td></tr>';
                                });
                                
                                innerHtml += '</tbody>';
                                table.innerHTML = innerHtml;
                            }
                            
                            // Позиционируем tooltip со смещением вправо на 30px
                            if (context.tooltip.caretX && context.tooltip.caretY) {
                                const caretX = context.tooltip.caretX + 30; // Добавляем 30px смещение вправо
                                const caretY = context.tooltip.caretY;
                                
                                tooltipEl.style.left = position.left + window.pageXOffset + caretX + 'px';
                                tooltipEl.style.top = position.top + window.pageYOffset + caretY + 'px';
                                tooltipEl.style.padding = context.tooltip.options.padding + 'px ' + context.tooltip.options.padding + 'px';
                            }
                            
                            if (document.body.contains(tooltipEl) === false) {
                                document.body.appendChild(tooltipEl);
                            }
                        }
                    },
                    // Добавляем плагин для отображения вертикальной линии под курсором
                    crosshair: {
                        line: {
                            color: 'rgba(255, 255, 255, 0.5)',  // Полупрозрачная белая линия
                            width: 1,
                            dashPattern: [5, 5]
                        },
                        sync: {
                            enabled: true,
                            group: 1,
                            suppressTooltips: false
                        },
                        zoom: {
                            enabled: false
                        }
                    },
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#fff',
                            // Добавляем функцию генерации стиля текста для элементов легенды
                            generateLabels: function(chart) {
                                // Получаем стандартные лейблы
                                const original = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                                
                                // Применяем наш стиль к каждому лейблу
                                original.forEach(label => {
                                    const meta = chart.getDatasetMeta(label.datasetIndex);
                                    if (meta.hidden) {
                                        // Если график скрыт, делаем текст полупрозрачным
                                        label.fillStyle = 'rgba(150, 150, 150, 0.5)'; // Серый цвет для неактивных элементов
                                        label.strokeStyle = 'rgba(150, 150, 150, 0.5)';
                                        label.fontColor = 'rgba(150, 150, 150, 0.5)'; // Делаем текст тусклым
                                    }
                                });
                                
                                return original;
                            }
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
                            enabled: false  // Отключаем встроенное панорамирование в пользу нашей реализации
                        },
                        zoom: {
                            wheel: {
                                enabled: true  // Оставляем возможность зума колесиком мыши
                            },
                            pinch: {
                                enabled: true  // Оставляем возможность зума щипком на мобильных
                            },
                            drag: {
                                enabled: false
                            },
                            mode: 'x'
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
            // Создаем массивы исходных и нормализованных значений для каждого столбца
            const rawValues = [];
            const normalizedValues = [];
            
            // Для каждой строки в данных сохраняем и оригинальное, и нормализованное значение
            data.forEach(row => {
                // Получаем исходное значение как строку, чтобы сохранить точный формат
                const rawValueStr = row[column];
                // Сохраняем исходное значение как число для нормализации
                const rawValue = parseFloat(rawValueStr) || 0;
                // Применяем нормализацию для адаптивного графика
                const normalizedValue = normalizeValueForAdaptiveScale(rawValue, column);
                
                // Добавляем значения в соответствующие массивы
                rawValues.push(rawValueStr);
                normalizedValues.push(normalizedValue);
            });
            
            return {
                label: column,
                data: normalizedValues,
                // Сохраняем оригинальные строки исходных значений для отображения в tooltip
                rawData: rawValues,
                // Сохраняем исходные числовые значения
                originalData: data.map(row => parseFloat(row[column]) || 0),
                // Сохраняем название колонки для идентификации при нормализации
                columnName: column
            };
        });
        
        // Create multi-line chart
        createMultiChart(timestamps, datasets);
        
        // Добавляем обработчики событий для ручного перетаскивания
        setupManualPanning();
    }
    
    // Функция для настройки ручного перетаскивания графика
    function setupManualPanning() {
        const canvas = document.getElementById('dataChart');
        if (!canvas) return;
        
        // Находим элемент легенды, чтобы применить к нему другой стиль курсора
        const chartContainer = document.querySelector('.chart-container');
        let legendElement = null;
        
        if (chartContainer) {
            // Ищем элемент легенды внутри контейнера графика
            legendElement = chartContainer.querySelector('.chartjs-legend');
            
            // Если не нашли стандартную легенду, пробуем найти другим селектором
            if (!legendElement) {
                // Chart.js создает легенду внутри div.chartjs-legend-body или ul.chartjs-legend-ul
                legendElement = chartContainer.querySelector('.chartjs-legend-body, .chartjs-legend-ul');
            }
            
            // Если всё еще не нашли, используем все элементы li внутри контейнера
            if (!legendElement) {
                const legendItems = chartContainer.querySelectorAll('li');
                if (legendItems.length > 0) {
                    // Для каждого элемента легенды устанавливаем обычный курсор
                    legendItems.forEach(item => {
                        item.style.cursor = 'pointer';
                    });
                }
            } else {
                // Если нашли легенду как единый элемент, устанавливаем курсор для неё
                legendElement.style.cursor = 'default';
            }
        }
        
        // Устанавливаем начальный стиль курсора для области графика
        canvas.style.cursor = 'grab';
        
        // Обработчик начала перетаскивания
        canvas.addEventListener('mousedown', function(e) {
            if (!chartInstance) return;
            
            // Проверяем, что нажатие произошло в области графика, а не легенды
            const legendBox = chartInstance.legend.legendHitBoxes;
            const position = {
                x: e.offsetX, 
                y: e.offsetY
            };
            
            // Проверяем, кликнули ли мы по легенде
            let clickedOnLegend = false;
            for (let i = 0; i < legendBox.length; i++) {
                const box = legendBox[i];
                if (position.x >= box.left && 
                    position.x <= box.left + box.width &&
                    position.y >= box.top &&
                    position.y <= box.top + box.height) {
                    clickedOnLegend = true;
                    break;
                }
            }
            
            // Если клик по легенде, не начинаем перетаскивание
            if (clickedOnLegend) return;
            
            isDragging = true;
            dragStartX = e.clientX;
            chartStartMin = chartInstance.scales.x.min;
            chartStartMax = chartInstance.scales.x.max;
            
            canvas.style.cursor = 'grabbing';
            canvas.classList.add('grabbing'); // Добавляем класс для CSS селектора
            
            // Предотвращаем выделение текста при перетаскивании
            e.preventDefault();
        });
        
        // Обработчик перемещения мыши
        window.addEventListener('mousemove', function(e) {
            if (!isDragging || !chartInstance) return;
            
            // Вычисляем смещение в пикселях
            const deltaX = e.clientX - dragStartX;
            
            // Преобразуем пиксели в значения оси X
            const rangeX = chartStartMax - chartStartMin;
            const pixelPerValue = canvas.width / rangeX;
            const valueShift = -deltaX / pixelPerValue;
            
            // Применяем смещение к границам видимой области графика
            if (!chartInstance.options.scales.x) {
                chartInstance.options.scales.x = {};
            }
            
            chartInstance.options.scales.x.min = chartStartMin + valueShift;
            chartInstance.options.scales.x.max = chartStartMax + valueShift;
            
            // Обновляем график без анимации
            chartInstance.update('none');
        });
        
        // Обработчик окончания перетаскивания
        window.addEventListener('mouseup', function() {
            if (isDragging) {
                isDragging = false;
                if (canvas) {
                    canvas.style.cursor = 'grab';
                    canvas.classList.remove('grabbing'); // Удаляем класс при окончании перетаскивания
                }
            }
        });
        
        // Обработчик выхода мыши за пределы окна
        window.addEventListener('mouseleave', function() {
            if (isDragging) {
                isDragging = false;
                if (canvas) {
                    canvas.style.cursor = 'grab';
                    canvas.classList.remove('grabbing'); // Удаляем класс при выходе за пределы
                }
            }
        });
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
                console.log("Reset zoom button clicked");
                
                // Сбрасываем ограничения осей, чтобы показать все данные
                if (chartInstance.options.scales.x) {
                    delete chartInstance.options.scales.x.min;
                    delete chartInstance.options.scales.x.max;
                }
                
                // Сбрасываем зум через ChartJS Zoom Plugin
                if (chartInstance.resetZoom) {
                    console.log("Using chartInstance.resetZoom()");
                    chartInstance.resetZoom();
                } else {
                    console.log("Using standard chart update");
                    // Если нет плагина, просто обновляем график
                    chartInstance.update();
                }
                
                // Дополнительная проверка, что все ограничения сняты
                if (chartInstance.scales && chartInstance.scales.x) {
                    console.log("Current x-axis min:", chartInstance.scales.x.min);
                    console.log("Current x-axis max:", chartInstance.scales.x.max);
                }
            } else {
                console.warn("Chart instance not found");
            }
        });
    } else {
        console.warn("Reset zoom button not found");
    }
    
    // Event listener for adaptive chart toggle
    if (adaptiveChartToggle) {
        // Устанавливаем начальное значение переключателя (по умолчанию включен)
        adaptiveChartToggle.checked = isAdaptiveChart;
        
        adaptiveChartToggle.addEventListener('change', function() {
            // Обновляем глобальное состояние адаптивного графика
            isAdaptiveChart = adaptiveChartToggle.checked;
            console.log("Adaptive chart mode:", isAdaptiveChart ? "enabled" : "disabled");
            
            // Перестраиваем график с учетом нового режима, если данные уже загружены
            if (csvData) {
                plotAllColumns(csvData);
            }
        });
    } else {
        console.warn("Adaptive chart toggle not found");
    }
});