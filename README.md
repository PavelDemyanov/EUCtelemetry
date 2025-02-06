# EUC Video Telemetry Generator

A Flask web application that converts sensor data from Electric Unicycle (EUC) into dynamic video visualizations with telemetry overlay.

[Русская версия ниже / Russian version below](#русская-версия)

## Features

- Support for DarknessBot and WheelLog CSV formats
- Real-time preview of telemetry overlay
- Customizable text position and styling
- Multiple video quality options (Full HD / 4K)
- Various FPS settings (14.985, 15, 29.97, 30, 59.94, 60)
- H.264 and H.265 video codec support
- Concurrent project processing
- Project management system

## System Requirements

- Python 3.8 or higher
- FFmpeg
- 4GB RAM minimum (8GB recommended for 4K processing)
- 10GB free disk space for processing

## Installation Instructions

### macOS (Apple Silicon)

1. Install Homebrew if not already installed:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Install Python and FFmpeg:
```bash
brew install python@3.11 ffmpeg
```

3. Clone the repository and navigate to the project directory:
```bash
git clone [repository-url]
cd euc-video-telemetry
```

4. Create and activate virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate
```

5. Install required Python packages:
```bash
pip install flask pillow werkzeug flask-wtf sqlalchemy ffmpeg-python flask-sqlalchemy pandas numpy
```

### Linux

1. Update package list and install required system packages:
```bash
sudo apt update
sudo apt install python3-pip python3-venv ffmpeg
```

2. Clone the repository and navigate to the project directory:
```bash
git clone [repository-url]
cd euc-video-telemetry
```

3. Create and activate virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate
```

4. Install required Python packages:
```bash
pip install flask pillow werkzeug flask-wtf sqlalchemy ffmpeg-python flask-sqlalchemy pandas numpy
```

### Windows

1. Install Python 3.11 from [python.org](https://www.python.org/downloads/)

2. Download FFmpeg from [ffmpeg.org](https://ffmpeg.org/download.html) and add it to system PATH

3. Clone the repository and navigate to the project directory:
```bash
git clone [repository-url]
cd euc-video-telemetry
```

4. Create and activate virtual environment:
```bash
python -m venv venv
venv\Scripts\activate
```

5. Install required Python packages:
```bash
pip install flask pillow werkzeug flask-wtf sqlalchemy ffmpeg-python flask-sqlalchemy pandas numpy
```

## Running the Application

1. Activate virtual environment (if not already activated):
```bash
# macOS/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate
```

2. Start the application:
```bash
python main.py
```

3. Open web browser and navigate to:
```
http://localhost:5000
```

---

# Русская версия

# Генератор видео с телеметрией для электроуницикла

Веб-приложение на Flask, которое преобразует данные датчиков электроуницикла (EUC) в динамическую видеовизуализацию с наложением телеметрии.

## Возможности

- Поддержка форматов CSV от DarknessBot и WheelLog
- Предварительный просмотр наложения телеметрии в реальном времени
- Настраиваемое положение и стиль текста
- Несколько вариантов качества видео (Full HD / 4K)
- Различные настройки FPS (14.985, 15, 29.97, 30, 59.94, 60)
- Поддержка видеокодеков H.264 и H.265
- Параллельная обработка проектов
- Система управления проектами

## Системные требования

- Python 3.8 или выше
- FFmpeg
- Минимум 4 ГБ ОЗУ (рекомендуется 8 ГБ для обработки 4K)
- 10 ГБ свободного места на диске для обработки

## Инструкции по установке

### macOS (Apple Silicon)

1. Установите Homebrew, если он еще не установлен:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Установите Python и FFmpeg:
```bash
brew install python@3.11 ffmpeg
```

3. Клонируйте репозиторий и перейдите в директорию проекта:
```bash
git clone [repository-url]
cd euc-video-telemetry
```

4. Создайте и активируйте виртуальное окружение:
```bash
python3 -m venv venv
source venv/bin/activate
```

5. Установите необходимые пакеты Python:
```bash
pip install flask pillow werkzeug flask-wtf sqlalchemy ffmpeg-python flask-sqlalchemy pandas numpy
```

### Linux

1. Обновите список пакетов и установите необходимые системные пакеты:
```bash
sudo apt update
sudo apt install python3-pip python3-venv ffmpeg
```

2. Клонируйте репозиторий и перейдите в директорию проекта:
```bash
git clone [repository-url]
cd euc-video-telemetry
```

3. Создайте и активируйте виртуальное окружение:
```bash
python3 -m venv venv
source venv/bin/activate
```

4. Установите необходимые пакеты Python:
```bash
pip install flask pillow werkzeug flask-wtf sqlalchemy ffmpeg-python flask-sqlalchemy pandas numpy
```

### Windows

1. Установите Python 3.11 с сайта [python.org](https://www.python.org/downloads/)

2. Скачайте FFmpeg с сайта [ffmpeg.org](https://ffmpeg.org/download.html) и добавьте в системный PATH

3. Клонируйте репозиторий и перейдите в директорию проекта:
```bash
git clone [repository-url]
cd euc-video-telemetry
```

4. Создайте и активируйте виртуальное окружение:
```bash
python -m venv venv
venv\Scripts\activate
```

5. Установите необходимые пакеты Python:
```bash
pip install flask pillow werkzeug flask-wtf sqlalchemy ffmpeg-python flask-sqlalchemy pandas numpy
```

## Запуск приложения

1. Активируйте виртуальное окружение (если еще не активировано):
```bash
# macOS/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate
```

2. Запустите приложение:
```bash
python main.py
```

3. Откройте веб-браузер и перейдите по адресу:
```
http://localhost:5000
```
