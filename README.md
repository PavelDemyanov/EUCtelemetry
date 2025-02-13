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

### macOS (Apple Silicon/Intel)

1. Install Homebrew:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Install dependencies:
```bash
brew install postgresql ffmpeg python@3.11
brew services start postgresql
```

3. Install uv (Python package installer):
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

4. Clone the repository and set up the application:
```bash
git clone https://github.com/YourUsername/EUCtelemetry.git
cd EUCtelemetry
```

5. Create and activate virtual environment:
```bash
uv venv
source .venv/bin/activate
```

6. Install dependencies:
```bash
uv pip install --requirements <(uv pip compile pyproject.toml)
```

7. Configure SMTP settings in .env file (only SMTP settings are required)

8. Initialize database:
```bash
flask db upgrade
```

### Linux (Ubuntu/Debian)

1. Update system and install dependencies:
```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip postgresql postgresql-contrib ffmpeg
```

2. Install uv:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

3. Follow steps 4-8 from macOS installation

### Windows

1. Install prerequisites:
   - Python 3.11 from [python.org](https://www.python.org/downloads/)
   - PostgreSQL from [postgresql.org](https://www.postgresql.org/download/windows/)
   - FFmpeg from [ffmpeg.org](https://ffmpeg.org/download.html)
   - Git from [git-scm.com](https://git-scm.com/download/win)

2. Install uv:
```powershell
(Invoke-WebRequest -Uri https://astral.sh/uv/install.sh -UseBasicParsing).Content | sh
```

3. Follow steps 4-8 from macOS installation, but use Windows-specific commands:
```powershell
# Activate virtual environment
.venv\Scripts\activate
```

## Development

### Adding Dependencies

To add a new dependency:
```bash
uv pip install package-name
```

And then update pyproject.toml with the new dependency.


## Running the Application

### Development Mode

For local development with auto-reload:
```bash
python main.py
```

### Production Mode

1. Using Gunicorn directly:
```bash
gunicorn --workers 3 --bind 0.0.0.0:5000 main:app
```

2. Using systemd service (Linux):

Create a systemd service file:
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
ExecStart=/path/to/EUCtelemetry/.venv/bin/gunicorn --workers 3 --bind 0.0.0.0:5000 main:app

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl enable euctelemetry
sudo systemctl start euctelemetry
```

3. Using launchd service (macOS):

Create a launchd service file:
```bash
mkdir -p ~/Library/LaunchAgents
nano ~/Library/LaunchAgents/com.euctelemetry.plist
```

Add the following content:
```xml
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
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Load and start the service:
```bash
launchctl load ~/Library/LaunchAgents/com.euctelemetry.plist
```

4. Using process manager (PM2):

Install PM2:
```bash
npm install -g pm2
```

Create ecosystem.config.js:
```javascript
module.exports = {
  apps: [{
    name: "euctelemetry",
    script: ".venv/bin/gunicorn",
    args: "main:app --workers 3 --bind 0.0.0.0:5000",
    interpreter: "none",
    cwd: "/path/to/EUCtelemetry",
    watch: false,
    env: {
      PATH: "/path/to/EUCtelemetry/.venv/bin"
    }
  }]
}
```

Start the application:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Important Production Settings

1. Workers Configuration:
- For CPU-bound applications: workers = 2 × CPU cores + 1
- For I/O-bound applications: workers = CPU cores × 2 or more
```bash
gunicorn --workers=$(( 2 * $(nproc) + 1 )) --bind 0.0.0.0:5000 main:app
```

2. Additional Gunicorn Settings:
```bash
gunicorn \
    --workers 3 \
    --bind 0.0.0.0:5000 \
    --timeout 120 \
    --keep-alive 5 \
    --max-requests 1000 \
    --max-requests-jitter 100 \
    --access-logfile /path/to/access.log \
    --error-logfile /path/to/error.log \
    main:app
```

3. Security Recommendations:
- Run behind a reverse proxy (Nginx/Apache)
- Enable HTTPS
- Set secure headers
- Limit access to admin endpoints
- Configure proper file permissions

## License

[MIT License](LICENSE)

## Support

For issues and feature requests, please use the GitHub issue tracker.