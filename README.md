/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Install FFmpeg:
```bash
brew install ffmpeg
```

3. Install UV package manager:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

4. Clone the repository and install dependencies:
```bash
uv pip install -r requirements.txt
```

#### Linux
1. Update package list:
```bash
sudo apt-get update
```

2. Install FFmpeg and Python:
```bash
sudo apt-get install -y ffmpeg python3-pip python3-venv
```

3. Install UV package manager:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

4. Clone the repository and install dependencies:
```bash
uv pip install -r requirements.txt
```

#### Windows
1. Install Python 3.8 or higher from [python.org](https://python.org)

2. Download and install FFmpeg:
   - Download from [FFmpeg official website](https://ffmpeg.org/download.html)
   - Add FFmpeg to system PATH

3. Install UV package manager:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

4. Clone the repository and install dependencies:
```bash
uv pip install -r requirements.txt
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

#### macOS (Apple Silicon)
1. Установите Homebrew, если он ещё не установлен:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Установите FFmpeg:
```bash
brew install ffmpeg
```

3. Установите менеджер пакетов UV:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

4. Клонируйте репозиторий и установите зависимости:
```bash
uv pip install -r requirements.txt
```

#### Linux
1. Обновите список пакетов:
```bash
sudo apt-get update
```

2. Установите FFmpeg и Python:
```bash
sudo apt-get install -y ffmpeg python3-pip python3-venv
```

3. Установите менеджер пакетов UV:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

4. Клонируйте репозиторий и установите зависимости:
```bash
uv pip install -r requirements.txt
```

#### Windows
1. Установите Python 3.8 или выше с сайта [python.org](https://python.org)

2. Скачайте и установите FFmpeg:
   - Скачайте с [официального сайта FFmpeg](https://ffmpeg.org/download.html)
   - Добавьте FFmpeg в системную переменную PATH

3. Установите менеджер пакетов UV:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

4. Клонируйте репозиторий и установите зависимости:
```bash
uv pip install -r requirements.txt
```

### Использование
1. Запустите приложение:
```bash
python main.py