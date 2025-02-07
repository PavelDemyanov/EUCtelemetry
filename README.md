# EUC Telemetry Visualization

A powerful Flask web application for converting Electric Unicycle (EUC) sensor data into dynamic video visualizations with advanced processing capabilities.

## Program Description

This application processes telemetry data from Electric Unicycles (specifically from DarknessBot and WheelLog) and creates professional-looking video visualizations. It displays key metrics such as:
- Speed
- Battery level
- Temperature
- Power consumption
- GPS coordinates
- And more

The generated videos include smooth animations and clean typography using SF UI Display Bold font, making them perfect for sharing on social media or analyzing ride data.

## Project Structure

```
├── app.py              # Main Flask application
├── main.py            # Application entry point
├── models.py          # Database models
├── extensions.py      # Flask extensions
├── static/            # Static assets (CSS, JS, images)
├── templates/         # HTML templates
├── uploads/          # Temporary storage for uploaded CSV files
├── frames/           # Generated video frames
├── videos/           # Output video files
├── processed_data/   # Processed CSV files
├── previews/         # Preview images
└── fonts/            # Custom fonts (SF UI Display Bold)
```

## Installation Instructions

### Prerequisites for All Platforms
- Python 3.11 or higher
- PostgreSQL database
- FFmpeg

### macOS (Apple Silicon)

1. Install Homebrew:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Install PostgreSQL and FFmpeg:
```bash
brew install postgresql ffmpeg
```

3. Start PostgreSQL:
```bash
brew services start postgresql
```

4. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

5. Create and activate virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate
```

6. Install dependencies:
```bash
pip install -r requirements.txt
```

### Linux

1. Install system dependencies:
```bash
sudo apt update
sudo apt install python3-pip python3-venv postgresql postgresql-contrib ffmpeg
```

2. Start PostgreSQL:
```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

3. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Create and activate virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate
```

5. Install dependencies:
```bash
pip install -r requirements.txt
```

### Windows

1. Install Python 3.11 from [python.org](https://www.python.org/downloads/)

2. Install PostgreSQL from [postgresql.org](https://www.postgresql.org/download/windows/)

3. Install FFmpeg:
   - Download from [ffmpeg.org](https://ffmpeg.org/download.html)
   - Add FFmpeg to system PATH

4. Clone the repository:
```cmd
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

5. Create and activate virtual environment:
```cmd
python -m venv venv
venv\Scripts\activate
```

6. Install dependencies:
```cmd
pip install -r requirements.txt
```

## Database Setup (All Platforms)

1. Create a new PostgreSQL database:
```sql
CREATE DATABASE euc_telemetry;
```

2. Set environment variables:
```bash
# Unix/macOS
export DATABASE_URL="postgresql://username:password@localhost/euc_telemetry"

# Windows (CMD)
set DATABASE_URL=postgresql://username:password@localhost/euc_telemetry

# Windows (PowerShell)
$env:DATABASE_URL="postgresql://username:password@localhost/euc_telemetry"
```

3. Initialize the database:
```bash
flask db upgrade
```

## Running the Application

1. Start the Flask server:
```bash
python main.py
```

2. Open your browser and navigate to:
```
http://localhost:5000
```

---

# EUC Telemetry Visualization (Русский)

Веб-приложение на Flask для преобразования данных телеметрии электроуницикла (EUC) в динамические видеовизуализации с расширенными возможностями обработки.

## Описание программы

Это приложение обрабатывает данные телеметрии электроуницикла (из DarknessBot и WheelLog) и создает профессионально выглядящие видеовизуализации. Отображаются следующие метрики:
- Скорость
- Уровень заряда батареи
- Температура
- Потребляемая мощность
- GPS координаты
- И другие

Генерируемые видео включают плавные анимации и чистую типографику с использованием шрифта SF UI Display Bold, что делает их идеальными для публикации в социальных сетях или анализа данных поездки.

## Структура проекта

```
├── app.py              # Основное приложение Flask
├── main.py            # Точка входа в приложение
├── models.py          # Модели базы данных
├── extensions.py      # Расширения Flask
├── static/            # Статические файлы (CSS, JS, изображения)
├── templates/         # HTML шаблоны
├── uploads/          # Временное хранилище загруженных CSV файлов
├── frames/           # Сгенерированные кадры видео
├── videos/           # Выходные видеофайлы
├── processed_data/   # Обработанные CSV файлы
├── previews/         # Предварительные изображения
└── fonts/            # Пользовательские шрифты (SF UI Display Bold)
```

## Инструкции по установке

### Необходимые компоненты для всех платформ
- Python 3.11 или выше
- База данных PostgreSQL
- FFmpeg

### macOS (Apple Silicon)

1. Установите Homebrew:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Установите PostgreSQL и FFmpeg:
```bash
brew install postgresql ffmpeg
```

3. Запустите PostgreSQL:
```bash
brew services start postgresql
```

4. Клонируйте репозиторий:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

5. Создайте и активируйте виртуальное окружение:
```bash
python3 -m venv venv
source venv/bin/activate
```

6. Установите зависимости:
```bash
pip install -r requirements.txt
```

### Linux

1. Установите системные зависимости:
```bash
sudo apt update
sudo apt install python3-pip python3-venv postgresql postgresql-contrib ffmpeg
```

2. Запустите PostgreSQL:
```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

3. Клонируйте репозиторий:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Создайте и активируйте виртуальное окружение:
```bash
python3 -m venv venv
source venv/bin/activate
```

5. Установите зависимости:
```bash
pip install -r requirements.txt
```

### Windows

1. Установите Python 3.11 с [python.org](https://www.python.org/downloads/)

2. Установите PostgreSQL с [postgresql.org](https://www.postgresql.org/download/windows/)

3. Установите FFmpeg:
   - Скачайте с [ffmpeg.org](https://ffmpeg.org/download.html)
   - Добавьте FFmpeg в системный PATH

4. Клонируйте репозиторий:
```cmd
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

5. Создайте и активируйте виртуальное окружение:
```cmd
python -m venv venv
venv\Scripts\activate
```

6. Установите зависимости:
```cmd
pip install -r requirements.txt
```

## Настройка базы данных (Все платформы)

1. Создайте новую базу данных PostgreSQL:
```sql
CREATE DATABASE euc_telemetry;
```

2. Установите переменные окружения:
```bash
# Unix/macOS
export DATABASE_URL="postgresql://username:password@localhost/euc_telemetry"

# Windows (CMD)
set DATABASE_URL=postgresql://username:password@localhost/euc_telemetry

# Windows (PowerShell)
$env:DATABASE_URL="postgresql://username:password@localhost/euc_telemetry"
```

3. Инициализируйте базу данных:
```bash
flask db upgrade
```

## Запуск приложения

1. Запустите сервер Flask:
```bash
python main.py
```

2. Откройте браузер и перейдите по адресу:
```
http://localhost:5000
```
