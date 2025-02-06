# EUC Telemetry Visualizer

A Flask web application that converts sensor data from Electric Unicycle (EUC) into dynamic, visually engaging video visualizations with advanced processing capabilities.

## Features

- Process sensor data from various EUC apps (DarknessBot, WheelLog)
- Generate dynamic video visualizations
- Multilingual support
- Concurrent project processing
- Advanced sensor data visualization

## Prerequisites

- Python 3.11 or higher
- UV package manager
- FFmpeg (for video processing)

## Installation Instructions / Инструкция по установке

### English

#### Installing UV Package Manager

1. **macOS (Apple Silicon)**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

2. **Linux**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

3. **Windows**
```powershell
# Using PowerShell (Run as Administrator)
(Invoke-WebRequest -Uri "https://astral.sh/uv/install.ps1" -UseBasicParsing).Content | python -
```

#### Project Installation

1. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

2. Install dependencies using UV:
```bash
uv pip install --requirement pyproject.toml
```

3. Run the application:
```bash
python main.py
```

The application will be available at `http://localhost:5000`

### Русский

#### Установка UV Package Manager

1. **macOS (Apple Silicon)**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

2. **Linux**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

3. **Windows**
```powershell
# Используя PowerShell (Запустить от имени администратора)
(Invoke-WebRequest -Uri "https://astral.sh/uv/install.ps1" -UseBasicParsing).Content | python -
```

#### Установка проекта

1. Клонируйте репозиторий:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

2. Установите зависимости с помощью UV:
```bash
uv pip install --requirement pyproject.toml
```

3. Запустите приложение:
```bash
python main.py
```

Приложение будет доступно по адресу `http://localhost:5000`

## Project Structure

```
├── app.py                  # Main Flask application
├── extensions.py           # Flask extensions
├── models.py              # Database models
├── utils/                 # Utility functions
│   ├── background_processor.py
│   ├── csv_processor.py
│   ├── image_generator.py
│   └── video_creator.py
├── static/               # Static files (CSS, JS)
├── templates/            # HTML templates
├── uploads/             # Directory for uploaded files
├── processed_data/      # Processed CSV files
├── frames/              # Generated video frames
├── videos/              # Output video files
└── previews/           # Video preview images
```

## System Requirements

- **CPU**: Multi-core processor (recommended)
- **RAM**: Minimum 4GB (8GB recommended)
- **Storage**: 1GB free space for installation and processing
- **OS**: Windows 10/11, macOS 11+, or Linux (Ubuntu 20.04+)

## License

This project is licensed under the MIT License - see the LICENSE file for details.
