# EUC Telemetry Visualization

A Flask web application that converts sensor data from Electric Unicycle (EUC) into dynamic, visually engaging video visualizations with advanced processing capabilities.

## Features
- Sensor data processing and visualization
- Video generation from telemetry data
- Support for multiple EUC data formats
- Concurrent project processing
- Interactive web interface

## Installation Instructions / Инструкция по установке

### English

#### Prerequisites
- Python 3.11 or higher
- UV package manager
- FFmpeg (for video processing)

#### Installing UV Package Manager

##### macOS (Apple Silicon)
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

##### Linux
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

##### Windows
```powershell
# Using PowerShell
(Invoke-WebRequest -Uri "https://astral.sh/uv/install.ps1" -UseBasicParsing).Content | pwsh -Command -
```

#### Project Installation

1. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

2. Create and activate virtual environment using UV:
```bash
uv venv
source .venv/bin/activate  # For macOS/Linux
.venv\Scripts\activate     # For Windows
```

3. Install dependencies:
```bash
uv pip install -r requirements.txt
```

4. Run the application:
```bash
python main.py
```

The application will be available at `http://localhost:5000`

### Русский

#### Предварительные требования
- Python 3.11 или выше
- Пакетный менеджер UV
- FFmpeg (для обработки видео)

#### Установка пакетного менеджера UV

##### macOS (Apple Silicon)
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

##### Linux
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

##### Windows
```powershell
# Используя PowerShell
(Invoke-WebRequest -Uri "https://astral.sh/uv/install.ps1" -UseBasicParsing).Content | pwsh -Command -
```

#### Установка проекта

1. Клонируйте репозиторий:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

2. Создайте и активируйте виртуальное окружение с помощью UV:
```bash
uv venv
source .venv/bin/activate  # Для macOS/Linux
.venv\Scripts\activate     # Для Windows
```

3. Установите зависимости:
```bash
uv pip install -r requirements.txt
```

4. Запустите приложение:
```bash
python main.py
```

Приложение будет доступно по адресу `http://localhost:5000`

## System Requirements / Системные требования

### English
- Operating System: Windows 10/11, macOS 11+, or Linux
- RAM: 4GB minimum (8GB recommended)
- Storage: 1GB free space
- Internet connection for installation

### Русский
- Операционная система: Windows 10/11, macOS 11+ или Linux
- Оперативная память: минимум 4ГБ (рекомендуется 8ГБ)
- Место на диске: 1ГБ свободного места
- Интернет-подключение для установки

## License / Лицензия
MIT License
