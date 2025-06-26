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