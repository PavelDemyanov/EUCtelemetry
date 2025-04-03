document.addEventListener('DOMContentLoaded', function() {
    // DOM элементы
    const uploadForm = document.getElementById('uploadForm');
    const csvFileInput = document.getElementById('csvFile');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const analysisResults = document.getElementById('analysisResults');
    const errorContainer = document.getElementById('errorContainer');
    const adaptiveChartToggle = document.getElementById('adaptiveChartToggle');
    
    // Глобальные переменные
    let chartInstance = null;
    let csvData = null;
    let isAdaptiveChart = true; // По умолчанию адаптивный график включен
    let isDragging = false;
    let dragStartX = 0;
    let chartStartMin = 0;
    let chartStartMax = 0;
    
    // Функция отображения ошибки
    function showError(message) {
        errorContainer.textContent = message;
        errorContainer.style.display = 'block';
    }
    
    // Функция скрытия ошибки
    function hideError() {
        errorContainer.style.display = 'none';
    }
    
    // Функция форматирования временной метки (из секунд в читаемый формат)
    function formatTimestamp(seconds) {
        const date = new Date(seconds * 1000);
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const secs = date.getUTCSeconds().toString().padStart(2, '0');
        return `${hours}:${minutes}:${secs}`;
    }
    
    // Функция форматирования метки оси X
    function formatXAxisLabel(value, index, values) {
        // Форматируем timestamp в читаемое время
        return formatTimestamp(value);
    }
    
    // Функция форматирования временной метки для tooltip
    function formatTooltipTimestamp(timestamp) {
        return formatTimestamp(timestamp);
    }
    
    // Функция нормализации значений для адаптивного графика
    function normalizeValue(value, columnName) {
        // Если адаптивный график отключен или значение не числовое, возвращаем как есть
        if (!isAdaptiveChart || value === null || value === undefined || isNaN(value)) {
            return value;
        }
        
        // Приводим название колонки к нижнему регистру для проверки
        const colName = (columnName || '').toLowerCase();
        
        // Применяем нормализацию в зависимости от типа данных
        if (colName.includes('power')) {
            return value * 0.05; // Коэффициент для мощности
        } else if (colName.includes('current')) {
            return value * 1.0; // Коэффициент для тока
        } else if (colName.includes('voltage')) {
            return value * 0.1; // Коэффициент для напряжения
        }
        
        // Для других типов данных возвращаем исходное значение
        return value;
    }
    
    // Функция создания графика с множеством линий
    function createMultiChart(labels, datasets) {
        // Уничтожаем старый график, если он существует
        if (chartInstance) {
            chartInstance.destroy();
        }
        
        // Получаем контекст canvas
        const ctx = document.getElementById('dataChart').getContext('2d');
        
        // Создаем настроенные датасеты с цветами из палитры
        const configuredDatasets = datasets.map((dataset, index) => {
            const color = colorPalette[index % colorPalette.length];
            
            return {
                label: dataset.label,
                data: dataset.data,
                borderColor: color.borderColor,
                backgroundColor: color.backgroundColor,
                fill: false,
                tension: 0.1,
                pointRadius: 0, // Убираем точки на линии
                borderWidth: 2,
                // Сохраняем дополнительные данные для использования в tooltip
                rawData: dataset.rawData,
                columnName: dataset.label
            };
        });
        
        // Создаем новый график
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: configuredDatasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        grid: {
                            display: false // Убираем сетку
                        },
                        ticks: {
                            color: '#fff',
                            callback: formatXAxisLabel,
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 8 // Ограничиваем количество меток на оси X
                        }
                    },
                    y: {
                        grid: {
                            display: false // Убираем сетку
                        },
                        ticks: {
                            color: '#fff'
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        enabled: false, // Отключаем стандартный tooltip
                        external: function(context) {
                            // Элемент для пользовательского tooltip
                            let tooltipEl = document.getElementById('chartjs-tooltip');
                            
                            // Создаем элемент, если он не существует
                            if (!tooltipEl) {
                                tooltipEl = document.createElement('div');
                                tooltipEl.id = 'chartjs-tooltip';
                                tooltipEl.innerHTML = '<table></table>';
                                document.body.appendChild(tooltipEl);
                            }
                            
                            // Скрываем tooltip, если нет активных точек
                            const tooltipModel = context.tooltip;
                            if (tooltipModel.opacity === 0) {
                                tooltipEl.style.opacity = 0;
                                return;
                            }
                            
                            // Устанавливаем стили для tooltip
                            tooltipEl.classList.remove('above', 'below', 'no-transform');
                            tooltipEl.classList.add(tooltipModel.yAlign);
                            tooltipEl.style.opacity = 1;
                            tooltipEl.style.position = 'absolute';
                            tooltipEl.style.pointerEvents = 'none';
                            tooltipEl.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
                            tooltipEl.style.color = 'white';
                            tooltipEl.style.borderRadius = '3px';
                            tooltipEl.style.transition = 'all .1s ease';
                            tooltipEl.style.transform = 'translate(-50%, 0)';
                            tooltipEl.style.zIndex = '999';
                            
                            // Позиционируем tooltip относительно Canvas
                            const position = context.chart.canvas.getBoundingClientRect();
                            
                            // Функция получения содержимого tooltip
                            function getBody(bodyItem) {
                                return bodyItem.lines;
                            }
                            
                            // Если есть активные точки, создаем содержимое tooltip
                            if (tooltipModel.body) {
                                const titleLines = tooltipModel.title || [];
                                const bodyLines = tooltipModel.body.map(getBody);
                                
                                // Находим индекс в данных по временной метке
                                const timeStamp = tooltipModel.dataPoints[0].label;
                                
                                // Создаем DOM для tooltip
                                let innerHtml = '<thead>';
                                
                                // Добавляем заголовок с форматированным временем
                                innerHtml += '<tr><th style="text-align: center; padding: 5px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.3);">';
                                innerHtml += formatTooltipTimestamp(timeStamp);
                                innerHtml += '</th></tr></thead><tbody>';
                                
                                // Добавляем строки для каждого датасета
                                tooltipModel.dataPoints.forEach(function(item) {
                                    const dataset = context.chart.data.datasets[item.datasetIndex];
                                    
                                    // Получаем цвет из палитры для маркера
                                    const originalIndex = item.datasetIndex;
                                    const color = colorPalette[originalIndex % colorPalette.length].borderColor;
                                    
                                    // Индекс точки данных
                                    const dataIndex = context.tooltip.dataPoints[0].dataIndex;
                                    
                                    // Получаем оригинальное значение из rawData
                                    let rawValue = "—"; // Em dash по умолчанию
                                    
                                    if (dataset.rawData && dataset.rawData[dataIndex] !== undefined) {
                                        // Берем необработанное значение напрямую
                                        rawValue = dataset.rawData[dataIndex];
                                        
                                        // Если это число, форматируем его с 2 знаками после запятой
                                        const numValue = parseFloat(rawValue);
                                        if (!isNaN(numValue)) {
                                            rawValue = numValue.toFixed(2);
                                        }
                                    }
                                    
                                    // Стиль для цветового маркера
                                    let style = 'background:' + color;
                                    style += '; border: none';
                                    style += '; margin-right: 10px';
                                    style += '; display: inline-block';
                                    style += '; width: 10px; height: 10px';
                                    style += '; border-radius: 50%';
                                    const span = '<span style="' + style + '"></span>';
                                    
                                    // Строка с названием датасета и оригинальным значением
                                    const label = dataset.label || 'Unknown';
                                    innerHtml += '<tr><td style="padding: 3px 8px;">' + span + label + ': ' + rawValue + '</td></tr>';
                                });
                                
                                innerHtml += '</tbody>';
                                
                                const tableRoot = tooltipEl.querySelector('table');
                                tableRoot.innerHTML = innerHtml;
                            }
                            
                            // Позиционируем tooltip со смещением вправо на 30px
                            if (tooltipModel.caretX && tooltipModel.caretY) {
                                const caretX = tooltipModel.caretX + 30; // 30px смещение вправо
                                const caretY = tooltipModel.caretY;
                                
                                tooltipEl.style.left = position.left + window.pageXOffset + caretX + 'px';
                                tooltipEl.style.top = position.top + window.pageYOffset + caretY + 'px';
                                tooltipEl.style.padding = tooltipModel.options.padding + 'px ' + tooltipModel.options.padding + 'px';
                            }
                            
                            if (!document.body.contains(tooltipEl)) {
                                document.body.appendChild(tooltipEl);
                            }
                        }
                    },
                    // Вертикальная линия под курсором
                    crosshair: {
                        line: {
                            color: 'rgba(255, 255, 255, 0.5)',
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
                    // Настройки легенды
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#fff',
                            // Функция генерации стиля для элементов легенды
                            generateLabels: function(chart) {
                                const original = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                                
                                // Применяем стиль для каждого лейбла
                                original.forEach(label => {
                                    const meta = chart.getDatasetMeta(label.datasetIndex);
                                    if (meta.hidden) {
                                        // Затемняем неактивные элементы
                                        label.fillStyle = 'rgba(150, 150, 150, 0.5)';
                                        label.strokeStyle = 'rgba(150, 150, 150, 0.5)';
                                        label.fontColor = 'rgba(150, 150, 150, 0.5)';
                                    }
                                });
                                
                                return original;
                            }
                        },
                        onClick: function(e, legendItem, legend) {
                            const index = legendItem.datasetIndex;
                            const meta = chartInstance.getDatasetMeta(index);
                            meta.hidden = meta.hidden === null ? !chartInstance.data.datasets[index].hidden : null;
                            chartInstance.update();
                        }
                    },
                    // Настройки зума
                    zoom: {
                        pan: {
                            enabled: false // Используем свою реализацию перетаскивания
                        },
                        zoom: {
                            wheel: {
                                enabled: true
                            },
                            pinch: {
                                enabled: true
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
    
    // Цветовая палитра для датасетов
    const colorPalette = [
        { borderColor: 'rgba(75, 192, 192, 1)', backgroundColor: 'rgba(75, 192, 192, 0.2)' },  // Бирюзовый
        { borderColor: 'rgba(255, 99, 132, 1)', backgroundColor: 'rgba(255, 99, 132, 0.2)' },  // Красный
        { borderColor: 'rgba(54, 162, 235, 1)', backgroundColor: 'rgba(54, 162, 235, 0.2)' },  // Синий
        { borderColor: 'rgba(255, 206, 86, 1)', backgroundColor: 'rgba(255, 206, 86, 0.2)' },  // Желтый
        { borderColor: 'rgba(153, 102, 255, 1)', backgroundColor: 'rgba(153, 102, 255, 0.2)' }, // Фиолетовый
        { borderColor: 'rgba(255, 159, 64, 1)', backgroundColor: 'rgba(255, 159, 64, 0.2)' },  // Оранжевый
        { borderColor: 'rgba(40, 167, 69, 1)', backgroundColor: 'rgba(40, 167, 69, 0.2)' },    // Зеленый
        { borderColor: 'rgba(220, 53, 69, 1)', backgroundColor: 'rgba(220, 53, 69, 0.2)' },    // Темно-красный
        { borderColor: 'rgba(0, 123, 255, 1)', backgroundColor: 'rgba(0, 123, 255, 0.2)' },    // Темно-синий
        { borderColor: 'rgba(255, 193, 7, 1)', backgroundColor: 'rgba(255, 193, 7, 0.2)' }     // Янтарный
    ];
    
    // Функция отображения всех доступных столбцов данных
    function plotAllColumns(data) {
        if (!data || data.length === 0) return;
        
        // Получаем массив временных меток для оси X
        const timestamps = data.map(row => parseFloat(row.timestamp) || 0);
        
        // Получаем все числовые столбцы, кроме timestamp
        const columns = Object.keys(data[0]).filter(column => {
            if (column.toLowerCase() === 'timestamp') return false;
            
            // Проверяем, есть ли числовые данные в столбце
            return data.some(row => {
                const val = parseFloat(row[column]);
                return !isNaN(val);
            });
        });
        
        // Создаем датасеты для каждого столбца
        const datasets = columns.map(column => {
            // Массивы для хранения оригинальных и нормализованных значений
            const rawValues = [];
            const normalizedValues = [];
            
            // Обрабатываем каждую строку данных
            data.forEach(row => {
                // Получаем исходное значение
                const rawValue = row[column];
                
                // Добавляем исходное значение в массив для tooltip
                rawValues.push(rawValue);
                
                // Нормализуем числовое значение для отображения на графике
                const numValue = parseFloat(rawValue);
                if (!isNaN(numValue)) {
                    normalizedValues.push(normalizeValue(numValue, column));
                } else {
                    // Если значение не числовое, добавляем null для пропуска точки
                    normalizedValues.push(null);
                }
            });
            
            // Возвращаем настроенный датасет
            return {
                label: column,
                data: normalizedValues,
                rawData: rawValues,
                columnName: column
            };
        });
        
        // Создаем график со всеми датасетами
        createMultiChart(timestamps, datasets);
        
        // Настраиваем перетаскивание графика
        setupManualPanning();
    }
    
    // Функция настройки ручного перетаскивания графика
    function setupManualPanning() {
        const canvas = document.getElementById('dataChart');
        if (!canvas) return;
        
        // Устанавливаем стиль курсора
        canvas.style.cursor = 'grab';
        
        // Обработчик начала перетаскивания
        canvas.addEventListener('mousedown', function(e) {
            if (!chartInstance) return;
            
            // Проверяем, не кликнули ли по легенде
            const legendBox = chartInstance.legend.legendHitBoxes;
            const position = { x: e.offsetX, y: e.offsetY };
            
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
            
            // Предотвращаем выделение текста
            e.preventDefault();
        });
        
        // Обработчик перемещения мыши
        window.addEventListener('mousemove', function(e) {
            if (!isDragging || !chartInstance) return;
            
            // Вычисляем смещение
            const deltaX = e.clientX - dragStartX;
            
            // Преобразуем пиксели в значения оси X
            const rangeX = chartStartMax - chartStartMin;
            const pixelPerValue = canvas.width / rangeX;
            const valueShift = -deltaX / pixelPerValue;
            
            // Применяем смещение к границам видимой области
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
                }
            }
        });
        
        // Обработчик выхода мыши за пределы окна
        window.addEventListener('mouseleave', function() {
            if (isDragging) {
                isDragging = false;
                if (canvas) {
                    canvas.style.cursor = 'grab';
                }
            }
        });
    }
    
    // Обработчик отправки формы
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Проверяем, выбран ли файл
        if (!csvFileInput.files || csvFileInput.files.length === 0) {
            showError('Пожалуйста, выберите CSV файл для загрузки.');
            return;
        }
        
        const file = csvFileInput.files[0];
        
        // Проверяем расширение файла
        if (!file.name.toLowerCase().endsWith('.csv')) {
            showError('Пожалуйста, загрузите корректный CSV файл.');
            return;
        }
        
        // Скрываем сообщение об ошибке и показываем индикатор загрузки
        hideError();
        loadingIndicator.style.display = 'block';
        analysisResults.style.display = 'none';
        
        // Создаем объект FormData
        const formData = new FormData();
        formData.append('file', file);
        
        // Отправляем запрос на сервер
        fetch('/analyze_csv', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || 'Ошибка обработки CSV файла');
                });
            }
            return response.json();
        })
        .then(data => {
            console.log("Получен ответ:", data);
            
            if (!data.success) {
                throw new Error(data.error || 'Ошибка обработки CSV файла');
            }
            
            // Сохраняем данные из ответа
            try {
                if (!data.csv_data) {
                    throw new Error("Сервер не вернул данные CSV");
                }
                
                console.log("Сырые данные CSV:", data.csv_data.substring(0, 100) + "...");
                csvData = JSON.parse(data.csv_data);
                window.csvType = data.csv_type;
                
                console.log("Данные успешно загружены, тип:", window.csvType);
                console.log("Образец первой записи:", csvData.length > 0 ? JSON.stringify(csvData[0]) : "Нет записей");
            } catch (error) {
                console.error("Ошибка парсинга JSON:", error);
                throw new Error("Ошибка при обработке данных от сервера: " + error.message);
            }
            
            // Отображаем все столбцы данных на графике
            plotAllColumns(csvData);
            
            // Скрываем индикатор загрузки и показываем результаты
            loadingIndicator.style.display = 'none';
            analysisResults.style.display = 'block';
        })
        .catch(error => {
            showError(error.message);
            loadingIndicator.style.display = 'none';
        });
    });
    
    // Обработчик кнопки сброса зума
    const resetZoomButton = document.getElementById('resetZoomButton');
    if (resetZoomButton) {
        resetZoomButton.addEventListener('click', function() {
            if (chartInstance) {
                console.log("Сброс зума");
                
                // Удаляем ограничения осей
                if (chartInstance.options.scales.x) {
                    delete chartInstance.options.scales.x.min;
                    delete chartInstance.options.scales.x.max;
                }
                
                // Используем метод сброса зума из плагина, если доступен
                if (chartInstance.resetZoom) {
                    chartInstance.resetZoom();
                } else {
                    // Иначе просто обновляем график
                    chartInstance.update();
                }
            }
        });
    }
    
    // Обработчик переключателя адаптивного графика
    if (adaptiveChartToggle) {
        // Устанавливаем начальное значение
        adaptiveChartToggle.checked = isAdaptiveChart;
        
        adaptiveChartToggle.addEventListener('change', function() {
            // Обновляем глобальное состояние
            isAdaptiveChart = adaptiveChartToggle.checked;
            console.log("Режим адаптивного графика:", isAdaptiveChart ? "включен" : "выключен");
            
            // Перестраиваем график с учетом нового режима
            if (csvData) {
                plotAllColumns(csvData);
            }
        });
    }
});