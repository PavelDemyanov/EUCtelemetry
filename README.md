pip install uv
```

2. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

3. Install dependencies using UV:
```bash
uv pip sync
```

#### Option 2: Traditional Installation

##### macOS (Apple Silicon)
1. Install Homebrew if not already installed:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Install FFmpeg:
```bash
brew install ffmpeg
```

3. Install Python dependencies:
```bash
pip3 install pillow email-validator flask-login gunicorn flask-wtf flask psycopg2-binary werkzeug ffmpeg-python flask-sqlalchemy pandas numpy
```

##### Linux
1. Update package list:
```bash
sudo apt-get update
```

2. Install FFmpeg and Python:
```bash
sudo apt-get install -y ffmpeg python3-pip python3-venv
```

3. Install Python dependencies:
```bash
pip3 install pillow email-validator flask-login gunicorn flask-wtf flask psycopg2-binary werkzeug ffmpeg-python flask-sqlalchemy pandas numpy
```

##### Windows
1. Install Python 3.8 or higher from [python.org](https://python.org)

2. Download and install FFmpeg:
   - Download from [FFmpeg official website](https://ffmpeg.org/download.html)
   - Add FFmpeg to system PATH

3. Install Python dependencies:
```bash
pip install pillow email-validator flask-login gunicorn flask-wtf flask psycopg2-binary werkzeug ffmpeg-python flask-sqlalchemy pandas numpy
```

### Usage
1. Start the application:
```bash
python main.py
```
2. Open web browser and navigate to `http://localhost:5000`
3. Upload your EUC telemetry data
4. Wait for processing to complete
5. Download or view your visualization

## Русский

### Возможности
- Обработка и визуализация данных датчиков EUC
- Создание динамических видео визуализаций
- Поддержка различных форматов данных
- Параллельная обработка проектов
- Визуализация данных в реальном времени
- Многоязычная поддержка

### Системные требования
- Python 3.8 или выше
- FFmpeg
- Минимум 2ГБ оперативной памяти
- 1ГБ свободного места на диске

### Инструкции по установке

#### Вариант 1: Использование UV (Рекомендуется)

UV - это быстрый установщик и решатель зависимостей для Python. Это рекомендуемый метод установки.

1. Установите UV:
```bash
pip install uv
```

2. Клонируйте репозиторий:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

3. Установите зависимости с помощью UV:
```bash
uv pip sync
```

#### Вариант 2: Традиционная установка

##### macOS (Apple Silicon)
1. Установите Homebrew, если он ещё не установлен:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Установите FFmpeg:
```bash
brew install ffmpeg
```

3. Установите зависимости Python:
```bash
pip3 install pillow email-validator flask-login gunicorn flask-wtf flask psycopg2-binary werkzeug ffmpeg-python flask-sqlalchemy pandas numpy
```

##### Linux
1. Обновите список пакетов:
```bash
sudo apt-get update
```

2. Установите FFmpeg и Python:
```bash
sudo apt-get install -y ffmpeg python3-pip python3-venv
```

3. Установите зависимости Python:
```bash
pip3 install pillow email-validator flask-login gunicorn flask-wtf flask psycopg2-binary werkzeug ffmpeg-python flask-sqlalchemy pandas numpy
```

##### Windows
1. Установите Python 3.8 или выше с сайта [python.org](https://python.org)

2. Скачайте и установите FFmpeg:
   - Скачайте с [официального сайта FFmpeg](https://ffmpeg.org/download.html)
   - Добавьте FFmpeg в системную переменную PATH

3. Установите зависимости Python:
```bash
pip install pillow email-validator flask-login gunicorn flask-wtf flask psycopg2-binary werkzeug ffmpeg-python flask-sqlalchemy pandas numpy
```

### Использование
1. Запустите приложение:
```bash
python main.py