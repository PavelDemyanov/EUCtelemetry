```
## Installation Instructions

### Prerequisites for All Platforms
- Python 3.11 or higher
- PostgreSQL database
- FFmpeg

### Environment Setup

1. Create a `.env` file in the project root with the following configuration:
```bash
# SMTP Configuration
SMTP_LOGIN=""        # Your SMTP email (e.g., noreply@example.com)
SMTP_PASSWORD=""     # Your SMTP password
SMTP_PORT="465"      # SMTP port (usually 465 for SSL)
SMTP_SERVER=""       # SMTP server (e.g., smtp.gmail.com)

# Flask Configuration
FLASK_SECRET_KEY=""  # Random string for session security (e.g., use os.urandom(24).hex())

# PostgreSQL Database Configuration
DATABASE_URL=""      # Full database URL (e.g., postgresql://username:password@localhost:5432/euc_telemetry)
PGDATABASE=""        # Database name (e.g., euc_telemetry)
PGHOST=""           # Database host (e.g., localhost)
PGPORT=""           # Database port (default: 5432)
PGUSER=""           # Database username
PGPASSWORD=""       # Database user password
```

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

4. Install Poetry (Python dependency management):
```bash
curl -sSL https://install.python-poetry.org | python3 -
```

5. Clone the repository:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

6. Install dependencies using Poetry:
```bash
poetry install
```

### Linux

1. Install system dependencies:
```bash
sudo apt update
sudo apt install python3-pip postgresql postgresql-contrib ffmpeg
```

2. Install Poetry:
```bash
curl -sSL https://install.python-poetry.org | python3 -
```

3. Start PostgreSQL:
```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

4. Clone the repository and install dependencies:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
poetry install
```

### Windows

1. Install Python 3.11 from [python.org](https://www.python.org/downloads/)
2. Install PostgreSQL from [postgresql.org](https://www.postgresql.org/download/windows/)
3. Install FFmpeg from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH
4. Install Poetry:
```powershell
(Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | python -
```

5. Clone the repository and install dependencies:
```cmd
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
poetry install
```

## Database Setup

1. Create a new PostgreSQL database:
```sql
CREATE DATABASE euc_telemetry;
```

2. Initialize the database:
```bash
poetry run flask db upgrade
```

## Running the Application

1. Activate Poetry shell:
```bash
poetry shell
```

2. Start the Flask server:
```bash
python main.py
```

3. Open your browser and navigate to:
```
http://localhost:5000
```

## Development

### Adding New Dependencies

To add new Python packages:
```bash
poetry add package-name
```

### Updating Dependencies

To update all dependencies:
```bash
poetry update
```

To update a specific package:
```bash
poetry update package-name
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

### Настройка окружения

1. Создайте файл `.env` в корне проекта со следующей конфигурацией:
```bash
# Конфигурация SMTP
SMTP_LOGIN=""        # Ваш SMTP email (например, noreply@example.com)
SMTP_PASSWORD=""     # Ваш SMTP пароль
SMTP_PORT="465"      # Порт SMTP (обычно 465 для SSL)
SMTP_SERVER=""       # SMTP сервер (например, smtp.gmail.com)

# Конфигурация Flask
FLASK_SECRET_KEY=""  # Случайная строка для безопасности сессий (например, используйте os.urandom(24).hex())

# Конфигурация базы данных PostgreSQL
DATABASE_URL=""      # Полный URL базы данных (например, postgresql://username:password@localhost:5432/euc_telemetry)
PGDATABASE=""        # Имя базы данных (например, euc_telemetry)
PGHOST=""           # Хост базы данных (например, localhost)
PGPORT=""           # Порт базы данных (по умолчанию: 5432)
PGUSER=""           # Имя пользователя базы данных
PGPASSWORD=""       # Пароль пользователя базы данных
```

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

4. Установите Poetry (менеджер зависимостей Python):
```bash
curl -sSL https://install.python-poetry.org | python3 -
```

5. Клонируйте репозиторий:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
```

6. Установите зависимости с помощью Poetry:
```bash
poetry install
```

### Linux

1. Установите системные зависимости:
```bash
sudo apt update
sudo apt install python3-pip postgresql postgresql-contrib ffmpeg
```

2. Установите Poetry:
```bash
curl -sSL https://install.python-poetry.org | python3 -
```

3. Запустите PostgreSQL:
```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

4. Клонируйте репозиторий и установите зависимости:
```bash
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
poetry install
```

### Windows

1. Установите Python 3.11 с [python.org](https://www.python.org/downloads/)
2. Установите PostgreSQL с [postgresql.org](https://www.postgresql.org/download/windows/)
3. Установите FFmpeg с [ffmpeg.org](https://ffmpeg.org/download.html) и добавьте в PATH
4. Установите Poetry:
```powershell
(Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | python -
```

5. Клонируйте репозиторий и установите зависимости:
```cmd
git clone https://github.com/PavelDemyanov/EUCtelemetry.git
cd EUCtelemetry
poetry install
```

## Настройка базы данных

1. Создайте новую базу данных PostgreSQL:
```sql
CREATE DATABASE euc_telemetry;
```

2. Инициализируйте базу данных:
```bash
poetry run flask db upgrade
```

## Запуск приложения

1. Активируйте оболочку Poetry:
```bash
poetry shell
```

2. Запустите сервер Flask:
```bash
python main.py
```

3. Откройте браузер и перейдите по адресу:
```
http://localhost:5000