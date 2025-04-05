// Ожидаем полной загрузки DOM перед выполнением скрипта
document.addEventListener('DOMContentLoaded', function() {
    // Получаем элементы интерфейса из HTML
    const uploadForm = document.getElementById('uploadForm'); // Форма загрузки файла
    const csvFileInput = document.getElementById('csvFile'); // Поле ввода для CSV-файла
    const uploadButton = document.getElementById('uploadButton'); // Кнопка загрузки
    const loadingIndicator = document.getElementById('loadingIndicator'); // Индикатор загрузки
    const errorMessage = document.getElementById('errorMessage'); // Сообщение об ошибке
    const analysisResults = document.getElementById('analysisResults'); // Блок результатов анализа
    const dataChart = document.getElementById('dataChart'); // Канвас для графика
    const adaptiveChartToggle = document.getElementById('adaptiveChartToggle'); // Переключатель адаптивного масштаба
    const resetZoomButton = document.getElementById('resetZoomButton'); // Кнопка сброса масштаба

    // Инициализируем глобальные переменные
    let chartInstance = null; // Экземпляр графика Chart.js
    let csvData = null; // Данные из CSV-файла
    let isAdaptiveChart = true; // Флаг адаптивного масштабирования
    let isDragging = false; // Флаг состояния перетаскивания
    let dragStartX = 0; // Начальная позиция X при перетаскивании
    let chartStartMin = 0; // Начальное минимальное значение оси X
    let chartStartMax = 0; // Начальное максимальное значение оси X

    // Локализованные строки
    const translations = {
        en: {
            pleaseSelectCSV: "Please select a CSV file to upload.",
            pleaseUploadValidCSV: "Please upload a valid CSV file.",
            serverInvalidResponse: "Server returned an invalid response. The file might be too large to process.",
            csvProcessingError: "Error processing CSV",
            time: 'Time',
            values: 'Values'
        },
        ru: {
            pleaseSelectCSV: "Пожалуйста, выберите CSV-файл для загрузки.",
            pleaseUploadValidCSV: "Пожалуйста, загрузите действительный CSV-файл.",
            serverInvalidResponse: "Сервер вернул некорректный ответ. Возможно, файл слишком большой для обработки.",
            csvProcessingError: "Ошибка обработки CSV",
            time: 'Время',
            values: 'Значения'
        }
    };
    
    // Get current locale from HTML lang attribute
    const currentLocale = document.documentElement.lang || 'en';
    
    // Получение локализованного текста
    function getLocalizedText(key) {
        return translations[currentLocale]?.[key] || translations['en'][key];
    }
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

    // Функция для отображения сообщения об ошибке
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        loadingIndicator.style.display = 'none';
    }

    // Функция для скрытия сообщения об ошибке
    function hideError() {
        errorMessage.style.display = 'none';
    }

    // Форматирование меток оси X в виде времени (часы:минуты:секунды)
    function formatXAxisLabel(value) {
        if (value === undefined || value === null) return '';
        const date = new Date(value * 1000);
        if (isNaN(date.getTime())) return '';
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const secs = date.getUTCSeconds().toString().padStart(2, '0');
        return `${hours}:${minutes}:${secs}`;
    }

    // Форматирование времени для тултипа с миллисекундами и датой в формате DD.MM.YYYY
    function formatTooltipTimestamp(timestamp) {
        if (timestamp === undefined || timestamp === null) return 'Unknown';
        const date = new Date(timestamp * 1000);
        if (isNaN(date.getTime())) return 'Invalid time';
        const day = date.getUTCDate().toString().padStart(2, '0');
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        const year = date.getUTCFullYear();
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const secs = date.getUTCSeconds().toString().padStart(2, '0');
        const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
        return `${day}.${month}.${year} ${hours}:${minutes}:${secs}.${ms}`;
    }

    // Нормализация значений для адаптивного масштаба
    function normalizeValueForAdaptiveScale(value, columnName) {
        if (!isAdaptiveChart) return value;
        columnName = columnName.toLowerCase();
        if (columnName === 'power') return ((value + 6000) / 12000) * 100; // Нормализация мощности
        if (columnName === 'current') return ((value + 100) / 200) * 100; // Нормализация тока
        if (columnName === 'voltage') return ((value - 50) / (150 - 50)) * 100; // Нормализация напряжения
        return value;
    }

    // Палитра цветов для различных типов данных
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

    // Единицы измерения для тултипов (локализованные)
    const units = {
        en: {
            speed: 'km/h',
            gps: 'km/h',
            voltage: 'V',
            temperature: '°C',
            current: 'A',
            battery: '%',
            mileage: 'km',
            pwm: '%',
            power: 'W'
        },
        ru: {
            speed: 'км/ч',
            gps: 'км/ч',
            voltage: 'В',
            temperature: '°C',
            current: 'А',
            battery: '%',
            mileage: 'км',
            pwm: '%',
            power: 'Вт'
        }
    };
    
    // Get current locale from HTML lang attribute
    const currentLocale = document.documentElement.lang || 'en';
    function createMultiChart(labels, datasets) {
        if (chartInstance) chartInstance.destroy(); // Уничтожаем старый график, если он существует
        const ctx = dataChart.getContext('2d');
        const minTimestamp = Math.min(...labels); // Минимальное значение оси X
        const maxTimestamp = Math.max(...labels); // Максимальное значение оси X
        const fullRange = maxTimestamp - minTimestamp; // Полная длина оси X

        chartInstance = new Chart(ctx, {
            type: 'line', // Тип графика - линейный
            data: {
                labels: labels, // Метки оси X (временные метки)
                datasets: datasets.map((ds) => {
                    const columnName = ds.label.toLowerCase();
                    const color = colorPalette[columnName] || { borderColor: '#808080', backgroundColor: 'rgba(128, 128, 128, 0.2)' };
                    return {
                        label: ds.label, // Название набора данных
                        data: ds.data, // Нормализованные или исходные данные
                        borderColor: color.borderColor, // Цвет линии
                        backgroundColor: color.backgroundColor, // Цвет заливки
                        borderWidth: 2, // Толщина линии
                        fill: false, // Без заливки под линией
                        tension: 0.1, // Плавность линий
                        pointRadius: 0, // Радиус точек (0 - не видны)
                        pointHoverRadius: 3, // Радиус точек при наведении
                        originalData: ds.originalData, // Исходные данные для тултипов
                        pointStyle: 'rectRounded' // Скругленные края для маркеров в тултипе
                    };
                })
            },
            options: {
                responsive: true, // График адаптируется к размеру контейнера
                maintainAspectRatio: false, // Отключаем фиксированное соотношение сторон
                scales: {
                    x: {
                        type: 'linear', // Линейная шкала для оси X
                        min: minTimestamp, // Начало оси X
                        max: maxTimestamp, // Конец оси X
                        title: { display: true, text: getLocalizedText('time'), color: '#fff' }, // Заголовок оси
                        ticks: { 
                            callback: formatXAxisLabel, // Форматирование меток
                            color: '#fff', // Цвет текста
                            maxTicksLimit: 20, // Максимальное количество меток
                            autoSkip: true // Автоматический пропуск меток
                        },
                        grid: { display: false } // Отключаем сетку
                    },
                    y: {
                        title: { display: true, text: getLocalizedText('values'), color: '#fff' }, // Заголовок оси Y
                        ticks: { color: '#fff' }, // Цвет текста меток
                        grid: { display: false }, // Отключаем сетку
                        beginAtZero: false // Не начинаем ось с нуля
                    }
                },
                plugins: {
                    tooltip: {
                        enabled: true, // Включаем тултипы
                        mode: 'index', // Показываем данные для всех линий по текущей позиции
                        intersect: false, // Тултип показывается без пересечения с точкой
                        usePointStyle: true, // Используем стиль точек для маркеров
                        callbacks: {
                            // Форматируем заголовок тултипа (время)
                            title: (tooltipItems) => tooltipItems.length > 0 ? formatTooltipTimestamp(tooltipItems[0].parsed.x) : '',
                            // Форматируем текст тултипа (значение и единицы измерения)
                            label: (context) => {
                                const dataset = context.dataset;
                                const index = context.dataIndex;
                                let value = dataset.originalData[index];
                                value = (typeof value === 'number' && !isNaN(value)) ? Math.round(value).toString() : '—';
                                const unit = units[currentLocale]?.[dataset.label.toLowerCase()] || '';
                                return `${dataset.label}: \u200B${value} ${unit}`;
                            },
                            // Настраиваем цвет маркера в тултипе
                            labelColor: (tooltipItem) => {
                                const dataset = chartInstance.data.datasets[tooltipItem.datasetIndex];
                                return {
                                    borderColor: dataset.borderColor,
                                    backgroundColor: dataset.borderColor // Сплошной цвет без обводки
                                };
                            }
                        },
                        backgroundColor: 'rgba(0, 0, 0, 0.9)', // Цвет фона тултипа
                        titleFont: { size: 14, weight: 'bold' }, // Шрифт заголовка
                        bodyFont: { size: 14, weight: 'bold' }, // Шрифт текста
                        padding: 12 // Отступ внутри тултипа
                    },
                    crosshair: {
                        line: { color: 'rgba(255, 255, 255, 0.5)', width: 1, dashPattern: [5, 5] } // Настройки линии перекрестия
                    },
                    legend: {
                        display: true, // Включаем легенду
                        position: 'top', // Расположение легенды
                        labels: {
                            color: '#fff', // Цвет текста
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
                            // Переключение видимости наборов данных при клике на легенду
                            const index = legendItem.index;
                            const meta = chartInstance.getDatasetMeta(index);
                            meta.hidden = !meta.hidden;
                            chartInstance.update();
                        }
                    },
                    zoom: {
                        pan: {
                            enabled: true, // Включаем панорамирование
                            mode: 'x', // Панорамирование по оси X
                            rangeMin: { x: minTimestamp }, // Ограничение панорамирования
                            rangeMax: { x: maxTimestamp }
                        },
                        zoom: {
                            wheel: { enabled: true }, // Масштабирование колесиком мыши
                            pinch: { enabled: true }, // Масштабирование жестами
                            mode: 'x', // Масштабирование по оси X
                            limits: {
                                x: {
                                    min: minTimestamp, // Минимальный предел оси X
                                    max: maxTimestamp, // Максимальный предел оси X
                                    minRange: fullRange // Минимальный видимый диапазон (не меньше полной оси X)
                                }
                            }
                        }
                    }
                },
                interaction: { mode: 'index', intersect: false } // Режим взаимодействия для тултипов
            }
        });
    }

    // Функция для построения графика на основе всех столбцов данных
    function plotAllColumns(data) {
        if (!data) return;
        const timestamps = data.map(row => row.timestamp); // Извлекаем временные метки
        const columns = Object.keys(data[0]).filter(col => col.toLowerCase() !== 'timestamp' && data.some(row => !isNaN(parseFloat(row[col]))));
        const datasets = columns.map((column) => {
            const originalValues = data.map(row => parseFloat(row[column]) || 0); // Исходные значения
            const normalizedValues = originalValues.map(value => normalizeValueForAdaptiveScale(value, column)); // Нормализованные значения
            return {
                label: column,
                data: isAdaptiveChart ? normalizedValues : originalValues, // Выбираем данные в зависимости от режима
                originalData: originalValues // Сохраняем исходные данные для тултипов
            };
        });
        createMultiChart(timestamps, datasets); // Создаем график
        setupManualPanning(); // Настраиваем ручное панорамирование
    }

    // Настройка ручного панорамирования графика
    function setupManualPanning() {
        const canvas = dataChart;
        if (!canvas) return;
        canvas.style.cursor = 'grab'; // Курсор в виде руки
        canvas.addEventListener('mousedown', (e) => {
            if (!chartInstance) return;
            isDragging = true;
            dragStartX = e.clientX;
            chartStartMin = chartInstance.scales.x.min;
            chartStartMax = chartInstance.scales.x.max;
            canvas.style.cursor = 'grabbing'; // Курсор при перетаскивании
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging || !chartInstance) return;
            const deltaX = e.clientX - dragStartX; // Смещение по X
            const rangeX = chartStartMax - chartStartMin; // Диапазон оси X
            const pixelPerValue = canvas.width / rangeX; // Пикселей на единицу значения
            const valueShift = -deltaX / pixelPerValue; // Смещение значений
            chartInstance.options.scales.x.min = chartStartMin + valueShift;
            chartInstance.options.scales.x.max = chartStartMax + valueShift;
            chartInstance.update('none'); // Обновляем график без анимации
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

    // Обработка отправки формы с CSV-файлом
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        if (!csvFileInput.files || csvFileInput.files.length === 0) {
            showError(getLocalizedText('pleaseSelectCSV'));
            return;
        }
        const file = csvFileInput.files[0];
        if (!file.name.toLowerCase().endsWith('.csv')) {
            showError(getLocalizedText('pleaseUploadValidCSV'));
            return;
        }
        hideError();
        loadingIndicator.style.display = 'block'; // Показываем индикатор загрузки
        analysisResults.style.display = 'none'; // Скрываем результаты
        const formData = new FormData();
        formData.append('file', file);
        fetch('/analyze_csv', { // Отправляем файл на сервер
            method: 'POST',
            body: formData
        })
        .then(response => {
            // Check if response is JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error(getLocalizedText('serverInvalidResponse'));
            }
            return response.json();
        })
        .then(data => {
            if (!data.success) throw new Error(data.error || getLocalizedText('csvProcessingError'));
            csvData = JSON.parse(data.csv_data); // Парсим данные из ответа сервера
            window.csvType = data.csv_type;
            plotAllColumns(csvData); // Строим график
            loadingIndicator.style.display = 'none'; // Скрываем индикатор
            analysisResults.style.display = 'block'; // Показываем результаты
        })
        .catch(error => showError(error.message)); // Обрабатываем ошибки
    });

    // Обработка кнопки сброса масштаба
    if (resetZoomButton) {
        resetZoomButton.addEventListener('click', () => {
            if (chartInstance) {
                delete chartInstance.options.scales.x.min; // Удаляем пользовательские пределы
                delete chartInstance.options.scales.x.max;
                chartInstance.update(); // Обновляем график
            }
        });
    }

    // Обработка переключателя адаптивного графика
    if (adaptiveChartToggle) {
        adaptiveChartToggle.checked = isAdaptiveChart;
        adaptiveChartToggle.addEventListener('change', () => {
            isAdaptiveChart = adaptiveChartToggle.checked; // Обновляем флаг
            if (csvData) plotAllColumns(csvData); // Перестраиваем график
        });
    }
});