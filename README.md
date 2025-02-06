# EUC Telemetry Visualization / Визуализация телеметрии моноколеса

[English](#english) | [Русский](#russian)

## English

### Description
A Flask web application that converts sensor data from EUC (electric unicycle) into dynamic, visually engaging video visualizations with advanced processing capabilities.

### Requirements
- Python 3.11 or higher
- FFmpeg
- DejaVu Sans Bold font
- Required Python packages will be installed automatically during setup

### Installation Instructions

#### Mac (Apple Silicon)
1. Install Python:
```bash
brew install python@3.11
```

2. Install FFmpeg:
```bash
brew install ffmpeg
```

3. Install DejaVu Sans Bold font:
```bash
brew tap homebrew/cask-fonts
brew install --cask font-dejavu-sans
```

4. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

5. Install dependencies:
```bash
pip3 install -r requirements.txt
```

#### Linux
1. Install Python and FFmpeg:
```bash
sudo apt update
sudo apt install python3.11 python3-pip ffmpeg
```

2. Install DejaVu Sans Bold font:
```bash
sudo apt install fonts-dejavu-core
```

3. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Install dependencies:
```bash
pip3 install -r requirements.txt
```

#### Windows
1. Install Python 3.11 from [python.org](https://www.python.org/downloads/)

2. Install FFmpeg:
   - Download from [ffmpeg.org](https://ffmpeg.org/download.html)
   - Add FFmpeg to system PATH

3. Install DejaVu Sans Bold font:
   - Download from [dejavu-fonts.github.io](https://dejavu-fonts.github.io/)
   - Double-click the .ttf file and click "Install"

4. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

5. Install dependencies:
```bash
pip install -r requirements.txt
```

### Running the Application
```bash
python main.py
```
The application will be available at `http://localhost:5000`

## Russian

### Описание
Веб-приложение на Flask, которое преобразует данные датчиков моноколеса в динамичные видеовизуализации с расширенными возможностями обработки.

### Требования
- Python 3.11 или выше
- FFmpeg
- Шрифт DejaVu Sans Bold
- Необходимые Python-пакеты будут установлены автоматически при настройке

### Инструкции по установке

#### Mac (Apple Silicon)
1. Установка Python:
```bash
brew install python@3.11
```

2. Установка FFmpeg:
```bash
brew install ffmpeg
```

3. Установка шрифта DejaVu Sans Bold:
```bash
brew tap homebrew/cask-fonts
brew install --cask font-dejavu-sans
```

4. Клонирование репозитория:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

5. Установка зависимостей:
```bash
pip3 install -r requirements.txt
```

#### Linux
1. Установка Python и FFmpeg:
```bash
sudo apt update
sudo apt install python3.11 python3-pip ffmpeg
```

2. Установка шрифта DejaVu Sans Bold:
```bash
sudo apt install fonts-dejavu-core
```

3. Клонирование репозитория:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

4. Установка зависимостей:
```bash
pip3 install -r requirements.txt
```

#### Windows
1. Установите Python 3.11 с сайта [python.org](https://www.python.org/downloads/)

2. Установка FFmpeg:
   - Скачайте с [ffmpeg.org](https://ffmpeg.org/download.html)
   - Добавьте FFmpeg в системную переменную PATH

3. Установка шрифта DejaVu Sans Bold:
   - Скачайте с [dejavu-fonts.github.io](https://dejavu-fonts.github.io/)
   - Дважды кликните по .ttf файлу и нажмите "Установить"

4. Клонирование репозитория:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

5. Установка зависимостей:
```bash
pip install -r requirements.txt
```

### Запуск приложения
```bash
python main.py
```
Приложение будет доступно по адресу `http://localhost:5000`
