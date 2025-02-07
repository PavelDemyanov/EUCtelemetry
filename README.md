# EUC Telemetry Visualizer

A Flask web application for converting EUC (electric unicycle) sensor data into dynamic, visually engaging video visualizations with advanced processing capabilities.

## Program Description

The EUC Telemetry Visualizer is a web-based application that:
- Processes CSV files containing EUC sensor data
- Supports both Darknessbot and WheelLog data formats
- Generates dynamic video visualizations of telemetry data
- Provides customizable visualization parameters (text size, padding, etc.)
- Offers real-time preview before video generation
- Manages projects with a PostgreSQL database
- Supports FullHD and 4K video output
- Features asynchronous background processing
- Includes multilingual interface support

## Project Structure

```
├── app.py                    # Main Flask application file
├── models.py                 # SQLAlchemy database models
├── extensions.py             # Flask extensions (database)
├── utils/          
│   ├── background_processor.py  # Background processing
│   ├── csv_processor.py        # CSV file processing
│   ├── image_generator.py      # Frame generation
│   └── video_creator.py        # Video creation
├── static/         
│   ├── css/                  # Stylesheets
│   └── js/                   # JavaScript files
├── templates/                # HTML templates
├── uploads/                  # CSV file storage
├── frames/                   # Generated video frames
├── videos/                   # Output videos
└── previews/                 # Preview images
```

## Installation Guide

### macOS (Apple Silicon)

```bash
# 1. Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Install required system packages
brew install python@3.11 postgresql@16 ffmpeg

# 3. Start PostgreSQL service
brew services start postgresql@16

# 4. Clone the repository
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry

# 5. Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# 6. Install Python dependencies
pip install -r requirements.txt

# 7. Create database
createdb euc_visualizer
```

### Linux

```bash
# 1. Update package list
sudo apt update
sudo apt upgrade

# 2. Install system dependencies
sudo apt install python3.11 python3-pip postgresql-16 ffmpeg

# 3. Start PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 4. Clone the repository
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry

# 5. Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# 6. Install Python dependencies
pip install -r requirements.txt

# 7. Create database
sudo -u postgres createdb euc_visualizer
```

### Windows

1. Install prerequisites:
   - Python 3.11 from [python.org](https://www.python.org/downloads/)
   - PostgreSQL from [postgresql.org](https://www.postgresql.org/download/windows/)
   - FFmpeg from [ffmpeg.org](https://ffmpeg.org/download.html)
   - Add FFmpeg to system PATH

2. Clone the repository:
```powershell
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

3. Set up the environment:
```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

4. Create database:
```powershell
createdb euc_visualizer
```

### Final Setup (All Platforms)

1. Configure environment variables in `.env`:
```
DATABASE_URL=postgresql://username:password@localhost:5432/euc_visualizer
FLASK_SECRET_KEY=your_secret_key
```

2. Initialize the database:
```bash
flask db upgrade
```

3. Run the application:
```bash
flask run
```

The application will be available at http://localhost:5000

---

# Визуализатор телеметрии моноколеса

Веб-приложение на Flask для преобразования данных датчиков моноколеса в динамические видеовизуализации с расширенными возможностями обработки.

## Описание программы

Визуализатор телеметрии моноколеса - это веб-приложение, которое:
- Обрабатывает CSV файлы с данными датчиков моноколеса
- Поддерживает форматы данных Darknessbot и WheelLog
- Генерирует динамические видеовизуализации телеметрических данных
- Предоставляет настраиваемые параметры визуализации (размер текста, отступы и т.д.)
- Обеспечивает предварительный просмотр в реальном времени
- Управляет проектами с использованием базы данных PostgreSQL
- Поддерживает вывод видео в форматах FullHD и 4K
- Включает асинхронную фоновую обработку
- Поддерживает многоязычный интерфейс

## Структура проекта

```
├── app.py                    # Основной файл приложения Flask
├── models.py                 # Модели базы данных SQLAlchemy
├── extensions.py             # Расширения Flask (база данных)
├── utils/          
│   ├── background_processor.py  # Фоновая обработка
│   ├── csv_processor.py        # Обработка CSV файлов
│   ├── image_generator.py      # Генерация кадров
│   └── video_creator.py        # Создание видео
├── static/         
│   ├── css/                  # Таблицы стилей
│   └── js/                   # JavaScript файлы
├── templates/                # HTML шаблоны
├── uploads/                  # Хранение CSV файлов
├── frames/                   # Сгенерированные кадры
├── videos/                   # Готовые видео
└── previews/                 # Изображения предпросмотра
```

## Руководство по установке

### macOS (Apple Silicon)

```bash
# 1. Установка Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Установка системных зависимостей
brew install python@3.11 postgresql@16 ffmpeg

# 3. Запуск службы PostgreSQL
brew services start postgresql@16

# 4. Клонирование репозитория
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry

# 5. Создание и активация виртуального окружения
python3 -m venv venv
source venv/bin/activate

# 6. Установка Python зависимостей
pip install -r requirements.txt

# 7. Создание базы данных
createdb euc_visualizer
```

### Linux

```bash
# 1. Обновление пакетов
sudo apt update
sudo apt upgrade

# 2. Установка системных зависимостей
sudo apt install python3.11 python3-pip postgresql-16 ffmpeg

# 3. Запуск службы PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 4. Клонирование репозитория
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry

# 5. Создание и активация виртуального окружения
python3 -m venv venv
source venv/bin/activate

# 6. Установка Python зависимостей
pip install -r requirements.txt

# 7. Создание базы данных
sudo -u postgres createdb euc_visualizer
```

### Windows

1. Установка необходимых компонентов:
   - Python 3.11 с [python.org](https://www.python.org/downloads/)
   - PostgreSQL с [postgresql.org](https://www.postgresql.org/download/windows/)
   - FFmpeg с [ffmpeg.org](https://ffmpeg.org/download.html)
   - Добавьте FFmpeg в системный PATH

2. Клонирование репозитория:
```powershell
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

3. Настройка окружения:
```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

4. Создание базы данных:
```powershell
createdb euc_visualizer
```

### Финальная настройка (Для всех платформ)

1. Настройка переменных окружения в файле `.env`:
```
DATABASE_URL=postgresql://username:password@localhost:5432/euc_visualizer
FLASK_SECRET_KEY=your_secret_key
```

2. Инициализация базы данных:
```bash
flask db upgrade
```

3. Запуск приложения:
```bash
flask run
```

Приложение будет доступно по адресу http://localhost:5000
