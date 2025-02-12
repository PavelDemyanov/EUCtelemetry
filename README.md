# EUC Telemetry Visualization 🛞

> 🌐 Try it now at [https://euctelemetry.app](https://euctelemetry.app)

Fork and run your own instance, or use our cloud version! ⚡️

A Flask web application for transforming Electric Unicycle (EUC) telemetry data into dynamic video visualizations with advanced processing capabilities. The application processes telemetry data from DarknessBot and WheelLog to create professional-looking video visualizations.

## Features

- Processes and visualizes EUC telemetry metrics:
  - Speed
  - Battery level
  - Temperature
  - Power consumption
  - GPS coordinates
  - Additional metrics
- Generates smooth animations with clean typography using SF UI Display Bold
- Perfect for social media sharing and ride analysis
- Automated environment configuration
- Production-ready with Gunicorn support

## Project Structure

```
├── app.py              # Main Flask application
├── main.py            # Application entry point
├── models.py          # Database models
├── extensions.py      # Flask extensions
├── static/            # Static files (CSS, JS, images)
├── templates/         # HTML templates
├── uploads/          # Temporary CSV file storage
├── frames/           # Generated video frames
├── videos/           # Output video files
├── processed_data/   # Processed CSV files
├── previews/         # Preview images
└── fonts/            # Custom fonts (SF UI Display Bold)
```

## Prerequisites

- Python 3.11 or higher
- PostgreSQL database
- FFmpeg
- Git

## Environment Setup

The application features an automated environment setup process. You only need to configure SMTP settings manually. The `.env` file will be automatically created with this structure:

```bash
# SMTP Configuration (Required to be filled manually)
SMTP_LOGIN=""        # Your SMTP email (e.g., noreply@example.com)
SMTP_PASSWORD=""     # Your SMTP password
SMTP_PORT="465"      # SMTP port (usually 465 for SSL)
SMTP_SERVER=""       # SMTP server (e.g., smtp.gmail.com)

# Flask and Database Configuration (Auto-generated - do not modify)
FLASK_SECRET_KEY=""  # Automatically generated on first run
DATABASE_URL=""      # Automatically configured
PGDATABASE=""        # Defaults to euc_telemetry
PGHOST=""           # Defaults to localhost
PGPORT=""           # Defaults to 5432
PGUSER=""           # Defaults to postgres
PGPASSWORD=""       # Defaults to postgres
```

## Installation Instructions

### Linux (Ubuntu/Debian)

1. Update system and install dependencies:
```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip postgresql postgresql-contrib ffmpeg
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

4. Clone and set up the application:
```bash
git clone https://github.com/YourUsername/EUCtelemetry.git
cd EUCtelemetry
poetry config virtualenvs.in-project true
poetry install --no-dev
```

5. Configure SMTP settings in .env file:
```bash
cat << EOF > .env
SMTP_LOGIN="your_email@example.com"
SMTP_PASSWORD="your_smtp_password"
SMTP_PORT="465"
SMTP_SERVER="smtp.gmail.com"
EOF
```

6. Initialize database:
```bash
poetry run flask db upgrade
```

7. Set up Gunicorn service:
```bash
sudo nano /etc/systemd/system/euctelemetry.service
```

Add the following content:
```ini
[Unit]
Description=EUC Telemetry Gunicorn Daemon
After=network.target

[Service]
User=your_username
Group=your_username
WorkingDirectory=/path/to/EUCtelemetry
Environment="PATH=/path/to/EUCtelemetry/.venv/bin"
ExecStart=/path/to/EUCtelemetry/.venv/bin/gunicorn --workers 3 --bind 0.0.0.0:5000 -m 007 main:app

[Install]
WantedBy=multi-user.target
```

8. Enable and start service:
```bash
sudo systemctl start euctelemetry
sudo systemctl enable euctelemetry
```

### macOS (Apple Silicon)

1. Install Homebrew:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Install dependencies:
```bash
brew install postgresql ffmpeg python@3.11
brew services start postgresql
```

3. Install Poetry and set up the application:
```bash
curl -sSL https://install.python-poetry.org | python3 -
git clone https://github.com/YourUsername/EUCtelemetry.git
cd EUCtelemetry
poetry config virtualenvs.in-project true
poetry install --no-dev
```

4. Configure SMTP settings in .env file (only SMTP settings are required)

5. Initialize database:
```bash
poetry run flask db upgrade
```

6. Create and configure launchd service:
```bash
mkdir -p ~/Library/LaunchAgents
cat << EOF > ~/Library/LaunchAgents/com.euctelemetry.plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.euctelemetry</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/EUCtelemetry/.venv/bin/gunicorn</string>
        <string>--workers</string>
        <string>3</string>
        <string>--bind</string>
        <string>0.0.0.0:5000</string>
        <string>main:app</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/path/to/EUCtelemetry</string>
    <key>StandardOutPath</key>
    <string>/path/to/EUCtelemetry/logs/gunicorn.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/EUCtelemetry/logs/gunicorn.error.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.euctelemetry.plist
```

### Windows

1. Install prerequisites:
   - Python 3.11 from [python.org](https://www.python.org/downloads/)
   - PostgreSQL from [postgresql.org](https://www.postgresql.org/download/windows/)
   - FFmpeg from [ffmpeg.org](https://ffmpeg.org/download.html)
   - Git from [git-scm.com](https://git-scm.com/download/win)

2. Add Python and FFmpeg to PATH

3. Install Poetry and set up the application:
```powershell
(Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | python -
git clone https://github.com/YourUsername/EUCtelemetry.git
cd EUCtelemetry
poetry config virtualenvs.in-project true
poetry install --no-dev
```

4. Configure SMTP settings in .env file (only SMTP settings are required)

5. Initialize database:
```bash
poetry run flask db upgrade
```

6. Create Windows Service using NSSM:
   - Download NSSM from [nssm.cc](https://nssm.cc/)
   - Install the service:
```powershell
nssm install EUCTelemetry "C:\path\to\EUCtelemetry\.venv\Scripts\gunicorn.exe"
nssm set EUCTelemetry AppParameters "--workers 3 --bind 0.0.0.0:5000 main:app"
nssm set EUCTelemetry AppDirectory "C:\path\to\EUCtelemetry"
nssm start EUCTelemetry
```

## Development

### Adding Dependencies

```bash
poetry add package-name
```

### Updating Dependencies

```bash
poetry update
```

### Running in Development Mode

```bash
poetry shell
python main.py
```

## Production Deployment Notes

- Always use HTTPS in production
- Configure proper firewall rules
- Set up monitoring and logging
- Regular database backups
- Configure appropriate worker count based on server resources

## License

[MIT License](LICENSE)

## Support

For issues and feature requests, please use the GitHub issue tracker.