# EUC Telemetry Visualization Tool | Инструмент визуализации телеметрии EUC

[English](#english) | [Русский](#russian)

## English

### Description
A Flask web application that converts sensor data from EUC (electric unicycle) into dynamic, visually engaging video visualizations with advanced processing capabilities.

### Features
- Data processing from various EUC apps (DarknessBot, WheelLog)
- Dynamic video generation with telemetry overlay
- Multi-language support
- Concurrent project processing
- Real-time data visualization

### System Requirements
- Python 3.11 or higher
- FFmpeg
- UV package manager

### Installation Instructions

#### macOS (Apple Silicon)
1. Install FFmpeg:
```bash
brew install ffmpeg
```

2. Install UV package manager:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

3. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Install dependencies using UV:
```bash
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

#### Linux
1. Install FFmpeg:
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

2. Install UV package manager:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

3. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Install dependencies using UV:
```bash
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

#### Windows
1. Install FFmpeg:
   - Download FFmpeg from [official website](https://ffmpeg.org/download.html)
   - Add FFmpeg to system PATH

2. Install UV package manager:
   - Open PowerShell as Administrator and run:
```powershell
curl -LsSf https://astral.sh/uv/install.ps1 | powershell
```

3. Clone the repository:
```powershell
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Install dependencies using UV:
```powershell
uv venv
.venv\Scripts\activate
uv pip install -r requirements.txt
```

### Running the Application
```bash
python main.py
```
Access the application at `http://localhost:5000`

## Русский

### Описание
Веб-приложение на Flask, которое преобразует данные датчиков EUC (электроуницикла) в динамичные видеовизуализации с расширенными возможностями обработки.

### Возможности
- Обработка данных из различных приложений EUC (DarknessBot, WheelLog)
- Динамическая генерация видео с наложением телеметрии
- Многоязычная поддержка
- Параллельная обработка проектов
- Визуализация данных в реальном времени

### Системные требования
- Python 3.11 или выше
- FFmpeg
- Пакетный менеджер UV

### Инструкции по установке

#### macOS (Apple Silicon)
1. Установка FFmpeg:
```bash
brew install ffmpeg
```

2. Установка пакетного менеджера UV:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

3. Клонирование репозитория:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Установка зависимостей с помощью UV:
```bash
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

#### Linux
1. Установка FFmpeg:
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

2. Установка пакетного менеджера UV:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

3. Клонирование репозитория:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Установка зависимостей с помощью UV:
```bash
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

#### Windows
1. Установка FFmpeg:
   - Скачайте FFmpeg с [официального сайта](https://ffmpeg.org/download.html)
   - Добавьте FFmpeg в системный PATH

2. Установка пакетного менеджера UV:
   - Откройте PowerShell от имени администратора и выполните:
```powershell
curl -LsSf https://astral.sh/uv/install.ps1 | powershell
```

3. Клонирование репозитория:
```powershell
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Установка зависимостей с помощью UV:
```powershell
uv venv
.venv\Scripts\activate
uv pip install -r requirements.txt
```

### Запуск приложения
```bash
python main.py
```
Доступ к приложению: `http://localhost:5000`
