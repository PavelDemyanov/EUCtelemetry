# Debian/Ubuntu
sudo apt update
sudo apt install python3.11 python3-pip ffmpeg git

# Fedora
sudo dnf install python3.11 python3-pip ffmpeg git

# Arch Linux
sudo pacman -S python ffmpeg git
```

2. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

3. Install Python dependencies:
```bash
pip3 install -r requirements.txt
```

4. Start the application:
```bash
python3 main.py
```

### macOS

1. Install Homebrew if not already installed:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Install system dependencies:
```bash
brew install python@3.11 ffmpeg git
```

3. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Install Python dependencies:
```bash
pip3 install -r requirements.txt
```

5. Start the application:
```bash
python3 main.py
```

### Windows

1. Install Python 3.11 from [python.org](https://www.python.org/downloads/)
   - Make sure to check "Add Python to PATH" during installation

2. Install Git from [git-scm.com](https://git-scm.com/download/win)

3. Install FFmpeg:
   - Download FFmpeg from [ffmpeg.org](https://ffmpeg.org/download.html)
   - Extract the archive to `C:\ffmpeg`
   - Add `C:\ffmpeg\bin` to system PATH

4. Open Command Prompt as Administrator:
```cmd
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
pip install -r requirements.txt
python main.py
```

The application will be available at `http://localhost:5000`

---

# CSV в Видео Конвертер

Веб-приложение на Flask для конвертации CSV данных с датчиков колеса/мотоцикла в динамические видео визуализации. Создает видео из CSV файла, сгенерированного DarknessBot и WheelLog, на синем фоне, что удобно для наложения на видео вашей поездки.

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
sudo pacman -S python ffmpeg git
```

2. Клонирование репозитория:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

3. Установка Python зависимостей:
```bash
pip3 install -r requirements.txt
```

4. Запуск приложения:
```bash
python3 main.py
```

### macOS

1. Установка Homebrew, если еще не установлен:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Установка системных зависимостей:
```bash
brew install python@3.11 ffmpeg git
```

3. Клонирование репозитория:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Установка Python зависимостей:
```bash
pip3 install -r requirements.txt
```

5. Запуск приложения:
```bash
python3 main.py
```

### Windows

1. Установите Python 3.11 с сайта [python.org](https://www.python.org/downloads/)
   - Убедитесь, что отмечена опция "Add Python to PATH" при установке

2. Установите Git с сайта [git-scm.com](https://git-scm.com/download/win)

3. Установите FFmpeg:
   - Скачайте FFmpeg с сайта [ffmpeg.org](https://ffmpeg.org/download.html)
   - Распакуйте архив в `C:\ffmpeg`
   - Добавьте `C:\ffmpeg\bin` в системную переменную PATH

4. Откройте командную строку от имени администратора:
```cmd
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
pip install -r requirements.txt
python main.py