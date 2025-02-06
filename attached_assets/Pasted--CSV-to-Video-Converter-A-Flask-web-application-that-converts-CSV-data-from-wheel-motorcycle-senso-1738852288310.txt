# Debian/Ubuntu
sudo apt update
sudo apt install python3.11 python3-pip ffmpeg git

# Fedora
sudo dnf install python3.11 python3-pip ffmpeg git

# Arch Linux
sudo pacman -S python python-pip ffmpeg git
```

2. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

3. Run the application:
```bash
python main.py
```

The application will be available at `http://localhost:5000`

### macOS

1. Install Homebrew if not already installed:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Install dependencies:
```bash
brew install python@3.11 ffmpeg git
```

3. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Run the application:
```bash
python3 main.py
```

The application will be available at `http://localhost:5000`

### Windows

1. Download and install Python 3.11 from [python.org](https://www.python.org/downloads/)

2. Download and install Git from [git-scm.com](https://git-scm.com/download/win)

3. Download and install FFmpeg:
   - Download the latest build from [ffmpeg.org](https://ffmpeg.org/download.html)
   - Extract the archive and add the `bin` folder to system PATH

4. Open Command Prompt as Administrator:
```cmd
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
python main.py
```

The application will be available at `http://localhost:5000`

---

# CSV в Видео Конвертер

Веб-приложение на Flask для конвертации CSV данных с датчиков EUC (моноколесо) в динамические видео визуализации. Создает видео из CSV файла, сгенерированного DarknessBot и WheelLog, на синем фоне, что удобно для наложения на видео вашей поездки.

## Возможности

- Загрузка и обработка CSV файлов из DarknessBot или WheelLog
- Предварительный просмотр кадров видео в реальном времени
- Настраиваемые параметры отображения текста
- Несколько вариантов разрешения (Full HD, 4K)
- Различные настройки FPS (14.985, 15, 29.97, 30, 59.94, 60)
- Поддержка кодеков H.264 и H.265
- Управление проектами с отслеживанием статуса

## Требования

- Python 3.11 или выше
- FFmpeg
- Git

## Установка

### Unix/Linux

1. Установка системных зависимостей:
```bash
# Debian/Ubuntu
sudo apt update
sudo apt install python3.11 python3-pip ffmpeg git

# Fedora
sudo dnf install python3.11 python3-pip ffmpeg git

# Arch Linux
sudo pacman -S python python-pip ffmpeg git
```

2. Клонирование репозитория:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

3. Запуск приложения:
```bash
python main.py
```

Приложение будет доступно по адресу `http://localhost:5000`

### macOS

1. Установка Homebrew, если еще не установлен:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Установка зависимостей:
```bash
brew install python@3.11 ffmpeg git
```

3. Клонирование репозитория:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Запуск приложения:
```bash
python3 main.py
```

Приложение будет доступно по адресу `http://localhost:5000`

### Windows

1. Скачайте и установите Python 3.11 с [python.org](https://www.python.org/downloads/)

2. Скачайте и установите Git с [git-scm.com](https://git-scm.com/download/win)

3. Скачайте и установите FFmpeg:
   - Скачайте последнюю сборку с [ffmpeg.org](https://ffmpeg.org/download.html)
   - Распакуйте архив и добавьте папку `bin` в системную переменную PATH

4. Откройте командную строку от имени администратора:
```cmd
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
python main.py