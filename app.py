import os
import logging
import random
import re
import shutil
import threading
import time
import json
import tempfile
from datetime import datetime, timedelta
from collections import defaultdict
from functools import wraps

import psutil
import pandas as pd
from dotenv import load_dotenv
from flask import (Flask, render_template, request, jsonify, send_file, 
                  url_for, send_from_directory, flash, redirect, abort)
from flask_migrate import Migrate
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.utils import secure_filename
from flask_babel import Babel, gettext as _, get_locale
from extensions import db
from utils.csv_processor import process_csv_file, detect_csv_type
from utils.image_generator import generate_frames, create_preview_frame
from utils.video_creator import create_video
from utils.background_processor import process_project, stop_project_processing
from utils.env_setup import setup_env_variables
from utils.email_sender import send_email
from forms import (LoginForm, RegistrationForm, ProfileForm, 
                  ChangePasswordForm, ForgotPasswordForm, ResetPasswordForm, DeleteAccountForm, NewsForm, EmailCampaignForm)
from models import User, Project, EmailCampaign, News, Preset
import markdown
from sqlalchemy import desc

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Add markdown filter to the Jinja environment
def markdown_filter(text):
    if text:
        return markdown.markdown(text, extensions=['fenced_code', 'tables'])
    return ''

app = Flask(__name__)
app.jinja_env.filters['markdown'] = markdown_filter

# Load environment variables from .env file
load_dotenv()

app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', os.urandom(32))
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL')
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_recycle': 300,
    'pool_pre_ping': True,
}
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size
app.config['WTF_CSRF_ENABLED'] = True
app.config['BABEL_DEFAULT_LOCALE'] = 'en'

# Session settings
app.config['SESSION_PERMANENT'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=180)  # 6 months

# Add Mail configuration
app.config['MAIL_SERVER'] = os.environ.get('SMTP_SERVER')
app.config['MAIL_PORT'] = int(os.environ.get('SMTP_PORT', 465))
app.config['MAIL_USERNAME'] = os.environ.get('SMTP_LOGIN')
app.config['MAIL_PASSWORD'] = os.environ.get('SMTP_PASSWORD')
app.config['MAIL_USE_TLS'] = False
app.config['MAIL_USE_SSL'] = True

# Initialize used_folders as an empty set
used_folders = set()

# Initialize Babel
babel = Babel(app)

def get_locale():
    # Try to get locale from query string
    locale = request.args.get('lang')
    if locale in ['en', 'ru']:
        return locale
    # Try to get locale from user settings
    if current_user.is_authenticated and hasattr(current_user, 'locale'):
        if current_user.locale in ['en', 'ru']:
            return current_user.locale
    # Try to get locale from request header
    best_match = request.accept_languages.best_match(['en', 'ru'])
    if best_match:
        return best_match
    # Default to English if no locale is found
    return 'en'

# Configure Babel with locale selector
babel.init_app(app, locale_selector=get_locale)

# Make get_locale available in templates
app.jinja_env.globals['get_locale'] = get_locale

# Project name characters
PROJECT_NAME_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

def generate_project_name():
    """Generate a random 5-character project name"""
    return ''.join(random.choice(PROJECT_NAME_CHARS) for _ in range(5))

def validate_project_name(name):
    """Validate project name"""
    if not name:
        return False
    # Allow alphanumeric characters, dashes, and underscores
    # with length between 1 and 7 characters
    return bool(re.match(r'^[\w\d-]{1,7}$', name))

def cleanup_project_files(project):
    """Delete all files associated with a project"""
    try:
        # Delete CSV file
        if project.csv_file:
            csv_path = os.path.join('uploads', project.csv_file)
            if os.path.exists(csv_path):
                os.remove(csv_path)
                logging.info(f"Deleted CSV file: {csv_path}")

        # Delete preview file
        preview_path = os.path.join('previews', f'{project.id}_preview.png')
        if os.path.exists(preview_path):
            os.remove(preview_path)
            logging.info(f"Deleted preview file: {preview_path}")

        # Delete video file
        if project.video_file:
            video_path = os.path.join('videos', project.video_file)
            if os.path.exists(video_path):
                os.remove(video_path)
                logging.info(f"Deleted video file: {video_path}")

        # Delete frames directory
        frames_dir = f'frames/project_{project.folder_number}'
        if os.path.exists(frames_dir):
            shutil.rmtree(frames_dir)
            logging.info(f"Deleted frames directory: {frames_dir}")

        # Delete processed CSV file
        if project.csv_file:
            processed_csv = os.path.join('processed_data', f'project_{project.folder_number}_{project.csv_file}')
            if os.path.exists(processed_csv):
                os.remove(processed_csv)
                logging.info(f"Deleted processed CSV file: {processed_csv}")

        return True
    except Exception as e:
        logging.error(f"Error cleaning up project files: {str(e)}")
        return False

def cleanup_expired_projects():
    """Check and remove expired projects"""
    while True:
        try:
            with app.app_context():
                # Find all expired projects
                expired_projects = Project.query.filter(
                    Project.expiry_date <= datetime.utcnow()
                ).all()

                for project in expired_projects:
                    logging.info(f"Cleaning up expired project {project.id}")

                    # Delete associated files
                    if cleanup_project_files(project):
                        # Delete project from database
                        db.session.delete(project)
                        logging.info(f"Deleted expired project {project.id} from database")
                    else:
                        logging.error(f"Failed to clean up files for project {project.id}")

                db.session.commit()

        except Exception as e:
            logging.error(f"Error in cleanup task: {str(e)}")

        # Sleep for 1 hour before next cleanup
        time.sleep(3600)

# Initialize Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Please log in to access this page.'

@login_manager.user_loader
def load_user(id):
    return User.query.get(int(id))

# Add admin required decorator after the login_manager setup
def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            abort(403)
        return f(*args, **kwargs)
    return decorated_function

# Add this new route before the app.context_processor
def get_system_stats():
    """Get system resource usage statistics"""
    cpu_percent = psutil.cpu_percent()
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage('/')

    # GPU stats - return 0 if not available
    gpu_percent = 0
    try:
        import GPUtil
        gpus = GPUtil.getGPUs()
        if gpus:
            gpu_percent = gpus[0].load * 100
    except:
        pass

    return {
        'cpu_percent': cpu_percent,
        'memory_percent': memory.percent,
        'disk_percent': disk.percent,
        'gpu_percent': gpu_percent
    }


# Global variable for storing statistics
system_stats_history = {
    'cpu': defaultdict(list),
    'memory': defaultdict(list),
    'disk': defaultdict(list),
    'gpu': defaultdict(list)
}

stats_lock = threading.Lock()

def collect_system_stats():
    """Background thread to collect system statistics"""
    while True:
        stats = get_system_stats()
        current_time = datetime.utcnow()

        with stats_lock:
            # Store stats with timestamp
            for resource in ['cpu', 'memory', 'disk', 'gpu']:
                system_stats_history[resource][current_time.strftime('%Y-%m-%d %H:%M')] = stats[f'{resource}_percent']

            # Clean up old data (keep last 24 hours)
            cleanup_time = current_time - timedelta(hours=24)
            for resource in system_stats_history:
                system_stats_history[resource] = {
                    k: v for k, v in system_stats_history[resource].items()
                    if datetime.strptime(k, '%Y-%m-%d %H:%M') > cleanup_time
                }

        time.sleep(60)  # Collect stats every minute

@app.route('/admin')
@login_required
@admin_required
def admin_dashboard():
    # Get system stats
    stats = get_system_stats()

    # Get paginated projects
    project_page = request.args.get('project_page', 1, type=int)
    projects = Project.query.order_by(Project.created_at.desc())\
        .paginate(page=project_page, per_page=20, error_out=False)

    # Get paginated recent users (registered in the last 30 days)
    user_page = request.args.get('user_page', 1, type=int)
    today = datetime.utcnow().date()
    users = User.query.filter(User.created_at >= today - timedelta(days=30))\
        .order_by(User.created_at.desc())\
        .paginate(page=user_page, per_page=20, error_out=False)

    return render_template('admin/dashboard.html', 
                         projects=projects,
                         users=users,
                         today=today,
                         **stats)

@app.route('/admin/stats')
@login_required
@admin_required
def admin_stats():
    """API endpoint to get updated system stats"""
    current_stats = get_system_stats()

    # Add historical data
    with stats_lock:
        history = {
            resource: list(system_stats_history[resource].items())
            for resource in system_stats_history
        }

    return jsonify({
        'current': current_stats,
        'history': history
    })

@app.route('/admin/lists')
@login_required
@admin_required
def admin_lists():
    """API endpoint to get updated users and projects lists"""
    project_page = request.args.get('project_page', 1, type=int)
    user_page = request.args.get('user_page', 1, type=int)
    today = datetime.utcnow().date()

    # Get paginated projects
    projects = Project.query.order_by(Project.created_at.desc())\
        .paginate(page=project_page, per_page=20, error_out=False)

    # Get paginated recent users
    users = User.query.filter(User.created_at >= today - timedelta(days=30))\
        .order_by(User.created_at.desc())\
        .paginate(page=user_page, per_page=20, error_out=False)

    # Format users data with additional fields
    users_data = [{
        'id': u.id,
        'name': u.name,
        'email': u.email,
        'created_at': u.created_at.strftime('%Y-%m-%d %H:%M'),
        'is_email_confirmed': u.is_email_confirmed,
        'is_new': u.created_at.date() == today,
        'is_admin': u.is_admin
    } for u in users.items]

    # Format projects data with additional fields
    projects_data = [{
        'id': p.id,
        'user_name': p.user.name,
        'user_email': p.user.email,
        'name': p.name,
        'status': p.status,
        'created_at': p.created_at.strftime('%Y-%m-%d %H:%M'),
        'progress': int(p.progress),  # Round progress to integer
        'duration': p.get_duration_str(),  # Add duration
        'time_until_expiry': p.time_until_expiry(),  # Add expiry time
        'processing_time': p.get_processing_time_str(),  # Add processing time
        'fps': f"{p.fps:.2f}" if p.fps else '-',  # Add FPS
        'resolution': p.resolution or '-'  # Add resolution
    } for p in projects.items]

    return jsonify({
        'projects': {
            'items': projects_data,
            'has_next': projects.has_next,
            'has_prev': projects.has_prev,
            'page': projects.page,
            'pages': projects.pages,
            'total': projects.total
        },
        'users': {
            'items': users_data,
            'has_next': users.has_next,
            'has_prev': users.has_prev,
            'page': users.page,
            'pages': users.pages,
            'total': users.total
        }
    })

# Add context processor for datetime
@app.context_processor
def inject_now():
    return {'now': datetime.utcnow()}

# Create required directories with proper error handling
for directory in ['uploads', 'frames', 'videos', 'processed_data', 'previews']:
    try:
        os.makedirs(directory, exist_ok=True)
        logging.info(f"Ensuring directory exists: {directory}")
    except Exception as e:
        logging.error(f"Error creating directory {directory}: {str(e)}")
        raise

db.init_app(app)
migrate = Migrate(app, db)


# Authentication routes
@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user is None or not user.check_password(form.password.data):
            flash('Invalid email or password')
            return redirect(url_for('login'))
        if not user.is_email_confirmed:
            flash('Please confirm your email address before logging in.')
            return redirect(url_for('login'))
        login_user(user, remember=True)  # Remember user session for 6 months
        return redirect(url_for('index'))
    return render_template('login.html', form=form)

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    form = RegistrationForm()
    if form.validate_on_submit():
        if User.query.filter_by(email=form.email.data).first():
            flash('This email is already registered')
            return redirect(url_for('register'))

        # Check if this is the first user
        is_first_user = User.query.count() == 0

        user = User(
            email=form.email.data,
            name=form.name.data,
            is_admin=is_first_user  # Set admin status based on whether this is the first user
        )
        user.set_password(form.password.data)
        confirmation_token = user.generate_email_confirmation_token()
        db.session.add(user)

        try:
            db.session.commit()

            # Get user's preferred language
            user_locale = request.accept_languages.best_match(['en', 'ru'])

            # Prepare email content based on locale
            confirmation_link = url_for('confirm_email', token=confirmation_token, _external=True)
            if user_locale == 'ru':
                confirmation_html = f"""
                <h2>Подтвердите регистрацию</h2>
                <p>Здравствуйте, {user.name},</p>
                <p>Спасибо за регистрацию в EUCTelemetry. Пожалуйста, нажмите на ссылку ниже, чтобы подтвердить ваш email:</p>
                <p><a href="{confirmation_link}">{confirmation_link}</a></p>
                <p>Эта ссылка будет действительна в течение 24 часов.</p>
                <p>С наилучшими пожеланиями,<br>Команда EUCTelemetry</p>
                """
            else:
                confirmation_html = f"""
                <h2>Confirm Your Registration</h2>
                <p>Hello {user.name},</p>
                <p>Thank you for registering with EUCTelemetry. Please click the link below to confirm your email address:</p>
                <p><a href="{confirmation_link}">{confirmation_link}</a></p>
                <p>This link will expire in 24 hours.</p>
                <p>Best regards,<br>EUCTelemetry Team</p>
                """

            if send_email(user.email, "Confirm Your Email Address", confirmation_html):
                flash(_('Please check your email to complete registration.'))
            else:
                flash(_('Error sending confirmation email. Please try registering again.'))
                db.session.delete(user)
                db.session.commit()

            return redirect(url_for('login'))

        except Exception as e:
            db.session.rollback()
            logging.error(f"Registration error: {str(e)}")
            flash(_('An error occurred during registration. Please try again later.'))
            return redirect(url_for('register'))

    return render_template('register.html', form=form)

@app.route('/confirm/<token>')
def confirm_email(token):
    user = User.query.filter_by(email_confirmation_token=token).first()

    if not user:
        flash(_('Invalid confirmation link.'))
        return redirect(url_for('login'))

    if user.email_confirmation_sent_at < datetime.utcnow() - timedelta(days=1):
        flash(_('This confirmation link has expired. Please register again.'))
        db.session.delete(user)
        db.session.commit()
        return redirect(url_for('register'))

    user.is_email_confirmed = True
    user.email_confirmation_token = None
    db.session.commit()

    flash(_('Your email has been confirmed! You can now log in.'))
    return redirect(url_for('login'))

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/profile', methods=['GET', 'POST'])
@login_required
def profile():
    profile_form = ProfileForm(obj=current_user)
    password_form = ChangePasswordForm()
    delete_form = DeleteAccountForm()

    if profile_form.validate_on_submit():
        current_user.name = profile_form.name.data
        current_user.subscribed_to_emails = profile_form.subscribed_to_emails.data
        # Save the selected locale
        locale = request.form.get('locale')
        if locale in ['en', 'ru']:
            current_user.locale = locale
        db.session.commit()
        flash(_('Profile updated successfully'))
        return redirect(url_for('profile'))

    return render_template('profile.html', 
                         profile_form=profile_form, 
                         password_form=password_form,
                         delete_form=delete_form)

@app.route('/delete_account', methods=['POST'])
@login_required
def delete_account():
    form = DeleteAccountForm()
    if form.validate_on_submit():
        if current_user.check_password(form.password.data):
            # Delete all user's projects first
            projects = Project.query.filter_by(user_id=current_user.id).all()
            for project in projects:
                # Delete project files
                if project.csv_file:
                    csv_path = os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file)
                    if os.path.exists(csv_path):
                        os.remove(csv_path)

                # Delete preview file
                preview_path = os.path.join('previews', f'{project.id}_preview.png')
                if os.path.exists(preview_path):
                    os.remove(preview_path)

                if project.video_file:
                    video_path = os.path.join('videos', project.video_file)
                    if os.path.exists(video_path):
                        os.remove(video_path)

                # Delete frames directory
                frames_dir = f'frames/project_{project.folder_number}'
                if os.path.exists(frames_dir):
                    shutil.rmtree(frames_dir)

                # Delete processed CSV file
                if project.csv_file:
                    processed_csv = os.path.join('processed_data', f'project_{project.folder_number}_{project.csv_file}')
                    if os.path.exists(processed_csv):
                        os.remove(processed_csv)

            # Delete all projects from database
            Project.query.filter_by(user_id=current_user.id).delete()

            # Delete the user
            db.session.delete(current_user)
            db.session.commit()

            flash('Your account has been successfully deleted')
            return redirect(url_for('index'))
        else:
            flash('Incorrect password')
    return redirect(url_for('profile'))


@app.route('/')
def index():
    if not current_user.is_authenticated:
        return redirect(url_for('home'))
    return render_template('index.html')

@app.route('/home')
def home():
    return render_template('home.html')

@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/upload', methods=['POST'])
@login_required
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': _('No file provided')}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': _('No file selected')}), 400

    project_name = request.form.get('project_name', '').strip()

    # Validate project name
    if project_name:
        if not validate_project_name(project_name):
            return jsonify({'error': _('Invalid project name. Use up to 7 letters, numbers, dashes or underscores.')}), 400
    else:
        project_name = generate_project_name()

    try:
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        # Try to detect CSV type and validate format
        try:
            import pandas as pd
            # Try reading with different encodings
            try:
                df = pd.read_csv(file_path, encoding='utf-8')
            except UnicodeDecodeError:
                try:
                    df = pd.read_csv(file_path, encoding='latin1')
                except:
                    os.remove(file_path)
                    return jsonify({'error': 'Invalid file encoding. Please ensure your CSV file is properly encoded.'}), 400

            # Check for DarknessBot format
            darkness_bot_columns = {'Date', 'Speed', 'GPS Speed', 'Voltage', 'Temperature', 
                                      'Current', 'Battery level', 'Total mileage', 'PWM', 'Power'}
            # Check for WheelLog format
            wheellog_columns = {'date', 'speed', 'gps_speed', 'voltage', 'system_temp',
                                  'current', 'battery_level', 'totaldistance', 'pwm', 'power'}

            df_columns = set(df.columns)
            is_darkness_bot = len(darkness_bot_columns.intersection(df_columns)) >= len(darkness_bot_columns) * 0.8
            is_wheellog = len(wheellog_columns.intersection(df_columns)) >= len(wheellog_columns) * 0.8

            if not (is_darkness_bot or is_wheellog):
                os.remove(file_path)
                return jsonify({'error': 'Invalid CSV format. Please upload a CSV file from DarknessBot or WheelLog.'}), 400

            csv_type = 'darnkessbot' if is_darkness_bot else 'wheellog'

        except Exception as e:
            logging.error(f"Error validating CSV format: {str(e)}")
            os.remove(file_path)
            return jsonify({'error': 'Invalid CSV file. Please upload a CSV file from DarknessBot or WheelLog.'}), 400

        # Create project with detected type and user_id
        project = Project(
            name=project_name,
            csv_file=filename,
            csv_type=csv_type,
            created_at=datetime.now(),
            expiry_date=datetime.now() + timedelta(hours=48),
            status='pending',
            folder_number=Project.get_next_folder_number(),
            user_id=current_user.id
        )
        db.session.add(project)
        db.session.commit()

        # Create initial preview with default settings
        default_settings = {
            'vertical_position': 1,
            'top_padding': 14,
            'bottom_padding': 41,
            'spacing': 10,
            'font_size': 22,
            'border_radius': 13,
            'show_speed': True,
            'show_max_speed': True,
            'show_voltage': True,
            'show_temp': True,
            'show_battery': True,
            'show_gps': True,
            'show_mileage': True,
            'show_pwm': True,
            'show_power': True,
            'show_current': True,
            'show_bottom_elements': True,
            'indicator_x': 50,
            'indicator_y': 80,
            'speed_y': 0,
            'unit_y': 0,
            'speed_size': 100,
            'unit_size': 100,
            'indicator_scale': 100
        }

        preview_path = create_preview_frame(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project.id,
            'fullhd',
            default_settings
        )

        return jsonify({
            'success': True,
            'project_id': project.id
        })

    except Exception as e:
        logging.error(f"Error processing upload: {str(e)}")
        # Clean up file if it was saved
        if 'file_path' in locals() and os.path.exists(file_path):
            os.remove(file_path)
        return jsonify({'error': str(e)}), 500

@app.route('/generate_frames/<int:project_id>', methods=['POST'])
@login_required
def generate_project_frames(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    try:
        # Get settings from request
        data = request.get_json() if request.is_json else {}
        resolution = data.get('resolution', 'fullhd')
        fps = float(data.get('fps', 29.97))
        codec = data.get('codec', 'h264')
        interpolate_values = data.get('interpolate_values', True)

        # Get text display settings with explicit defaults
        text_settings = {
            'vertical_position': int(data.get('vertical_position', 50)),
            'top_padding': int(data.get('top_padding', 10)),
            'bottom_padding': int(data.get('bottom_padding', 30)),
            'spacing': int(data.get('spacing', 20)),
            'font_size': int(data.get('font_size', 26)),
            'border_radius': int(data.get('border_radius', 13)),
            'indicator_x': float(data.get('indicator_x', 50)),
            'indicator_y': float(data.get('indicator_y', 80)),
            'speed_y': int(data.get('speed_y', 0)),
            'unit_y': int(data.get('unit_y', 0)),
            'speed_size': float(data.get('speed_size', 100)),
            'unit_size': float(data.get('unit_size', 100)),
            'indicator_scale': float(data.get('indicator_scale', 100)),
            # Add visibility settings with explicit defaults
            'show_speed': data.get('show_speed', True),
            'show_max_speed': data.get('show_max_speed', True),
            'show_voltage': data.get('show_voltage', True),
            'show_temp': data.get('show_temp', True),
            'show_battery': data.get('show_battery', True),
            'show_mileage': data.get('show_mileage', True),
            'show_pwm': data.get('show_pwm', True),
            'show_power': data.get('show_power', True),
            'show_current': data.get('show_current', True),  # Add current visibility setting
            'show_gps': data.get('show_gps', False),
            'show_bottom_elements': data.get('show_bottom_elements', True)
        }

        logging.info(f"Starting processing with settings: {text_settings}, interpolate_values: {interpolate_values}")

        # Update project settings immediately
        project.fps = fps
        project.resolution = resolution
        project.codec = codec
        project.processing_started_at = datetime.now()
        db.session.commit()

        # Get user's preferred locale
        user_locale = 'ru' if current_user.is_authenticated and hasattr(current_user, 'locale') and current_user.locale == 'ru' else 'en'

        # Start background processing with text settings, interpolation flag and locale
        process_project(project_id, resolution, fps, codec, text_settings, interpolate_values, locale=user_locale)

        return jsonify({'success': True, 'message': 'Processing started'})
    except Exception as e:
        logging.error(f"Error starting processing: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/project_status/<int:project_id>')
@login_required
def project_status(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    return jsonify({
        'status': project.status,
        'frame_count': project.frame_count,
        'video_file': project.video_file,
        'error_message': project.error_message,
        'progress': project.progress,  # Add progress to the response
        'processing_time': project.get_processing_time_str()
    })

@app.route('/check_processing_projects', methods=['GET'])
@login_required
def check_processing_projects():
    """Check the number of projects currently in 'processing' status for the user"""
    try:
        processing_count = Project.query.filter_by(
            user_id=current_user.id,
            status='processing'
        ).count()
        
        return jsonify({
            'count': processing_count,
            'can_process_more': processing_count < 2  # Limit is 2 processing projects
        })
    except Exception as e:
        logging.error(f"Error in check_processing_projects: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/projects')
@login_required
def list_projects():
    page = request.args.get('page', 1, type=int)
    projects = Project.query.filter_by(user_id=current_user.id)\
        .order_by(Project.created_at.desc())\
        .paginate(page=page, per_page=10, error_out=False)
    return render_template('projects.html', projects=projects)

@app.route('/download/<int:project_id>/<type>')
@login_required
def download_file(project_id, type):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    if type == 'video' and project.video_file:
        return send_file(f'videos/{project.video_file}')
    elif type == 'frames':
        # TODO: Implement frame download as ZIP
        pass
    elif type == 'processed_csv':
        processed_csv = os.path.join('processed_data', f'project_{project.folder_number}_{project.csv_file}')
        if os.path.exists(processed_csv):
            return send_file(processed_csv, as_attachment=True, 
                           downloadname=f'processed_{project.csv_file}')

    return jsonify({'error': 'File not found'}), 404

@app.route('/delete/<int:project_id>', methods=['POST'])
@login_required
def delete_project(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    try:
        # Delete associated files if they exist
        if project.csv_file:
            csv_path = os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file)
            if os.path.exists(csv_path):
                os.remove(csv_path)

        # Delete preview file if exists
        preview_path = os.path.join('previews', f'{project_id}_preview.png')
        if os.path.exists(preview_path):
            os.remove(preview_path)

        if project.video_file:
            video_path = os.path.join('videos', project.video_file)
            if os.path.exists(video_path):
                os.remove(video_path)

        # Delete frames directory if it exists
        frames_dir = f'frames/project_{project.folder_number}'
        if os.path.exists(frames_dir):
            shutil.rmtree(frames_dir)

        # Delete processed CSV file if exists
        if project.csv_file:
            processed_csv = os.path.join('processed_data', f'project_{project.folder_number}_{project.csv_file}')
            if os.path.exists(processed_csv):
                os.remove(processed_csv)

        # Delete project from database
        db.session.delete(project)
        db.session.commit()

        return jsonify({'success': True})
    except Exception as e:
        logging.error(f"Error deleting project: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/get_csv_timerange/<int:project_id>', methods=['GET'])
@login_required
def get_csv_timerange(project_id):
    """Get the minimum and maximum timestamps of the CSV file"""
    try:
        import pandas as pd
        
        project = Project.query.get_or_404(project_id)
        if project.user_id != current_user.id:
            return jsonify({'error': 'Unauthorized'}), 403

        # Get processed file path
        processed_csv_path = os.path.join('processed_data', f'project_{project.folder_number}_{os.path.basename(project.csv_file)}')
        
        if not os.path.exists(processed_csv_path):
            return jsonify({'error': 'Processed CSV file not found'}), 404
        
        # Load the data and get min/max timestamps
        df = pd.read_csv(processed_csv_path)
        min_timestamp = float(df['timestamp'].min())
        max_timestamp = float(df['timestamp'].max())
        
        # Format timestamps as human-readable date strings
        min_date = datetime.fromtimestamp(min_timestamp).strftime('%Y-%m-%d %H:%M:%S')
        max_date = datetime.fromtimestamp(max_timestamp).strftime('%Y-%m-%d %H:%M:%S')
        
        # Count total rows
        total_rows = len(df)
        
        # Get speed and PWM data for the chart
        chart_data = {
            'timestamps': df['timestamp'].tolist(),
            'speed_values': df['speed'].tolist(),
            'pwm_values': df['pwm'].tolist()
        }
        
        return jsonify({
            'success': True, 
            'min_timestamp': min_timestamp,
            'max_timestamp': max_timestamp,
            'min_date': min_date,
            'max_date': max_date,
            'total_rows': total_rows,
            'chart_data': chart_data
        })
        
    except Exception as e:
        logging.error(f"Error getting CSV time range: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/trim_csv/<int:project_id>', methods=['POST'])
@login_required
def trim_csv(project_id):
    """Trim CSV file to the specified time range"""
    try:
        from utils.csv_processor import trim_csv_data
        
        project = Project.query.get_or_404(project_id)
        if project.user_id != current_user.id:
            return jsonify({'error': 'Unauthorized'}), 403
        
        # Get start and end timestamps from request
        data = request.json
        start_timestamp = float(data.get('start_timestamp'))
        end_timestamp = float(data.get('end_timestamp'))
        
        if start_timestamp >= end_timestamp:
            return jsonify({'error': 'Start timestamp must be less than end timestamp'}), 400
        
        # Trim the CSV data
        trim_csv_data(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project.folder_number,
            start_timestamp,
            end_timestamp
        )
        
        # Get settings from request for preview update
        resolution = data.get('resolution', 'fullhd')
        text_settings = {
            'vertical_position': int(data.get('vertical_position', 50)),
            'top_padding': int(data.get('top_padding', 10)),
            'bottom_padding': int(data.get('bottom_padding', 30)),
            'spacing': int(data.get('spacing', 20)),
            'font_size': int(data.get('font_size', 26)),
            'border_radius': int(data.get('border_radius', 13)),
            'indicator_x': float(data.get('indicator_x', 50)),
            'indicator_y': float(data.get('indicator_y', 80)),
            'speed_y': int(data.get('speed_y', 0)),
            'unit_y': int(data.get('unit_y', 0)),
            'speed_size': float(data.get('speed_size', 100)),
            'unit_size': float(data.get('unit_size', 100)),
            'indicator_scale': float(data.get('indicator_scale', 100)),
            'show_speed': data.get('show_speed', True),
            'show_max_speed': data.get('show_max_speed', True),
            'show_voltage': data.get('show_voltage', True),
            'show_temp': data.get('show_temp', True),
            'show_battery': data.get('show_battery', True),
            'show_gps': data.get('show_gps', True),
            'show_mileage': data.get('show_mileage', True),
            'show_pwm': data.get('show_pwm', True),
            'show_power': data.get('show_power', True),
            'show_current': data.get('show_current', True),
            'show_bottom_elements': data.get('show_bottom_elements', True)
        }
        
        # Get user's preferred locale
        user_locale = 'ru' if current_user.is_authenticated and hasattr(current_user, 'locale') and current_user.locale == 'ru' else 'en'
        
        # Update preview after trimming
        preview_path = create_preview_frame(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project.id,
            resolution,
            text_settings,
            locale=user_locale
        )
        
        # Get updated time range
        import pandas as pd
        processed_csv_path = os.path.join('processed_data', f'project_{project.folder_number}_{os.path.basename(project.csv_file)}')
        df = pd.read_csv(processed_csv_path)
        min_timestamp = float(df['timestamp'].min())
        max_timestamp = float(df['timestamp'].max())
        total_rows = len(df)
        
        # Get speed and PWM data for the chart
        chart_data = {
            'timestamps': df['timestamp'].tolist(),
            'speed_values': df['speed'].tolist(),
            'pwm_values': df['pwm'].tolist()
        }
        
        return jsonify({
            'success': True, 
            'preview_url': url_for('serve_preview', filename=f'{project.id}_preview.png'),
            'min_timestamp': min_timestamp,
            'max_timestamp': max_timestamp,
            'total_rows': total_rows,
            'chart_data': chart_data
        })
        
    except Exception as e:
        logging.error(f"Error trimming CSV file: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/stop/<int:project_id>', methods=['POST'])
@login_required
def stop_project(project_id):
    """Stop project processing"""
    try:
        project = Project.query.get_or_404(project_id)
        if project.user_id != current_user.id:
            return jsonify({'error': 'Unauthorized'}), 403

        if project.status not in ['processing', 'pending']:
            return jsonify({'error': 'Project is not being processed'}), 400

        from utils.background_processor import stop_project_processing
        if stop_project_processing(project_id):
            return jsonify({'success': True})

        return jsonify({'error': 'Failed to stop project processing'}), 500

    except Exception as e:
        logging.error(f"Error in stop_project route: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/change_password', methods=['POST'])
@login_required
def change_password():
    form = ChangePasswordForm()
    if form.validate_on_submit():
        if current_user.check_password(form.current_password.data):
            current_user.set_password(form.new_password.data)
            db.session.commit()
            flash('Your password has been updated')
        else:
            flash('Current password is incorrect')
    return redirect(url_for('profile'))

@app.route('/forgot_password', methods=['GET', 'POST'])
def forgot_password():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    form = ForgotPasswordForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user:
            token = user.generate_password_reset_token()
            reset_link = url_for('reset_password', token=token, _external=True)
            reset_html = f"""
            <h2>Password Reset Request</h2>
            <p>Hello {user.name},</p>
            <p>You have requested to reset your password. Please click the link below to set a new password:</p>
            <p><a href="{reset_link}">{reset_link}</a></p>
            <p>This link will expire in 24 hours.</p>
            <p>If you did not request this reset, please ignore this email.</p>
            <p>Best regards,<br>EUCTelemetry Team</p>
            """
            if send_email(user.email, "Password Reset Request", reset_html):
                flash('Check your email for password reset instructions')
            else:
                flash('Error sending password reset email. Please try again later.')
        else:
            flash('Check your email for password reset instructions')  # Security through obscurity
        return redirect(url_for('login'))
    return render_template('forgot_password.html', form=form)

@app.route('/reset_password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    user = User.query.filter_by(password_reset_token=token).first()
    if not user or not user.can_reset_password():
        flash('Invalid or expired password reset link')
        return redirect(url_for('login'))

    form = ResetPasswordForm()
    if form.validate_on_submit():
        user.set_password(form.password.data)
        user.password_reset_token = None
        user.password_reset_sent_at = None
        db.session.commit()
        flash('Your password has been reset')
        return redirect(url_for('login'))
    return render_template('reset_password.html', form=form)

@app.route('/admin/user/<int:user_id>', methods=['PUT'])
@login_required
@admin_required
def update_user(user_id):
    """Update user details from admin panel"""
    try:
        user = User.query.get_or_404(user_id)
        data = request.get_json()

        if 'name' in data:
            user.name = data['name']
        if 'email' in data:
            # Check if email is already taken by another user
            existing_user = User.query.filter_by(email=data['email']).first()
            if existing_user and existing_user.id != user_id:
                return jsonify({'success': False, 'error': 'Email already taken'}), 400
            user.email = data['email']
        if 'is_admin' in data:
            user.is_admin = bool(data['is_admin'])

        db.session.commit()
        return jsonify({
            'success': True,
            'message': 'User updated successfully'
        })
    except Exception as e:
        logging.error(f"Error updating user: {str(e)}")
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/admin/user/<int:user_id>', methods=['DELETE'])
@login_required
@admin_required
def delete_admin_user(user_id):
    """Delete user and all associated data"""
    user = User.query.get_or_404(user_id)

    try:
        # Delete all user's projects first
        projects = Project.query.filter_by(user_id=user.id).all()
        for project in projects:
            if not cleanup_project_files(project):
                return jsonify({'error': f'Failed to clean up files for project {project.id}'}), 500
            db.session.delete(project)

        # Delete the user
        db.session.delete(user)
        db.session.commit()

        return jsonify({'success': True})

    except Exception as e:
        db.session.rollback()
        logging.error(f"Error deleting user: {str(e)}")
        return jsonify({'error': str(e)}), 500

import os
# Add this new endpoint after other admin routes
@app.route('/admin/cleanup-storage', methods=['POST'])
@login_required
@admin_required
def cleanup_storage():
    """Clean up unused files from storage directories"""
    try:
        # Get all project files from database
        projects = Project.query.all()
        used_files = set()

        # Collect all files that are used by projects
        for project in projects:
            if project.csv_file:
                used_files.add(project.csv_file)  # uploads directory
                used_files.add(f'project_{project.folder_number}_{project.csv_file}')  # processed_data directory
            if project.video_file:
                used_files.add(project.video_file)  # videos directory
            used_files.add(f'{project.id}_preview.png')  # previews directory
            # frames directory is handled by folder name
            used_folders.add(f'project_{project.folder_number}')  # frames directory

        deleted_files = []
        deleted_count = 0

        # Check uploads directory
        for filename in os.listdir('uploads'):
            if filename not in used_files:
                file_path = os.path.join('uploads', filename)
                try:
                    os.remove(file_path)
                    deleted_files.append(f'uploads/{filename}')
                    deleted_count += 1
                    logging.info(f"Deleted unused file: {file_path}")
                except Exception as e:
                    logging.error(f"Error deleting file {file_path}: {str(e)}")

        # Check previews directory
        for filename in os.listdir('previews'):
            if filename not in used_files:
                file_path = os.path.join('previews', filename)
                try:
                    os.remove(file_path)
                    deleted_files.append(f'previews/{filename}')
                    deleted_count += 1
                    logging.info(f"Deleted unused file: {file_path}")
                except Exception as e:
                    logging.error(f"Error deleting file {file_path}: {str(e)}")

        # Check videos directory
        for filename in os.listdir('videos'):
            if filename not in used_files:
                file_path = os.path.join('videos', filename)
                try:
                    os.remove(file_path)
                    deleted_files.append(f'videos/{filename}')
                    deleted_count += 1
                    logging.info(f"Deleted unused file: {file_path}")
                except Exception as e:
                    logging.error(f"Error deleting file {file_path}: {str(e)}")

        # Check processed_data directory
        for filename in os.listdir('processed_data'):
            if filename not in used_files:
                file_path = os.path.join('processed_data', filename)
                try:
                    os.remove(file_path)
                    deleted_files.append(f'processed_data/{filename}')
                    deleted_count += 1
                    logging.info(f"Deleted unused file: {file_path}")
                except Exception as e:
                    logging.error(f"Error deleting file {file_path}: {str(e)}")

        # Check frames directory
        for foldername in os.listdir('frames'):
            if foldername not in used_folders:
                folder_path = os.path.join('frames', foldername)
                try:
                    if os.path.isdir(folder_path):
                        shutil.rmtree(folder_path)
                        deleted_files.append(f'frames/{foldername}')
                        deleted_count += 1
                        logging.info(f"Deleted unused folder: {folder_path}")
                except Exception as e:
                    logging.error(f"Error deleting folder {folder_path}: {str(e)}")

        return jsonify({
            'success': True,
            'deleted_count': deleted_count,
            'deleted_files': deleted_files
        })

    except Exception as e:
        logging.error(f"Error during storage cleanup: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/set_language/<lang>')
def set_language(lang):
    if lang not in ['en', 'ru']:
        return redirect(request.referrer or url_for('index'))

    # Save language preference for logged in users
    if current_user.is_authenticated:
        current_user.locale = lang
        db.session.commit()

    # Store language in query parameter for the redirect
    next_url = request.referrer or url_for('index')
    if '?' in next_url:
        next_url = next_url.split('?')[0]
    next_url = f"{next_url}?lang={lang}"

    return redirect(next_url)

# Add new route for unsubscribe
@app.route('/unsubscribe/<token>')
def unsubscribe(token):
    user = User.query.filter_by(email_confirmation_token=token).first()
    if not user:
        flash(_('Invalid unsubscribe link.'))
        return redirect(url_for('index'))

    user.subscribed_to_emails = False
    user.email_confirmation_token = None  # Clear the token
    db.session.commit()

    flash(_('You have been successfully unsubscribed from email notifications.'))
    if current_user.is_authenticated:
        return redirect(url_for('profile'))
    return redirect(url_for('index'))

@app.route('/admin/email-campaigns', methods=['GET', 'POST'])
@login_required
@admin_required
def email_campaigns():
    form = EmailCampaignForm()
    if form.validate_on_submit():
        try:
            # Get all subscribed users
            subscribed_users = User.query.filter_by(subscribed_to_emails=True).all()
            if not subscribed_users:
                flash(_('No subscribed users found.'))
                return redirect(url_for('email_campaigns'))

            # Create campaign record
            campaign = EmailCampaign(
                subject=form.subject.data,
                html_content=form.html_content.data,
                sender_id=current_user.id,
                recipients_count=len(subscribed_users)
            )
            db.session.add(campaign)
            db.session.commit()

            # Send emails to all subscribed users
            for user in subscribed_users:
                # Generate unsubscribe token for this user
                unsubscribe_token = user.generate_unsubscribe_token()
                user.email_confirmation_token = unsubscribe_token
                db.session.commit()

                # Add unsubscribe link to email content
                unsubscribe_url = url_for('unsubscribe', token=unsubscribe_token, _external=True)

                # Get user's preferred language
                user_locale = user.locale or 'en'

                # Add localized unsubscribe text
                if user_locale == 'ru':
                    footer = f"""
                    <hr>
                    <p style="font-size: 12px; color: #666;">
                        Чтобы отписаться от рассылки, <a href="{unsubscribe_url}">нажмите здесь</a>.
                    </p>
                    """
                else:
                    footer = f"""
                    <hr>
                    <p style="font-size: 12px; color: #666;">
                        To unsubscribe from these emails, <a href="{unsubscribe_url}">click here</a>.
                    </p>
                    """

                # Combine content with footer
                full_content = form.html_content.data + footer

                # Send email
                if not send_email(user.email, form.subject.data, full_content):
                    flash(_('Error sending email to %(email)s', email=user.email))

            flash(_('Campaign sent successfully to %(count)d users.', count=len(subscribed_users)))
            return jsonify({'success': True, 'message': _('Campaign sent successfully.')})

        except Exception as e:
            db.session.rollback()
            logging.error(f"Error sending campaign: {str(e)}")
            return jsonify({'success': False, 'error': str(e)})

    campaigns = EmailCampaign.query.order_by(EmailCampaign.created_at.desc()).all()
    return render_template('admin/email_campaigns.html', form=form, campaigns=campaigns)

@app.route('/admin/campaign/<int:campaign_id>')
@login_required
@admin_required
def view_campaign(campaign_id):
    """API endpoint to get campaign details for viewing"""
    campaign = EmailCampaign.query.get_or_404(campaign_id)
    # Convert markdown to HTML for display
    html_content = markdown_filter(campaign.html_content)
    return jsonify({
        'id': campaign.id,
        'subject': campaign.subject,
        'html_content': html_content,
        'created_at': campaign.created_at.strftime('%Y-%m-%d %H:%M'),
        'recipients_count': campaign.recipients_count
    })

with app.app_context():
    db.create_all()

# Start collecting stats when the app starts
stats_thread = threading.Thread(target=collect_system_stats, daemon=True)
stats_thread.start()

# Start cleanup thread when app starts
cleanup_thread = threading.Thread(target=cleanup_expired_projects, daemon=True)
cleanup_thread.start()

# Add to imports at the top
from forms import NewsForm
from models import News
import markdown
from sqlalchemy import desc

# Add these routes after existing routes

@app.route('/news')
def news_list():
    page = request.args.get('page', 1, type=int)
    news = News.query.order_by(desc(News.created_at)).paginate(
        page=page, per_page=10, error_out=False
    )
    return render_template('news/list.html', news=news)

@app.route('/news/create', methods=['GET', 'POST'])
@login_required
@admin_required
def news_create():
    form = NewsForm()
    if form.validate_on_submit():
        news = News(
            title=form.title.data,
            content=form.content.data,
            author_id=current_user.id
        )
        db.session.add(news)
        db.session.commit()
        flash(_('News created successfully'))
        return redirect(url_for('news_list'))
    return render_template('news/edit.html', form=form, is_create=True)

@app.route('/news/<int:id>/edit', methods=['GET', 'POST'])
@login_required
@admin_required
def news_edit(id):
    news = News.query.get_or_404(id)
    form = NewsForm(obj=news)
    if form.validate_on_submit():
        news.title = form.title.data
        news.content = form.content.data
        db.session.commit()
        flash(_('News updated successfully'))
        return redirect(url_for('news_list'))
    return render_template('news/edit.html', form=form, news=news, is_create=False)

@app.route('/news/<int:id>/delete', methods=['POST'])
@login_required
@admin_required
def news_delete(id):
    news = News.query.get_or_404(id)
    db.session.delete(news)
    db.session.commit()
    flash(_('News deleted successfully'))
    return redirect(url_for('news_list'))

@app.route('/news/<int:id>/send-campaign', methods=['POST'])
@login_required
@admin_required
def news_send_campaign(id):
    """Send news as an email campaign to all subscribed users"""
    news = News.query.get_or_404(id)
    
    try:
        # Get all subscribed users
        subscribed_users = User.query.filter_by(subscribed_to_emails=True).all()
        if not subscribed_users:
            flash(_('No subscribed users found.'))
            return redirect(url_for('news_list'))
            
        # Create campaign record
        campaign = EmailCampaign(
            subject=news.title,
            html_content=news.content,  # Using original markdown content
            sender_id=current_user.id,
            recipients_count=len(subscribed_users)
        )
        db.session.add(campaign)
        db.session.commit()
        
        # Convert markdown to HTML for email
        html_content = markdown_filter(news.content)
        
        # Send emails to all subscribed users
        success_count = 0
        for user in subscribed_users:
            # Generate unsubscribe token for this user
            unsubscribe_token = user.generate_unsubscribe_token()
            user.email_confirmation_token = unsubscribe_token
            db.session.commit()
            
            # Add unsubscribe link to email content
            unsubscribe_url = url_for('unsubscribe', token=unsubscribe_token, _external=True)
            
            # Get user's preferred language
            user_locale = user.locale or 'en'
            
            # Add localized unsubscribe text
            if user_locale == 'ru':
                footer = f"""
                <hr>
                <p style="font-size: 12px; color: #666;">
                    Чтобы отписаться от рассылки, <a href="{unsubscribe_url}">нажмите здесь</a>.
                </p>
                """
            else:
                footer = f"""
                <hr>
                <p style="font-size: 12px; color: #666;">
                    To unsubscribe from these emails, <a href="{unsubscribe_url}">click here</a>.
                </p>
                """
                
            # Combine HTML content with footer
            full_content = html_content + footer
            
            # Send email
            if send_email(user.email, news.title, full_content):
                success_count += 1
        
        # Update flash message based on results
        if success_count == len(subscribed_users):
            flash(_('Campaign sent successfully to %(count)d users.', count=success_count))
        else:
            flash(_('Campaign sent to %(success)d out of %(total)d users.', 
                    success=success_count, total=len(subscribed_users)))
            
        return redirect(url_for('news_list'))
            
    except Exception as e:
        db.session.rollback()
        logging.error(f"Error sending news campaign: {str(e)}")
        flash(_('Error sending campaign: %(error)s', error=str(e)), 'error')
        return redirect(url_for('news_list'))

#Adding new routes for preview
@app.route('/previews/<path:filename>')
def serve_preview(filename):
    return send_from_directory('previews', filename)

@app.route('/preview/<int:project_id>', methods=['POST'])
@login_required
def generate_preview(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    try:
        # Get text display settings from request
        data = request.get_json() if request.is_json else {}
        resolution = data.get('resolution', 'fullhd')

        # Get all visibility settings with explicit defaults of True
        text_settings = {
            'vertical_position': int(data.get('vertical_position', 50)),
            'top_padding': int(data.get('top_padding', 10)),
            'bottom_padding': int(data.get('bottom_padding', 30)),
            'spacing': int(data.get('spacing', 20)),
            'font_size': int(data.get('font_size', 26)),
            'border_radius': int(data.get('border_radius', 13)),
            # Speed indicator settings
            'indicator_x': float(data.get('indicator_x', 50)),
            'indicator_y': float(data.get('indicator_y', 80)),
            'speed_y': int(data.get('speed_y', 0)),
            'unit_y': int(data.get('unit_y', 0)),
            'speed_size': float(data.get('speed_size', 100)),
            'unit_size': float(data.get('unit_size', 100)),
            'indicator_scale': float(data.get('indicator_scale', 100)),
            # Visibility settings - default to True unless explicitly set to False
            'show_speed': data.get('show_speed', True),
            'show_max_speed': data.get('show_max_speed', True),
            'show_voltage': data.get('show_voltage', True),
            'show_temp': data.get('show_temp', True),
            'show_battery': data.get('show_battery', True),
            'show_gps': data.get('show_gps', True),
            'show_mileage': data.get('show_mileage', True),
            'show_pwm': data.get('show_pwm', True),
            'show_power': data.get('show_power', True),
            'show_current': data.get('show_current', True),
            'show_bottom_elements': data.get('show_bottom_elements', True)
        }

        logging.info(f"Generating preview with settings: {text_settings}")

        # Get user's preferred locale
        user_locale = 'ru' if current_user.is_authenticated and hasattr(current_user, 'locale') and current_user.locale == 'ru' else 'en'

        preview_path = create_preview_frame(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project.id,
            resolution,
            text_settings,
            locale=user_locale
        )

        return jsonify({'success': True, 'preview_url': url_for('serve_preview', filename=f'{project.id}_preview.png')})

    except Exception as e:
        logging.error(f"Error generating preview: {str(e)}")
        return jsonify({'error': str(e)}), 500

# Add these routes near other route definitions

@app.route('/save_preset', methods=['POST'])
@login_required
def save_preset():
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    settings = data.get('settings', {})

    if not name:
        return jsonify({'error': _('Preset name is required.')}), 400

    try:
        preset = Preset.create_from_form_data(name, settings, current_user.id)
        db.session.add(preset)
        db.session.commit()
        return jsonify({'success': True, 'id': preset.id})
    except Exception as e:
        logging.error(f"Error saving preset: {str(e)}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/get_presets')
@login_required
def get_presets():
    try:
        presets = Preset.query.filter_by(user_id=current_user.id).all()
        presets_list = [{'id': p.id, 'name': p.name} for p in presets]
        return jsonify({'presets': presets_list})
    except Exception as e:
        logging.error(f"Error getting presets: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/get_preset/<int:preset_id>')
@login_required
def get_preset(preset_id):
    preset = Preset.query.get_or_404(preset_id)
    if preset.user_id != current_user.id:
        return jsonify({'error': _('Unauthorized')}), 403
    try:
        return jsonify({
            'settings': preset.get_settings(),
            'name': preset.name,
            'id': preset.id
        })
    except Exception as e:
        logging.error(f"Error getting preset {preset_id}: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/delete_preset/<int:preset_id>', methods=['DELETE'])
@login_required
def delete_preset(preset_id):
    preset = Preset.query.get_or_404(preset_id)
    if preset.user_id != current_user.id:
        return jsonify({'error': _('Unauthorized')}), 403
    try:
        db.session.delete(preset)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        logging.error(f"Error deleting preset {preset_id}: {str(e)}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
        
# Analytics routes
@app.route('/analytics')
@login_required
def analytics():
    """Render the analytics page"""
    return render_template('analytics.html')

@app.route('/analyze_csv', methods=['POST'])
@login_required
def analyze_csv():
    """Process a CSV file for analytics and return data for charts"""
    # Import gettext function directly instead of using _ alias
    from flask_babel import gettext
    
    if 'file' not in request.files:
        return jsonify({'error': gettext('No file provided')}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': gettext('No file selected')}), 400
    
    # Check file size - limit to 50MB to prevent memory issues
    # Read only beginning of the file to get size
    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)  # Reset file pointer to beginning
    
    # 50MB = 50 * 1024 * 1024 bytes
    if file_size > 50 * 1024 * 1024:
        return jsonify({'error': gettext('File is too large. Please upload a CSV file smaller than 50MB.')}), 400
        
    temp_dir = None
    temp_file_path = None
    
    try:
        # Create a temporary file to store the uploaded CSV
        temp_dir = tempfile.mkdtemp()
        temp_file_path = os.path.join(temp_dir, secure_filename(file.filename))
        file.save(temp_file_path)
        
        # Log file size for debugging
        file_size_mb = os.path.getsize(temp_file_path) / (1024 * 1024)
        logging.info(f"Saved CSV file for analytics, size: {file_size_mb:.2f} MB")
        
        # Read and validate CSV file
        try:
            # Try reading with different encodings
            try:
                df = pd.read_csv(temp_file_path, encoding='utf-8')
            except UnicodeDecodeError:
                try:
                    df = pd.read_csv(temp_file_path, encoding='latin1')
                except UnicodeDecodeError:
                    return jsonify({'error': gettext('Invalid file encoding. Please ensure your CSV file is properly encoded.')}), 400
            
            # Detect CSV type
            try:
                csv_type = detect_csv_type(df)
                logging.info(f"Detected CSV type: {csv_type}")
            except ValueError:
                # Check for DarknessBot format
                darkness_bot_columns = {'Date', 'Speed', 'GPS Speed', 'Voltage', 'Temperature', 
                                    'Current', 'Battery level', 'Total mileage', 'PWM', 'Power'}
                # Check for WheelLog format
                wheellog_columns = {'date', 'speed', 'gps_speed', 'voltage', 'system_temp',
                                'current', 'battery_level', 'totaldistance', 'pwm', 'power'}

                df_columns = set(df.columns)
                is_darkness_bot = len(darkness_bot_columns.intersection(df_columns)) >= len(darkness_bot_columns) * 0.8
                is_wheellog = len(wheellog_columns.intersection(df_columns)) >= len(wheellog_columns) * 0.8

                if not (is_darkness_bot or is_wheellog):
                    return jsonify({'error': gettext('Invalid CSV format. Please upload a CSV file from DarknessBot or WheelLog.')}), 400

                csv_type = 'darnkessbot' if is_darkness_bot else 'wheellog'
            
            # Process the CSV file to get standardized data
            csv_type, processed_data = process_csv_file(temp_file_path, interpolate_values=True)
            
            # Log the type of processed_data for debugging
            logging.info(f"Processed data type: {type(processed_data)}")
            if isinstance(processed_data, dict):
                logging.info(f"Dict keys: {list(processed_data.keys())}")
                if 'timestamp' in processed_data:
                    logging.info(f"Timestamp data type: {type(processed_data['timestamp'])}")
                    logging.info(f"Number of timestamps: {len(processed_data['timestamp'])}")
                    
                    # Thin out data for large datasets to prevent browser performance issues
                    # Only thin out data for analytics (not for video generation)
                    if len(processed_data['timestamp']) > 20000:
                        from utils.csv_processor import thin_out_data
                        processed_data = thin_out_data(processed_data, max_rows=20000)
                        logging.info(f"Data thinned out for better performance, now {len(processed_data['timestamp'])} points")
            
            # Convert processed data to a list of dictionaries for JSON serialization
            serializable_data = []
            
            # Check if processed_data is a dict or DataFrame and handle accordingly
            if isinstance(processed_data, pd.DataFrame):
                # For DataFrame format
                for _, row in processed_data.iterrows():
                    row_dict = {}
                    for col in processed_data.columns:
                        value = row[col]
                        # Handle special data types
                        if pd.isna(value):
                            row_dict[col] = None
                        else:
                            row_dict[col] = float(value) if isinstance(value, (int, float)) else str(value)
                    serializable_data.append(row_dict)
            elif isinstance(processed_data, dict):
                # For dictionary format 
                # Process structure like {'timestamp': [...], 'speed': [...], ...}
                if 'timestamp' in processed_data and isinstance(processed_data['timestamp'], (list, tuple)):
                    # Get the number of data points
                    num_points = len(processed_data['timestamp'])
                    
                    # Create a record for each data point
                    for i in range(num_points):
                        record = {}
                        for key, values in processed_data.items():
                            if i < len(values):
                                value = values[i]
                                # Handle special data types
                                if pd.isna(value):
                                    record[key] = None
                                else:
                                    record[key] = float(value) if isinstance(value, (int, float)) else str(value)
                            else:
                                record[key] = None
                        serializable_data.append(record)
                else:
                    # Handle other dictionary formats if needed
                    logging.warning("Unrecognized dictionary data format")
            
            # Calculate achievements
            achievements = []
            
            # Check for "Devil" achievement - max speed over 130 km/h
            max_speed = 0
            try:
                if isinstance(processed_data, dict) and 'speed' in processed_data:
                    # Use an optimized approach for large datasets
                    if len(processed_data['speed']) > 100000:
                        # Process in chunks to reduce memory usage
                        chunk_size = 20000
                        chunks = [processed_data['speed'][i:i + chunk_size] for i in range(0, len(processed_data['speed']), chunk_size)]
                        
                        for chunk in chunks:
                            chunk_max = max([float(val) for val in chunk if not pd.isna(val)], default=0)
                            max_speed = max(max_speed, chunk_max)
                    else:
                        # For smaller datasets, use the original approach
                        max_speed = max([float(val) for val in processed_data['speed'] if not pd.isna(val)], default=0)
                elif isinstance(processed_data, pd.DataFrame):
                    max_speed = processed_data['speed'].max()
            except Exception as e:
                logging.error(f"Error calculating max speed: {e}")
                # Continue execution even if max speed calculation fails
            
            if max_speed >= 130:
                achievements.append({
                    'id': 'devil',
                    'title': 'Devil',
                    'description': "You're a true Devil of the road — you hit 130 km/h!",
                    'icon': 'devil.svg'
                })
            
            # Check for "Nomad" and "Tourist" achievements - related to daily travel distance
            if isinstance(processed_data, dict) and 'timestamp' in processed_data and 'mileage' in processed_data:
                # Convert timestamps to date strings
                dates = [datetime.utcfromtimestamp(float(ts)).strftime('%Y-%m-%d') 
                      for ts in processed_data['timestamp'] if not pd.isna(ts)]
                
                # Get mileage values
                mileage_values = [float(val) for val in processed_data['mileage'] if not pd.isna(val)]
                
                # Create a DataFrame to group by date
                if len(dates) == len(mileage_values) and len(dates) > 0:
                    mileage_df = pd.DataFrame({
                        'date': dates,
                        'mileage': mileage_values
                    })
                    
                    # Calculate mileage difference by date
                    mileage_by_date = mileage_df.groupby('date').agg({
                        'mileage': lambda x: max(x) - min(x)
                    })
                    
                    # Get the maximum daily distance
                    max_daily_distance = mileage_by_date['mileage'].max()
                    
                    # Check if any day had more than 90 km (Tourist achievement)
                    if max_daily_distance >= 90:
                        achievements.append({
                            'id': 'tourist',
                            'title': 'Tourist',
                            'description': "You're a true tourist — you traveled over 90 km in a single day!",
                            'icon': 'tourist.svg'
                        })
                    
                    # Check if any day had more than 150 km (Nomad achievement)
                    if max_daily_distance >= 150:
                        achievements.append({
                            'id': 'nomad',
                            'title': 'Nomad',
                            'description': "You're a true nomad — you traveled over 150 kilometers in a single day!",
                            'icon': 'supertourist.svg'
                        })
            
            # Check for "Strong rider" achievement - power value above 20000 or below -20000
            if isinstance(processed_data, dict) and 'power' in processed_data:
                try:
                    # Variables to track extreme values
                    max_power = -float('inf')
                    min_power = float('inf')
                    
                    # For large datasets, process in chunks to reduce memory usage
                    if len(processed_data['power']) > 100000:
                        # Process in chunks to reduce memory usage
                        chunk_size = 20000
                        chunks = [processed_data['power'][i:i + chunk_size] for i in range(0, len(processed_data['power']), chunk_size)]
                        
                        # Find max and min in each chunk
                        for chunk in chunks:
                            # Skip NaN values
                            valid_values = [float(val) for val in chunk if not pd.isna(val)]
                            if valid_values:
                                max_power = max(max_power, max(valid_values))
                                min_power = min(min_power, min(valid_values))
                    else:
                        # For smaller datasets, use the original approach
                        power_values = [float(val) for val in processed_data['power'] if not pd.isna(val)]
                        if power_values:
                            max_power = max(power_values)
                            min_power = min(power_values)
                    
                    # Only proceed if we found valid values (max_power was updated from -inf)
                    if max_power > -float('inf'):
                        # Check for "Strong rider" achievement - power value above 20000 or below -20000
                        if max_power >= 20000 or min_power <= -20000:
                            achievements.append({
                                'id': 'strongrider',
                                'title': 'Strong rider',
                                'description': "You're a heavy, powerful rider — you managed to load the hub motor with 20,000 watts!",
                                'icon': 'fat.svg'
                            })
                        
                        # Check for "Godlike power" achievement - power value above 30000 or below -30000
                        if max_power >= 30000 or min_power <= -30000:
                            achievements.append({
                                'id': 'godlikepower',
                                'title': 'Godlike power',
                                'description': "You're a godlike-force rider — you managed to load the hub motor with 30,000 watts!",
                                'icon': 'superfat.svg'
                            })
                except Exception as e:
                    logging.error(f"Error calculating power achievements: {e}")
                    # Continue execution even if power calculation fails
            
            # Check for "Clown" achievement - average difference between speed and GPS speed > 5 km/h
            if isinstance(processed_data, dict) and 'speed' in processed_data and 'gps' in processed_data:
                # Get speed and GPS speed values as pairs
                speed_pairs = []
                for i in range(len(processed_data['speed'])):
                    if (i < len(processed_data['gps']) and 
                        not pd.isna(processed_data['speed'][i]) and 
                        not pd.isna(processed_data['gps'][i])):
                        
                        speed = float(processed_data['speed'][i])
                        gps_speed = float(processed_data['gps'][i])
                        
                        # Only include if GPS speed is not zero
                        if gps_speed > 0:
                            speed_pairs.append((speed, gps_speed))
                
                # Check if we have valid pairs and not all GPS speeds are zero
                if speed_pairs:
                    # Calculate average difference
                    differences = [abs(pair[0] - pair[1]) for pair in speed_pairs]
                    avg_difference = sum(differences) / len(differences)
                    
                    # If average difference is greater than 5 km/h, add the achievement
                    if avg_difference > 5:
                        achievements.append({
                            'id': 'clown',
                            'title': 'Clown',
                            'description': "You're a real clown — your EUC lies about the speed by more than 5 km/h!",
                            'icon': 'clown.svg'
                        })
            
            # Check for "Sleep" achievement - max speed never reached 50 km/h
            if isinstance(processed_data, dict) and 'speed' in processed_data:
                # Get all speed values
                speed_values = [float(val) for val in processed_data['speed'] if not pd.isna(val)]
                
                # Check if max speed is less than 50 km/h
                if speed_values and max(speed_values) < 50:
                    achievements.append({
                        'id': 'sleep',
                        'title': 'Sleep',
                        'description': "Your speed has not reached 50 km/h!",
                        'icon': 'sleep.svg'
                    })
                
                # Check for "Fast" achievement - speed reached 90 km/h
                if speed_values and max(speed_values) >= 90:
                    achievements.append({
                        'id': 'fast',
                        'title': 'Fast',
                        'description': "You're very fast — you reached a speed of 90 km/h!",
                        'icon': 'speed.svg'
                    })
                
                # Check for "Super Fast" achievement - speed reached 100 km/h
                if speed_values and max(speed_values) >= 100:
                    achievements.append({
                        'id': 'superfast',
                        'title': 'Super Fast',
                        'description': "You're super fast — you reached a speed of 100 km/h!",
                        'icon': 'superspeed.svg'
                    })
            
            # Check for "Suicidal madman" and "Dead" achievements - related to 100% PWM
            if isinstance(processed_data, dict) and 'pwm' in processed_data and 'speed' in processed_data and 'timestamp' in processed_data:
                # Check if we have timestamps and data values
                if (len(processed_data['pwm']) > 0 and 
                    len(processed_data['speed']) > 0 and 
                    len(processed_data['timestamp']) > 0):
                    
                    # Find all instances of 100% PWM
                    max_pwm_indices = []
                    for i in range(len(processed_data['pwm'])):
                        if (not pd.isna(processed_data['pwm'][i]) and 
                            float(processed_data['pwm'][i]) >= 100):
                            max_pwm_indices.append(i)
                    
                    # If we found any 100% PWM instances
                    if max_pwm_indices:
                        # Get the last occurrence
                        last_max_pwm_index = max_pwm_indices[-1]
                        last_max_pwm_timestamp = float(processed_data['timestamp'][last_max_pwm_index])
                        
                        # Check all speed values in the 10 seconds after last 100% PWM
                        suicidal = True
                        dead = False
                        
                        for i in range(len(processed_data['timestamp'])):
                            if (not pd.isna(processed_data['timestamp'][i]) and 
                                not pd.isna(processed_data['speed'][i])):
                                
                                timestamp = float(processed_data['timestamp'][i])
                                speed = float(processed_data['speed'][i])
                                
                                # Check if this datapoint is within 10 seconds after the last 100% PWM
                                if (timestamp > last_max_pwm_timestamp and 
                                    timestamp <= last_max_pwm_timestamp + 10):
                                    
                                    # If speed dropped below 5 km/h, not suicidal
                                    if speed < 5:
                                        suicidal = False
                                        
                                    # If speed dropped below 2 km/h, consider "dead"
                                    if speed < 2:
                                        dead = True
                        
                        # Add appropriate achievements based on conditions
                        if suicidal:
                            achievements.append({
                                'id': 'suicidalmadman',
                                'title': 'Suicidal madman',
                                'description': "You're a suicidal madman hit 100% PWM and still didn't kiss the asphalt!",
                                'icon': 'skeleton.svg'
                            })
                        
                        if dead:
                            achievements.append({
                                'id': 'dead',
                                'title': 'Dead',
                                'description': "You weren't lucky — you either died or got seriously injured!",
                                'icon': 'dead.svg'
                            })
            
            # Return the processed data with achievements for visualization
            return jsonify({
                'success': True,
                'csv_type': csv_type,
                'csv_data': json.dumps(serializable_data),
                'achievements': achievements
            })
            
        except MemoryError:
            # Special handling for memory errors
            logging.error("Memory error while processing CSV file - file may be too large")
            return jsonify({'error': gettext('Memory error while processing CSV file. The file is too large or contains too much data. Try uploading a smaller file or reducing the data points.')}), 400
        except Exception as e:
            logging.error(f"Error processing CSV file: {str(e)}")
            # Check if error message suggests memory issues
            error_str = str(e).lower()
            if 'memory' in error_str or 'allocation' in error_str or 'buffer' in error_str:
                return jsonify({'error': gettext('The CSV file appears to be too large for processing. Please try a smaller file or contact support.')}), 400
            return jsonify({'error': gettext('Error processing CSV file: ') + str(e)}), 400
            
    except Exception as e:
        logging.error(f"Error in analyze_csv: {str(e)}")
        return jsonify({'error': gettext('An unexpected error occurred')}), 500
    finally:
        # Clean up temporary files
        try:
            if temp_file_path and os.path.exists(temp_file_path):
                os.remove(temp_file_path)
            if temp_dir and os.path.exists(temp_dir):
                os.rmdir(temp_dir)
        except Exception as e:
            logging.error(f"Error cleaning up temporary files: {str(e)}")
# Add markdown preview route
@app.route('/markdown-preview', methods=['POST'])
def markdown_preview():
    """Convert markdown to HTML for preview"""
    try:
        data = request.get_json()
        if not data or 'markdown' not in data:
            return jsonify({'error': 'No markdown content provided'}), 400
            
        markdown_text = data['markdown']
        html_content = markdown_filter(markdown_text)
        
        return jsonify({
            'success': True,
            'html': html_content
        })
    except Exception as e:
        logging.error(f"Error in markdown preview: {str(e)}")
        return jsonify({'error': str(e)}), 500
