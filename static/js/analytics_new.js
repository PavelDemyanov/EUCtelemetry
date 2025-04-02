document.addEventListener('DOMContentLoaded', function() {
    // Элементы страницы
    const uploadForm = document.getElementById('uploadForm');
    const csvFileInput = document.getElementById('csvFile');
    const analysisResults = document.getElementById('analysisResults');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const errorMessageElement = document.getElementById('errorMessage');
    const resetZoomBtn = document.getElementById('resetZoomBtn');
    
    // Глобальные переменные
    let chartInstance = null;
    let csvData = null;
    let isDragging = false;
    let dragStartX = 0;
    let chartStartMin = 0;
    let chartStartMax = 0;
    
    // Вспомогательные функции для работы с ошибками
    function showError(message) {
        errorMessageElement.textContent = message;
        errorMessageElement.style.display = 'block';
        loadingIndicator.style.display = 'none';
    }
    
    function hideError() {
        errorMessageElement.style.display = 'none';
    }
    
    // Форматирование временной метки в удобный формат времени
    function formatTimestamp(seconds) {
        const totalSeconds = parseInt(seconds);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    
    // Форматирование меток оси X
    function formatXAxisLabel(value, index, values) {
        // Показываем метки только для равномерно распределенных точек, 
        // чтобы было примерно 20 меток на оси X
        if (values.length > 20) {
            const interval = Math.ceil(values.length / 20);
            if (index % interval !== 0) return '';
        }
        
        return formatTimestamp(value);
    }
    
    // Создание мульти-линейного графика с настройками
    function createMultiChart(labels, datasets) {
        const canvas = document.getElementById('dataChart');
        if (!canvas) return;
        
        // Генерируем случайные цвета для каждого набора данных
        const colors = [
            'rgba(75, 192, 192, 1)',    // бирюзовый
            'rgba(255, 99, 132, 1)',     // красный
            'rgba(54, 162, 235, 1)',     // синий
            'rgba(255, 206, 86, 1)',     // желтый
            'rgba(153, 102, 255, 1)',    // фиолетовый
            'rgba(255, 159, 64, 1)',     // оранжевый
            'rgba(46, 204, 113, 1)',     // зеленый
            'rgba(52, 73, 94, 1)',       // темно-серый
            'rgba(241, 196, 15, 1)',     // оливковый
            'rgba(142, 68, 173, 1)'      // пурпурный
        ];
        
        // Настраиваем данные и внешний вид для каждого набора данных
        for (let i = 0; i < datasets.length; i++) {
            const colorIndex = i % colors.length;
            datasets[i].borderColor = colors[colorIndex];
            datasets[i].backgroundColor = colors[colorIndex].replace('1)', '0.1)');
            datasets[i].borderWidth = 2;
            datasets[i].tension = 0.1;
            datasets[i].pointRadius = 0; // Убираем точки на линиях
            datasets[i].fill = false;
        }
        
        // Если уже есть график, уничтожаем его
        if (chartInstance) {
            chartInstance.destroy();
        }
        
        // Создаем новый график
        chartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                scales: {
                    x: {
                        ticks: {
                            color: '#fff',
                            callback: formatXAxisLabel
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    },
                    y: {
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
                        position: 'nearest',
                        mode: 'index',
                        intersect: false,
                        caretPadding: 15,
                        padding: 10,
                        callbacks: {
                            title: function(context) {
                                const index = context[0].dataIndex;
                                return formatTimestamp(labels[index]);
                            }
                        }
                    },
                    crosshair: {
                        line: {
                            color: 'rgba(255, 255, 255, 0.5)',
                            width: 1
                        },
                        sync: {
                            enabled: true
                        },
                        zoom: {
                            enabled: true
                        }
                    },
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#fff'
                        },
                        onClick: function(e, legendItem, legend) {
                            // Переключение видимости графика
                            const index = legendItem.datasetIndex;
                            const meta = chartInstance.getDatasetMeta(index);
                            meta.hidden = meta.hidden === null ? !chartInstance.data.datasets[index].hidden : null;
                            chartInstance.update();
                        }
                    },
                    zoom: {
                        pan: {
                            enabled: false  // Используем собственное панорамирование
                        },
                        zoom: {
                            wheel: {
                                enabled: true  // Разрешаем зум колесиком мыши
                            },
                            pinch: {
                                enabled: true  // Разрешаем пинч на мобильных устройствах
                            },
                            drag: {
                                enabled: false  // Запрещаем зум через перетаскивание
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
    
    // Отображение всех доступных колонок из данных
    function plotAllColumns(data) {
        if (!data) return;
        
        // Получаем временные метки для оси X
        const timestamps = data.map(row => row.timestamp);
        
        // Получаем все числовые колонки
        const columns = Object.keys(data[0]).filter(column => {
            if (column.toLowerCase() === 'timestamp') return false; // Пропускаем колонку timestamp
            
            // Проверяем, содержит ли колонка числовые данные
            return data.some(row => {
                const val = parseFloat(row[column]);
                return !isNaN(val);
            });
        });
        
        // Создаем набор данных для каждой колонки
        const datasets = columns.map(column => {
            return {
                label: column,
                data: data.map(row => parseFloat(row[column]) || 0)
            };
        });
        
        // Создаем мульти-линейный график
        createMultiChart(timestamps, datasets);
        
        // Добавляем обработчики для панорамирования
        setupManualPanning();
    }
    
    // Настройка пользовательского перетаскивания графика
    function setupManualPanning() {
        const canvas = document.getElementById('dataChart');
        if (!canvas) return;
        
        // Устанавливаем курсор "grab"
        canvas.style.cursor = 'grab';
        
        // Обработчик начала перетаскивания
        canvas.addEventListener('mousedown', function(e) {
            if (!chartInstance) return;
            
            isDragging = true;
            dragStartX = e.clientX;
            chartStartMin = chartInstance.scales.x.min;
            chartStartMax = chartInstance.scales.x.max;
            
            canvas.style.cursor = 'grabbing';
            
            // Предотвращаем выделение текста и другие события
            e.preventDefault();
            e.stopPropagation();
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
                if (canvas) canvas.style.cursor = 'grab';
            }
        });
        
        // Обработчик выхода мыши за пределы окна
        window.addEventListener('mouseleave', function() {
            if (isDragging) {
                isDragging = false;
                if (canvas) canvas.style.cursor = 'grab';
            }
        });
    }
    
    // Обработчик сброса зума
    if (resetZoomBtn) {
        resetZoomBtn.addEventListener('click', function() {
            if (!chartInstance) return;
            
            console.log("Reset zoom button clicked");
            
            // Сбрасываем ограничения осей
            if (chartInstance.options.scales.x) {
                delete chartInstance.options.scales.x.min;
                delete chartInstance.options.scales.x.max;
            }
            
            // Сбрасываем зум через ChartJS Zoom Plugin
            if (chartInstance.resetZoom) {
                chartInstance.resetZoom();
            } else {
                // Если плагин не доступен, просто обновляем
                chartInstance.update();
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
        
        // Создаем объект FormData для отправки файла
        const formData = new FormData();
        formData.append('file', file);
        
        // Отправляем AJAX запрос
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
            console.log("Response received:", data);
            
            if (!data.success) {
                throw new Error(data.error || 'Ошибка обработки CSV файла');
            }
            
            // Сохраняем данные CSV
            try {
                if (!data.csv_data) {
                    throw new Error("Сервер не вернул данные CSV");
                }
                
                console.log("Raw CSV data:", data.csv_data.substring(0, 100) + "...");
                csvData = JSON.parse(data.csv_data);
                window.csvType = data.csv_type;
                console.log("Data loaded successfully:", window.csvType);
                console.log("First record sample:", csvData.length > 0 ? JSON.stringify(csvData[0]) : "No records");
            } catch (error) {
                console.error("JSON parsing error:", error);
                throw new Error("Ошибка разбора данных с сервера: " + error.message);
            }
            
            // Отображаем все колонки данных
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
});