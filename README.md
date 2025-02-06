# EUC Telemetry Visualization

A Flask web application that converts Electric Unicycle (EUC) sensor data into dynamic video visualizations with advanced processing capabilities.

[Русская версия ниже | Russian version below](#русская-версия)

## Features

- Data processing for EUC telemetry
- Dynamic video generation
- Real-time data visualization
- Multi-language support
- Concurrent project processing
- Support for various EUC data formats

## System Requirements

- Python 3.8 or higher
- FFmpeg
- 2GB RAM minimum
- 1GB free disk space

## Installation

### macOS (Apple Silicon)

1. Install Homebrew if not already installed:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Install FFmpeg:
```bash
brew install ffmpeg
```

3. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Install Python dependencies:
```bash
pip3 install flask pillow pandas ffmpeg-python flask-sqlalchemy werkzeug flask-wtf numpy email-validator gunicorn
```

### Linux

1. Install system dependencies:
```bash
sudo apt-get update
sudo apt-get install -y ffmpeg python3-pip python3-venv
```

2. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

3. Install Python dependencies:
```bash
pip3 install flask pillow pandas ffmpeg-python flask-sqlalchemy werkzeug flask-wtf numpy email-validator gunicorn
```

### Windows

1. Install Python 3.8 or higher from [python.org](https://www.python.org/downloads/)

2. Install FFmpeg:
   - Download FFmpeg from [ffmpeg.org](https://ffmpeg.org/download.html)
   - Add FFmpeg to system PATH

3. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Install Python dependencies:
```bash
pip install flask pillow pandas ffmpeg-python flask-sqlalchemy werkzeug flask-wtf numpy email-validator gunicorn
```

## Usage

1. Start the application:
```bash
python main.py
```

2. Open your web browser and navigate to:
```
http://localhost:5000
```

3. Upload your EUC telemetry data and follow the on-screen instructions.

---

# Русская версия

# Визуализация телеметрии моноколеса

Веб-приложение на Flask для преобразования данных телеметрии электрического моноколеса (EUC) в динамические видеовизуализации с расширенными возможностями обработки.

## Возможности

- Обработка телеметрических данных моноколеса
- Создание динамических видео
- Визуализация данных в реальном времени
- Поддержка нескольких языков
- Параллельная обработка проектов
- Поддержка различных форматов данных моноколеса

## Системные требования

- Python 3.8 или выше
- FFmpeg
- Минимум 2 ГБ оперативной памяти
- 1 ГБ свободного места на диске

## Установка

### macOS (Apple Silicon)

1. Установите Homebrew, если он еще не установлен:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Установите FFmpeg:
```bash
brew install ffmpeg
```

3. Клонируйте репозиторий:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Установите зависимости Python:
```bash
pip3 install flask pillow pandas ffmpeg-python flask-sqlalchemy werkzeug flask-wtf numpy email-validator gunicorn
```

### Linux

1. Установите системные зависимости:
```bash
sudo apt-get update
sudo apt-get install -y ffmpeg python3-pip python3-venv
```

2. Клонируйте репозиторий:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

3. Установите зависимости Python:
```bash
pip3 install flask pillow pandas ffmpeg-python flask-sqlalchemy werkzeug flask-wtf numpy email-validator gunicorn
```

### Windows

1. Установите Python 3.8 или выше с сайта [python.org](https://www.python.org/downloads/)

2. Установите FFmpeg:
   - Скачайте FFmpeg с сайта [ffmpeg.org](https://ffmpeg.org/download.html)
   - Добавьте FFmpeg в системную переменную PATH

3. Клонируйте репозиторий:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Установите зависимости Python:
```bash
pip install flask pillow pandas ffmpeg-python flask-sqlalchemy werkzeug flask-wtf numpy email-validator gunicorn
```

## Использование

1. Запустите приложение:
```bash
python main.py
```

2. Откройте веб-браузер и перейдите по адресу:
```
http://localhost:5000
```

3. Загрузите данные телеметрии вашего моноколеса и следуйте инструкциям на экране.
