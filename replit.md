# EUC Telemetry Visualization

## Overview

EUC Telemetry Visualization is a Flask web application designed for processing Electric Unicycle (EUC) telemetry data and generating dynamic video visualizations with professional overlays. The application transforms telemetry data from popular EUC apps (DarknessBot and WheelLog) into engaging videos suitable for social media sharing and ride analysis.

## System Architecture

### Backend Architecture
- **Framework**: Flask (Python web framework)
- **Database**: PostgreSQL with SQLAlchemy ORM
- **Authentication**: Flask-Login for user session management
- **Migrations**: Flask-Migrate for database schema management
- **Internationalization**: Flask-Babel for multi-language support (English/Russian)

### Frontend Architecture
- **Templates**: Jinja2 templating engine
- **Styling**: Bootstrap CSS framework
- **JavaScript**: Vanilla JavaScript for dynamic interactions
- **Media Processing**: PIL (Python Imaging Library) for image generation
- **Video Creation**: FFmpeg for video compilation

### File Processing Pipeline
1. **CSV Upload**: Users upload telemetry data from EUC apps
2. **Data Processing**: CSV files are parsed and standardized
3. **Frame Generation**: Telemetry data is converted to visual frames
4. **Video Compilation**: Frames are assembled into videos using FFmpeg

## Key Components

### Models (`models.py`)
- **User**: Authentication and user management with email confirmation
- **Project**: Video processing projects with status tracking
- **News**: Content management system for announcements
- **EmailCampaign**: Email marketing functionality
- **Preset**: User-customizable visualization settings

### Utilities
- **CSV Processor**: Handles different telemetry data formats (DarknessBot, WheelLog)
- **Image Generator**: Creates telemetry overlay frames with customizable styling
- **Video Creator**: Assembles frames into final video output
- **Background Processor**: Manages long-running video processing tasks
- **Hardware Detection**: Optimizes processing based on system capabilities (Apple Silicon support)

### Forms (`forms.py`)
- User registration and authentication forms
- Profile management and password reset functionality
- Admin forms for news and email campaigns
- WTForms validation and CSRF protection

## Data Flow

1. **User Registration**: Email-based registration with confirmation tokens
2. **CSV Upload**: Files stored in `/uploads/` directory
3. **Data Processing**: CSV parsing and telemetry data standardization
4. **Frame Generation**: Creation of visual overlays in `/frames/` directory
5. **Video Compilation**: FFmpeg processing with hardware acceleration
6. **Output Delivery**: Final videos stored in `/videos/` directory

### Processing Workflow
- **Async Processing**: Background tasks prevent UI blocking
- **Progress Tracking**: Real-time status updates for long operations
- **Error Handling**: Comprehensive logging and user feedback
- **Resource Management**: Automatic cleanup of temporary files

## External Dependencies

### Core Dependencies
- **Flask Ecosystem**: Flask, Flask-SQLAlchemy, Flask-Login, Flask-Migrate, Flask-Babel
- **Database**: PostgreSQL with psycopg2-binary driver
- **Data Processing**: pandas, numpy for telemetry data manipulation
- **Image Processing**: Pillow for graphics generation
- **Video Processing**: FFmpeg (system dependency)

### Production Dependencies
- **Gunicorn**: WSGI server for production deployment
- **Email Services**: SMTP integration for user communications
- **Hardware Acceleration**: VideoToolbox support for Apple Silicon

### Environment Configuration
- **Automated Setup**: Environment variables configured automatically
- **SMTP Integration**: Email services for user notifications
- **Database Configuration**: PostgreSQL connection management

## Deployment Strategy

### Development Environment
- **Local Development**: Flask development server with hot reload
- **Database**: Local PostgreSQL instance
- **File Storage**: Local filesystem for uploads and outputs

### Production Environment
- **Web Server**: Gunicorn WSGI server
- **Process Management**: Background task processing
- **Static Files**: Direct serving from Flask application
- **Database**: PostgreSQL with connection pooling

### Replit Configuration
- **Modules**: Python 3.11, PostgreSQL 16
- **Deployment**: Autoscale deployment target
- **Port Configuration**: Flask on port 5000, external on port 80
- **Dependencies**: Managed via pyproject.toml

### Hardware Optimization
- **Apple Silicon**: VideoToolbox hardware acceleration for video processing
- **Cross-platform**: Supports various system architectures
- **Resource Monitoring**: psutil for system resource tracking

## User Preferences

Preferred communication style: Simple, everyday language.
Icon vertical positioning: Default offset of 5 pixels works best for telemetry overlay alignment.

## Changelog

- June 26, 2025: Initial setup and icon positioning implementation
- June 26, 2025: Added icon vertical positioning slider with default 5px offset
- June 26, 2025: Icons now scale proportionally with font size (80% ratio)
- June 26, 2025: Added real-time numeric display for icon positioning slider
- June 26, 2025: Implemented adaptive icon coloring (black icons on yellow/red backgrounds)
- June 26, 2025: Extended icon vertical positioning range from -10/+10 to -30/+30 pixels
- June 26, 2025: Added icon settings to preset system (use_icons and icon_vertical_offset)
- June 26, 2025: Moved BETA label from "Preset Controls" and "Trim CSV Data" to "Icons instead of text"
- June 27, 2025: Implemented Static Box Size feature with character-based sizing for consistent data box widths
- June 27, 2025: Added Static Box Size parameter to preset system with BETA label
- June 27, 2025: Fixed max_speed sizing issue and limited specific parameters to 3-character maximum width
- June 27, 2025: Added SMTP email server testing functionality to admin panel with connection test and test email features
- June 27, 2025: Implemented comprehensive achievements management system with database models, admin interface, and formula editing capabilities
- June 27, 2025: Fixed achievements table layout with proper column sizing and responsive design
- June 27, 2025: Integrated database-driven achievements system with CSV analytics, replacing hardcoded achievement logic
- June 27, 2025: Added 5 additional achievements to database (sleep, fast, superfast, suicidalmadman, dead) for total of 11 achievements
- June 27, 2025: Fixed CSS styling issues in achievement edit forms to prevent text overlay in help sections
- June 27, 2025: Implemented simple mathematical CAPTCHA on registration page with blue background for better visibility and session-based validation
- June 30, 2025: Made website fully independent from external CDN resources by downloading Bootstrap, Bootstrap Icons, and Chart.js libraries locally
- June 30, 2025: Updated footer background color to #181a1d for improved visual design
- July 1, 2025: Fixed achievements display issue after CDN migration by replacing FontAwesome icons with Bootstrap Icons
- July 1, 2025: Updated admin templates (achievements.html, achievement_form.html, dashboard.html) to use Bootstrap Icons instead of FontAwesome
- July 1, 2025: All 11 achievements now display correctly on /admin/achievements page with proper icon rendering
- July 1, 2025: Fixed missing achievements on production by adding 5 missing achievements (sleep, fast, superfast, suicidalmadman, dead) to get_default_achievements() function
- July 1, 2025: Created missing_achievements.sql script for manual achievement insertion if needed on production
- July 1, 2025: Added "Refresh Achievements" button in admin panel to automatically restore missing achievements without deleting existing ones
- July 1, 2025: Created admin_achievements_refresh() function that safely adds missing default achievements to database
- July 10, 2025: Extended icon horizontal spacing slider range from 0-20px to 0-50px with resolution-dependent defaults
- July 10, 2025: Implemented automatic spacing values: 10px for Full HD, 20px for 4K resolution
- July 10, 2025: Added dynamic spacing adjustment when switching resolutions or enabling icons
- July 10, 2025: Added "Time" element to Telemetry Elements Visibility section displaying real-time in HH:MM:SS format with proper localization support and time icon
- August 8, 2025: Implemented Horizontal Position slider with 0.5% precision for precise panel placement control
- August 8, 2025: Fixed Horizontal Position persistence in presets and resolution switching
- August 8, 2025: Moved BETA label from "Static Box Size" to "Vertical Layout" checkbox
- August 8, 2025: Implemented asynchronous email campaign processing to prevent worker timeouts
- August 8, 2025: Added background task management system with real-time progress monitoring
- August 8, 2025: Updated both admin email campaigns and news campaign sending to use background processing
- August 8, 2025: Added database fields for tracking email campaign status and progress
- August 8, 2025: Implemented real-time progress bars and status updates in admin interface
- August 8, 2025: Moved Email Server Testing block from main admin dashboard to email campaigns page for better organization
- August 18, 2025: Enhanced "Dead" achievement with complex multi-condition formula: speed >30 km/h for 3+ seconds with PWM=100, followed by PWM=0 and staying <3 for 5 seconds
- August 18, 2025: **IMPORTANT**: When deploying to new servers, manually update Dead achievement formula in database from 'max_speed >= 200' to 'dead_condition_met' via /admin/achievements or SQL command