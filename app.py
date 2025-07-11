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
from utils.image_generator import generate_frames, create_preview_frame, clear_icon_cache
from utils.video_creator import create_video
from utils.background_processor import process_project, stop_project_processing
from utils.env_setup import setup_env_variables
from utils.email_sender import send_email, test_smtp_connection
from forms import (LoginForm, RegistrationForm, ProfileForm, 
                  ChangePasswordForm, ForgotPasswordForm, ResetPasswordForm, DeleteAccountForm, 
                  NewsForm, EmailCampaignForm, ResendConfirmationForm, EmailTestForm, AchievementForm, 
                  generate_math_captcha)
from models import User, Project, EmailCampaign, News, Preset, RegistrationAttempt, Achievement
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

# Clear icon cache on startup to ensure updated SVG files are loaded
clear_icon_cache()

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

        # Delete PNG archive file
        if project.png_archive_file:
            archive_path = os.path.join('archives', project.png_archive_file)
            if os.path.exists(archive_path):
                os.remove(archive_path)
                logging.info(f"Deleted PNG archive file: {archive_path}")

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

# Check for orphaned projects (projects in processing or pending status when server restarted)
def check_orphaned_projects():
    """
    Check for projects in 'processing' or 'pending' status that were orphaned 
    due to server restart and mark them as 'error'
    """
    try:
        # Find all projects in processing or pending status
        orphaned_projects = Project.query.filter(
            Project.status.in_(['processing', 'pending'])
        ).all()
        
        count = 0
        for project in orphaned_projects:
            project.status = 'error'
            project.error_message = 'Project processing was interrupted due to server restart'
            count += 1
        
        if count > 0:
            db.session.commit()
            logging.info(f"Marked {count} orphaned projects as 'error' during server startup")
        
        return count
    except Exception as e:
        logging.error(f"Error checking orphaned projects: {str(e)}")
        db.session.rollback()
        return 0

# Note: Moved below - this will be called after app and DB initialization

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
        .paginate(page=user_page, per_page=10, error_out=False)

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

    # Get paginated users (all users, not just recent ones)
    users = User.query.order_by(User.created_at.desc())\
        .paginate(page=user_page, per_page=10, error_out=False)

    # Format users data with additional fields
    users_data = [{
        'id': u.id,
        'name': u.name,
        'email': u.email,
        'created_at': u.created_at.strftime('%Y-%m-%d %H:%M'),
        'is_email_confirmed': u.is_email_confirmed,
        'is_new': u.created_at.date() == today,
        'is_admin': u.is_admin,
        'is_active': u.is_active
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
        'resolution': p.resolution or '-',  # Add resolution
        'has_csv': bool(p.csv_file and os.path.exists(os.path.join('processed_data', f'project_{p.folder_number}_{p.csv_file}'))),
        'has_video': bool(p.video_file and os.path.exists(os.path.join('videos', p.video_file)))
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
for directory in ['uploads', 'frames', 'videos', 'processed_data', 'previews', 'archives']:
    try:
        os.makedirs(directory, exist_ok=True)
        logging.info(f"Ensuring directory exists: {directory}")
    except Exception as e:
        logging.error(f"Error creating directory {directory}: {str(e)}")
        raise

db.init_app(app)
migrate = Migrate(app, db)

# Mark orphaned projects as error during startup (only after DB init)
with app.app_context():
    orphaned_count = check_orphaned_projects()
    if orphaned_count > 0:
        logging.info(f"Marked {orphaned_count} projects as 'error' due to server restart")


# Authentication routes
@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    form = LoginForm()
    show_resend_option = False  # По умолчанию не показываем опцию повторной отправки
    
    # Проверяем, был ли передан запрос на отображение опции повторной отправки
    email_needs_confirmation = request.args.get('email_needs_confirmation')
    
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user is None or not user.check_password(form.password.data) or not user.is_active:
            flash(_('Invalid email or password'))
            return redirect(url_for('login'))
        if not user.is_email_confirmed:
            flash(_('Please confirm your email address before logging in.'))
            # Добавляем параметр для показа опции повторной отправки
            return redirect(url_for('login', email_needs_confirmation=1))
        login_user(user, remember=True)  # Remember user session for 6 months
        return redirect(url_for('index'))
        
    # Если пользователь ввел верные данные, но email не подтвержден - показать опцию
    if email_needs_confirmation:
        show_resend_option = True
        
    return render_template('login.html', form=form, show_resend_option=show_resend_option)

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    form = RegistrationForm()
    if form.validate_on_submit():
        # Get client IP address
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr)
        if client_ip and ',' in client_ip:
            client_ip = client_ip.split(',')[0].strip()
        
        # Check IP registration limit BEFORE creating any user records
        if not RegistrationAttempt.can_register(client_ip):
            attempts_count = RegistrationAttempt.get_daily_attempts_count(client_ip)
            if get_locale() == 'ru':
                flash('Превышен лимит регистраций с вашего IP-адреса (максимум 3 в день). Попробуйте снова завтра.')
            else:
                flash('Registration limit exceeded from your IP address (maximum 3 per day). Please try again tomorrow.')
            logging.warning(f"Registration blocked for IP {client_ip}: {attempts_count} attempts in 24 hours")
            # Do NOT log failed attempts or create user records to prevent database spam
            return redirect(url_for('register'))
        
        # Проверяем, существует ли пользователь с таким email (активный или неактивный)
        existing_user = User.query.filter_by(email=form.email.data).first()
        
        # Проверяем дополнительно неактивных пользователей с этим же email (может случиться при смене регистра)
        if not existing_user:
            existing_user = User.query.filter(User.email.ilike(form.email.data)).first()
        
        if existing_user:
            if existing_user.is_active:
                # Если пользователь активен, сообщаем что email занят
                flash(_('This email is already registered'))
                # Если email не подтвержден, предлагаем запросить подтверждение снова
                if not existing_user.is_email_confirmed:
                    flash(_('If you have not received the confirmation email, you can request a new one'))
                return redirect(url_for('register'))
            else:
                # Если пользователь неактивен, активируем и обновляем данные
                existing_user.is_active = True
                existing_user.name = form.name.data
                existing_user.set_password(form.password.data)
                confirmation_token = existing_user.generate_email_confirmation_token()
                db.session.commit()
                
                # Перенаправляем на отправку подтверждения
                try:
                    # Get user's preferred language
                    user_locale = request.accept_languages.best_match(['en', 'ru'])
                    
                    # Prepare email content based on locale
                    confirmation_link = url_for('confirm_email', token=confirmation_token, _external=True)
                    if user_locale == 'ru':
                        confirmation_html = f"""
                        <h2>Подтвердите регистрацию</h2>
                        <p>Здравствуйте, {existing_user.name},</p>
                        <p>Спасибо за регистрацию в EUCTelemetry. Пожалуйста, нажмите на ссылку ниже, чтобы подтвердить ваш email:</p>
                        <p><a href="{confirmation_link}">{confirmation_link}</a></p>
                        <p>Эта ссылка будет действительна в течение 24 часов.</p>
                        <p>С наилучшими пожеланиями,<br>Команда EUCTelemetry</p>
                        """
                    else:
                        confirmation_html = f"""
                        <h2>Confirm Your Registration</h2>
                        <p>Hello {existing_user.name},</p>
                        <p>Thank you for registering with EUCTelemetry. Please click the link below to confirm your email address:</p>
                        <p><a href="{confirmation_link}">{confirmation_link}</a></p>
                        <p>This link will expire in 24 hours.</p>
                        <p>Best regards,<br>EUCTelemetry Team</p>
                        """
                    
                    if send_email(existing_user.email, "Confirm Your Email Address", confirmation_html):
                        flash(_('Please check your email to complete registration.'))
                        # Перенаправляем с параметром, чтобы показать опцию повторной отправки
                        return redirect(url_for('login', email_needs_confirmation=1))
                    else:
                        flash(_('Error sending confirmation email. Please try registering again.'))
                        existing_user.is_active = False
                        db.session.commit()
                        return redirect(url_for('login'))
                    
                except Exception as e:
                    db.session.rollback()
                    logging.error(f"Registration error: {str(e)}")
                    flash(_('An error occurred during registration. Please try again later.'))
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
            # Коммит для сохранения токена в базе данных до отправки письма
            db.session.commit()
            
            # Дополнительная проверка токена в базе данных
            stored_token = User.query.filter_by(email=form.email.data).first().email_confirmation_token
            if stored_token != confirmation_token:
                logging.warning(f"Token mismatch: generated={confirmation_token}, stored={stored_token}")
                # В этом случае используем токен из базы данных
                confirmation_token = stored_token

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
                # Log successful registration attempt
                RegistrationAttempt.log_attempt(
                    ip_address=client_ip,
                    email=form.email.data,
                    success=True,
                    user_agent=request.headers.get('User-Agent')
                )
                flash(_('Please check your email to complete registration.'))
                # Перенаправляем с параметром, чтобы показать опцию повторной отправки
                return redirect(url_for('login', email_needs_confirmation=1))
            else:
                flash(_('Error sending confirmation email. Please try registering again.'))
                # Деактивировать пользователя вместо удаления 
                user.is_active = False
                db.session.commit()
                return redirect(url_for('login'))

        except Exception as e:
            db.session.rollback()
            logging.error(f"Registration error: {str(e)}")
            flash(_('An error occurred during registration. Please try again later.'))
            return redirect(url_for('register'))

    # Generate math captcha for GET requests or after form validation errors
    captcha_question = generate_math_captcha()
    return render_template('register.html', form=form, 
                         captcha_question=captcha_question,
                         recaptcha_site_key=os.environ.get('RECAPTCHA_SITE_KEY'))

@app.route('/confirm/<token>')
def confirm_email(token):
    # Добавляем логирование для отладки
    logging.info(f"Attempting to confirm email with token: {token}")
    
    # Проверим наличие пользователя с таким токеном
    user = User.query.filter_by(email_confirmation_token=token).first()
    
    # Проверяем, найден ли пользователь с этим токеном
    if not user:
        logging.info(f"No user found with token: {token}")
        # Попробуем найти любого пользователя с ожидающим подтверждением
        users_waiting_confirmation = User.query.filter(
            User.email_confirmation_token.isnot(None)
        ).all()
        logging.info(f"Users waiting for confirmation: {len(users_waiting_confirmation)}")
        if users_waiting_confirmation:
            for u in users_waiting_confirmation:
                logging.info(f"User {u.email} has token: {u.email_confirmation_token}")
                # Проверим, был ли проблемный токен URLEncoded
                from urllib.parse import quote, unquote
                quoted_token = quote(u.email_confirmation_token)
                unquoted_token = unquote(token)
                if quoted_token == token or unquoted_token == u.email_confirmation_token:
                    logging.info(f"Match found with encoding differences: {u.email}")
                    user = u
                    break
        
        if not user:
            flash(_('Invalid confirmation link.'))
            return redirect(url_for('login'))
    
    logging.info(f"Found user: {user.email} with token: {user.email_confirmation_token}")

    # Проверяем, не истек ли срок действия ссылки
    if user.email_confirmation_sent_at < datetime.utcnow() - timedelta(days=1):
        logging.info(f"Token expired for user: {user.email}")
        flash(_('This confirmation link has expired. Please request a new confirmation email.'))
        # Вместо удаления пользователя, обнуляем токен подтверждения
        user.email_confirmation_token = None
        db.session.commit()
        return redirect(url_for('resend_confirmation'))

    # Подтверждаем email пользователя
    user.is_email_confirmed = True
    user.email_confirmation_token = None
    db.session.commit()
    logging.info(f"Email confirmed successfully for user: {user.email}")

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

            # Деактивировать пользователя вместо физического удаления
            current_user.is_active = False
            db.session.commit()
            
            # Выход из системы
            logout_user()
            
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
            'show_time': False,
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
            'show_time': data.get('show_time', False),
            'show_bottom_elements': data.get('show_bottom_elements', True),
            'use_icons': data.get('use_icons', False),
            'icon_vertical_offset': int(data.get('icon_vertical_offset', 5)),
            'icon_horizontal_spacing': int(data.get('icon_horizontal_spacing', 10)),
            'static_box_size': data.get('static_box_size', False)
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
    if project.user_id != current_user.id and not current_user.is_admin:
        return jsonify({'error': 'Unauthorized'}), 403

    if type == 'video' and project.video_file:
        video_path = os.path.join('videos', project.video_file)
        return send_file(video_path, as_attachment=True)
    elif type == 'png_archive':
        # Create PNG archive if it doesn't exist
        if not project.png_archive_file:
            from utils.archive_creator import create_png_archive
            archive_filename = create_png_archive(project.id, project.folder_number, project.name)
            if archive_filename:
                project.png_archive_file = archive_filename
                db.session.commit()
            else:
                return jsonify({'error': 'Failed to create PNG archive'}), 500
        
        # Download existing archive
        archive_path = os.path.join('archives', project.png_archive_file)
        if os.path.exists(archive_path):
            return send_file(archive_path, as_attachment=True, download_name=f'{project.name}_frames.zip')
        else:
            return jsonify({'error': 'Archive file not found'}), 404
    elif type == 'frames':
        # Legacy support - redirect to png_archive
        return download_file(project_id, 'png_archive')
    elif type == 'processed_csv':
        processed_csv = os.path.join('processed_data', f'project_{project.folder_number}_{project.csv_file}')
        if os.path.exists(processed_csv):
            return send_file(processed_csv, as_attachment=True)

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

        # Delete PNG archive file if exists
        if project.png_archive_file:
            archive_path = os.path.join('archives', project.png_archive_file)
            if os.path.exists(archive_path):
                os.remove(archive_path)

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
            'show_time': data.get('show_time', False),
            'show_bottom_elements': data.get('show_bottom_elements', True),
            'use_icons': data.get('use_icons', False),
            'icon_vertical_offset': int(data.get('icon_vertical_offset', 5)),
            'icon_horizontal_spacing': int(data.get('icon_horizontal_spacing', 10)),
            'static_box_size': data.get('static_box_size', False)
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

@app.route('/resend_confirmation', methods=['GET', 'POST'])
def resend_confirmation():
    """Handle resending confirmation email for users whose link expired"""
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    form = ResendConfirmationForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user and not user.is_email_confirmed and user.is_active:
            # Generate a new confirmation token
            confirmation_token = user.generate_email_confirmation_token()
            # Сохраняем токен в базе данных немедленно
            db.session.commit()
            
            # Дополнительная проверка токена в базе данных
            stored_token = User.query.filter_by(email=form.email.data).first().email_confirmation_token
            if stored_token != confirmation_token:
                logging.warning(f"Token mismatch in resend: generated={confirmation_token}, stored={stored_token}")
                # В этом случае используем токен из базы данных
                confirmation_token = stored_token
            
            # Get user's preferred language or detect from browser
            user_locale = user.locale or request.accept_languages.best_match(['en', 'ru']) or 'en'
            
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
                subject = _("Подтвердите ваш адрес электронной почты")
            else:
                confirmation_html = f"""
                <h2>Confirm Your Registration</h2>
                <p>Hello {user.name},</p>
                <p>Thank you for registering with EUCTelemetry. Please click the link below to confirm your email address:</p>
                <p><a href="{confirmation_link}">{confirmation_link}</a></p>
                <p>This link will expire in 24 hours.</p>
                <p>Best regards,<br>EUCTelemetry Team</p>
                """
                subject = _("Confirm Your Email Address")

            if send_email(user.email, subject, confirmation_html):
                flash(_('New confirmation email sent. Please check your inbox.'))
            else:
                flash(_('Error sending confirmation email. Please try again later.'))
        else:
            # Don't reveal whether the email exists or is already confirmed
            flash(_('If your email is registered and not confirmed, a new confirmation email has been sent.'))
        
        return redirect(url_for('login'))
    
    return render_template('resend_confirmation.html', form=form)

@app.route('/forgot_password', methods=['GET', 'POST'])
def forgot_password():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    form = ForgotPasswordForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user:
            token = user.generate_password_reset_token()
            # Сохраняем токен в базе данных немедленно
            db.session.commit()
            
            # Дополнительная проверка токена в базе данных
            stored_token = User.query.filter_by(email=form.email.data).first().password_reset_token
            if stored_token != token:
                logging.warning(f"Token mismatch in password reset: generated={token}, stored={stored_token}")
                # В этом случае используем токен из базы данных
                token = stored_token
                
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
        if 'is_email_confirmed' in data:
            user.is_email_confirmed = bool(data['is_email_confirmed'])
            # If email confirmation is manually set by admin, clear token
            if user.is_email_confirmed:
                user.email_confirmation_token = None
        if 'is_active' in data:
            # Обновляем статус активации пользователя
            was_active = user.is_active
            user.is_active = bool(data['is_active'])
            
            # Логируем изменение статуса
            action = "activated" if user.is_active else "deactivated"
            logging.info(f"User {user.id} ({user.email}) {action} by admin")
            
            # Если пользователь активирован, но email не подтвержден, сбрасываем токен
            # чтобы пользователь мог запросить новое письмо для подтверждения
            if user.is_active and not was_active and not user.is_email_confirmed:
                user.email_confirmation_token = None

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

        # Деактивируем пользователя вместо физического удаления
        user.is_active = False
        # Сохраняем запись о деактивации
        logging.info(f"User {user.id} ({user.email}) deactivated by admin")
        db.session.commit()

        return jsonify({'success': True})

    except Exception as e:
        db.session.rollback()
        logging.error(f"Error deactivating user: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/admin/search-users', methods=['POST'])
@login_required
@admin_required
def search_users():
    """Search users by name pattern"""
    try:
        data = request.get_json()
        pattern = data.get('pattern', '').strip()
        
        if not pattern:
            return jsonify({'error': 'Pattern is required'}), 400
            
        # Search for users whose name contains the exact sequence of characters (case-insensitive)
        users = User.query.filter(User.name.ilike(f'%{pattern}%')).all()
        
        return jsonify({
            'users': [{
                'id': user.id,
                'name': user.name,
                'email': user.email,
                'is_admin': user.is_admin
            } for user in users]
        })
        
    except Exception as e:
        logging.error(f"Error searching users: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/admin/bulk-delete-users', methods=['POST'])
@login_required
@admin_required
def bulk_delete_users():
    """Bulk delete users by their IDs"""
    try:
        data = request.get_json()
        user_ids = data.get('user_ids', [])
        
        if not user_ids:
            return jsonify({'error': 'No user IDs provided'}), 400
            
        deleted_count = 0
        
        for user_id in user_ids:
            user = User.query.get(user_id)
            if user and not user.is_admin:  # Don't delete admin users
                # Delete all user's projects and files first
                projects = Project.query.filter_by(user_id=user.id).all()
                for project in projects:
                    cleanup_project_files(project)
                    db.session.delete(project)
                
                # Delete all user's presets
                presets = Preset.query.filter_by(user_id=user.id).all()
                for preset in presets:
                    db.session.delete(preset)
                
                # Delete registration attempts for this user
                registration_attempts = RegistrationAttempt.query.filter_by(email=user.email).all()
                for attempt in registration_attempts:
                    db.session.delete(attempt)
                    
                # Delete the user completely
                db.session.delete(user)
                deleted_count += 1
                logging.info(f"Admin deleted user {user.id} ({user.email}) via bulk delete")
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'deleted_count': deleted_count
        })
        
    except Exception as e:
        db.session.rollback()
        logging.error(f"Error bulk deleting users: {str(e)}")
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
        used_folders = set()  # Define used_folders set

        # Collect all files that are used by projects
        for project in projects:
            if project.csv_file:
                used_files.add(project.csv_file)  # uploads directory
                used_files.add(f'project_{project.folder_number}_{project.csv_file}')  # processed_data directory
            if project.video_file:
                used_files.add(project.video_file)  # videos directory
            if project.png_archive_file:
                used_files.add(project.png_archive_file)  # archives directory
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

        # Check archives directory
        if os.path.exists('archives'):
            for filename in os.listdir('archives'):
                if filename not in used_files:
                    file_path = os.path.join('archives', filename)
                    try:
                        os.remove(file_path)
                        deleted_files.append(f'archives/{filename}')
                        deleted_count += 1
                        logging.info(f"Deleted unused archive: {file_path}")
                    except Exception as e:
                        logging.error(f"Error deleting archive {file_path}: {str(e)}")

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
            'show_time': data.get('show_time', False),
            'show_bottom_elements': data.get('show_bottom_elements', True),
            'use_icons': data.get('use_icons', False),
            'icon_vertical_offset': int(data.get('icon_vertical_offset', 5)),
            'icon_horizontal_spacing': int(data.get('icon_horizontal_spacing', 10)),
            'static_box_size': data.get('static_box_size', False)
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
                
                # Check for WheelLog format - core columns (gps_speed is optional)
                wheellog_core_columns = {'date', 'speed', 'voltage', 'system_temp',
                                'current', 'battery_level', 'totaldistance', 'pwm', 'power'}
                wheellog_all_columns = wheellog_core_columns.union({'gps_speed'})

                df_columns = set(df.columns)
                is_darkness_bot = len(darkness_bot_columns.intersection(df_columns)) >= len(darkness_bot_columns) * 0.8
                is_wheellog = len(wheellog_core_columns.intersection(df_columns)) >= len(wheellog_core_columns) * 0.9

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
            
            # Calculate achievements using database-driven system
            achievements = []
            
            # Calculate analytics variables for achievement formulas
            analytics_vars = {}
            
            # Calculate max speed
            max_speed = 0
            if isinstance(processed_data, dict) and 'speed' in processed_data:
                speed_values = [float(val) for val in processed_data['speed'] if not pd.isna(val)]
                max_speed = max(speed_values, default=0)
            elif isinstance(processed_data, pd.DataFrame):
                max_speed = processed_data['speed'].max()
            analytics_vars['max_speed'] = max_speed
            
            # Calculate daily travel distance
            max_daily_distance = 0
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
            analytics_vars['max_daily_distance'] = max_daily_distance
            
            # Calculate power values
            max_power = 0
            min_power = 0
            if isinstance(processed_data, dict) and 'power' in processed_data:
                power_values = [float(val) for val in processed_data['power'] if not pd.isna(val)]
                if power_values:
                    max_power = max(power_values)
                    min_power = min(power_values)
            analytics_vars['max_power'] = max_power
            analytics_vars['min_power'] = min_power
            
            # Calculate average speed difference (Clown achievement)
            avg_speed_diff = 0
            if isinstance(processed_data, dict) and 'speed' in processed_data and 'gps' in processed_data:
                speed_pairs = []
                for i in range(len(processed_data['speed'])):
                    if (i < len(processed_data['gps']) and 
                        not pd.isna(processed_data['speed'][i]) and 
                        not pd.isna(processed_data['gps'][i])):
                        
                        speed = float(processed_data['speed'][i])
                        gps_speed = float(processed_data['gps'][i])
                        
                        if gps_speed > 0:
                            speed_pairs.append((speed, gps_speed))
                
                if speed_pairs:
                    differences = [abs(pair[0] - pair[1]) for pair in speed_pairs]
                    avg_speed_diff = sum(differences) / len(differences)
            analytics_vars['avg_speed_diff'] = avg_speed_diff
            
            # Calculate PWM-related achievements
            pwm_100_survived = False
            pwm_100_dead = False
            if isinstance(processed_data, dict) and 'pwm' in processed_data and 'speed' in processed_data and 'timestamp' in processed_data:
                if (len(processed_data['pwm']) > 0 and 
                    len(processed_data['speed']) > 0 and 
                    len(processed_data['timestamp']) > 0):
                    
                    # Find all instances of 100% PWM
                    max_pwm_indices = []
                    for i in range(len(processed_data['pwm'])):
                        if (not pd.isna(processed_data['pwm'][i]) and 
                            float(processed_data['pwm'][i]) >= 100):
                            max_pwm_indices.append(i)
                    
                    if max_pwm_indices:
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
                                
                                if (timestamp > last_max_pwm_timestamp and 
                                    timestamp <= last_max_pwm_timestamp + 10):
                                    
                                    if speed < 5:
                                        suicidal = False
                                        
                                    if speed < 2:
                                        dead = True
                        
                        pwm_100_survived = suicidal
                        pwm_100_dead = dead
            
            analytics_vars['pwm_100_survived'] = pwm_100_survived
            analytics_vars['pwm_100_dead'] = pwm_100_dead
            
            # Get all active achievements from database and evaluate them
            active_achievements = Achievement.query.filter_by(is_active=True).all()
            
            for achievement in active_achievements:
                try:
                    # Evaluate achievement formula with analytics variables
                    if eval(achievement.formula, {"__builtins__": {}}, analytics_vars):
                        achievements.append({
                            'id': achievement.achievement_id,
                            'title': achievement.title,
                            'description': achievement.description,
                            'icon': achievement.icon
                        })
                except Exception as e:
                    logging.warning(f"Error evaluating achievement formula for {achievement.achievement_id}: {str(e)}")
                    continue
            
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

@app.route('/admin/test-smtp', methods=['POST'])
@login_required
@admin_required
def test_smtp():
    """Test SMTP connection"""
    try:
        success, message = test_smtp_connection()
        if success:
            flash(f'SMTP test passed: {message}', 'success')
        else:
            flash(f'SMTP test failed: {message}', 'danger')
    except Exception as e:
        logging.error(f"Error testing SMTP: {str(e)}")
        flash(f'SMTP test error: {str(e)}', 'danger')
    
    return redirect(url_for('admin_dashboard'))

@app.route('/admin/send-test-email', methods=['GET', 'POST'])
@login_required
@admin_required
def send_test_email():
    """Send test email"""
    form = EmailTestForm()
    
    if form.validate_on_submit():
        try:
            # Test email content
            test_subject = "Test Email from EUC Telemetry"
            test_html = """
            <html>
            <body>
                <h2>Test Email</h2>
                <p>This is a test email from EUC Telemetry system.</p>
                <p>If you received this email, your SMTP server is working correctly!</p>
                <p>Time sent: """ + datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC') + """</p>
            </body>
            </html>
            """
            
            # Send test email
            success = send_email(form.test_email.data, test_subject, test_html)
            
            if success:
                flash(f'Test email sent successfully to {form.test_email.data}', 'success')
            else:
                flash(f'Failed to send test email to {form.test_email.data}', 'danger')
                
        except Exception as e:
            logging.error(f"Error sending test email: {str(e)}")
            flash(f'Error sending test email: {str(e)}', 'danger')
        
        return redirect(url_for('admin_dashboard'))
    
    return render_template('admin/send_test_email.html', form=form)


@app.route('/admin/achievements')
@admin_required
def admin_achievements():
    """Display achievements management page"""
    # Initialize default achievements if none exist
    if Achievement.query.count() == 0:
        Achievement.initialize_defaults()
    
    achievements = Achievement.query.order_by(Achievement.achievement_id).all()
    return render_template('admin/achievements.html', achievements=achievements)


@app.route('/admin/achievements/new', methods=['GET', 'POST'])
@admin_required
def admin_achievement_new():
    """Create new achievement"""
    form = AchievementForm()
    
    if form.validate_on_submit():
        try:
            # Check if achievement_id already exists
            existing = Achievement.query.filter_by(achievement_id=form.achievement_id.data).first()
            if existing:
                flash(f'Achievement with ID "{form.achievement_id.data}" already exists', 'danger')
                return render_template('admin/achievement_form.html', form=form, title='New Achievement')
            
            achievement = Achievement(
                achievement_id=form.achievement_id.data,
                title=form.title.data,
                description=form.description.data,
                icon=form.icon.data,
                formula=form.formula.data,
                is_active=form.is_active.data
            )
            
            db.session.add(achievement)
            db.session.commit()
            
            flash(f'Achievement "{form.title.data}" created successfully', 'success')
            return redirect(url_for('admin_achievements'))
            
        except Exception as e:
            logging.error(f"Error creating achievement: {str(e)}")
            flash(f'Error creating achievement: {str(e)}', 'danger')
    
    return render_template('admin/achievement_form.html', form=form, title='New Achievement')


@app.route('/admin/achievements/<int:achievement_id>/edit', methods=['GET', 'POST'])
@admin_required
def admin_achievement_edit(achievement_id):
    """Edit existing achievement"""
    achievement = Achievement.query.get_or_404(achievement_id)
    form = AchievementForm(obj=achievement)
    
    if form.validate_on_submit():
        try:
            # Check if achievement_id already exists (except for current record)
            existing = Achievement.query.filter(
                Achievement.achievement_id == form.achievement_id.data,
                Achievement.id != achievement_id
            ).first()
            if existing:
                flash(f'Achievement with ID "{form.achievement_id.data}" already exists', 'danger')
                return render_template('admin/achievement_form.html', form=form, 
                                    title=f'Edit Achievement: {achievement.title}')
            
            achievement.achievement_id = form.achievement_id.data
            achievement.title = form.title.data
            achievement.description = form.description.data
            achievement.icon = form.icon.data
            achievement.formula = form.formula.data
            achievement.is_active = form.is_active.data
            achievement.updated_at = datetime.utcnow()
            
            db.session.commit()
            
            flash(f'Achievement "{achievement.title}" updated successfully', 'success')
            return redirect(url_for('admin_achievements'))
            
        except Exception as e:
            logging.error(f"Error updating achievement: {str(e)}")
            flash(f'Error updating achievement: {str(e)}', 'danger')
    
    return render_template('admin/achievement_form.html', form=form, 
                         title=f'Edit Achievement: {achievement.title}')


@app.route('/admin/achievements/<int:achievement_id>/delete', methods=['POST'])
@admin_required
def admin_achievement_delete(achievement_id):
    """Delete achievement"""
    try:
        achievement = Achievement.query.get_or_404(achievement_id)
        title = achievement.title
        
        db.session.delete(achievement)
        db.session.commit()
        
        flash(f'Achievement "{title}" deleted successfully', 'success')
        
    except Exception as e:
        logging.error(f"Error deleting achievement: {str(e)}")
        flash(f'Error deleting achievement: {str(e)}', 'danger')
    
    return redirect(url_for('admin_achievements'))


@app.route('/admin/achievements/reset', methods=['POST'])
@admin_required
def admin_achievements_reset():
    """Reset achievements to defaults"""
    try:
        # Delete all existing achievements
        Achievement.query.delete()
        db.session.commit()
        
        # Initialize defaults
        Achievement.initialize_defaults()
        
        flash('Achievements reset to defaults successfully', 'success')
        
    except Exception as e:
        logging.error(f"Error resetting achievements: {str(e)}")
        flash(f'Error resetting achievements: {str(e)}', 'danger')
    
    return redirect(url_for('admin_achievements'))


@app.route('/admin/achievements/refresh', methods=['POST'])
@admin_required
def admin_achievements_refresh():
    """Refresh achievements - add missing defaults without deleting existing ones"""
    try:
        # Get count before refresh
        count_before = Achievement.query.count()
        
        # Initialize defaults (this will only add missing achievements)
        Achievement.initialize_defaults()
        
        # Get count after refresh
        count_after = Achievement.query.count()
        added_count = count_after - count_before
        
        if added_count > 0:
            flash(f'Added {added_count} missing achievements. Total achievements: {count_after}', 'success')
        else:
            flash(f'All achievements are up to date. Total achievements: {count_after}', 'info')
            
    except Exception as e:
        db.session.rollback()
        logging.error(f"Error refreshing achievements: {str(e)}")
        flash(f'Error refreshing achievements: {str(e)}', 'danger')
    
    return redirect(url_for('admin_achievements'))
