import os
import logging
import random
import re
import shutil
import threading
import time
from datetime import datetime, timedelta
from collections import defaultdict
from functools import wraps

import psutil
from dotenv import load_dotenv
from flask import (Flask, render_template, request, jsonify, send_file, 
                  url_for, send_from_directory, flash, redirect, abort)
from flask_migrate import Migrate
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.utils import secure_filename
from flask_babel import Babel, gettext as _, get_locale
from extensions import db
from utils.csv_processor import process_csv_file
from utils.image_generator import generate_frames, create_preview_frame
from utils.video_creator import create_video
from utils.background_processor import process_project
from utils.env_setup import setup_env_variables
from utils.email_sender import send_email
from forms import (LoginForm, RegistrationForm, ProfileForm, 
                  ChangePasswordForm, ForgotPasswordForm, ResetPasswordForm, DeleteAccountForm)
from models import User, Project

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', os.urandom(32))
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL')
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_recycle': 300,
    'pool_pre_ping': True,
}
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['WTF_CSRF_ENABLED'] = True
app.config['BABEL_DEFAULT_LOCALE'] = 'en'

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
    return len(name) <= 7 and bool(re.match(r'^[\w\d]+$', name, re.UNICODE))

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
        login_user(user)
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
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    project_name = request.form.get('project_name', '').strip()

    # Validate project name
    if project_name:
        if not validate_project_name(project_name):
            return jsonify({'error': 'Invalid project name. Use up to 7 letters or numbers.'}), 400
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
            'border_radius': 13
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
        fps = float(data.get('fps', 29.97))  # Get FPS from request
        codec = data.get('codec', 'h264')
        interpolate_values = data.get('interpolate_values', True)  # New parameter

        # Update project settings immediately
        project.fps = fps
        project.resolution = resolution
        project.codec = codec
        project.processing_started_at = datetime.now()  # Record start time
        db.session.commit()

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
            'indicator_scale': float(data.get('indicator_scale', 100))
        }

        logging.info(f"Starting processing with settings: {text_settings}, interpolate_values: {interpolate_values}")

        # Get user's preferred locale
        user_locale = 'ru' if current_user.is_authenticated and hasattr(current_user, 'locale') and current_user.locale == 'ru' else 'en'

        # Start background processing with text settings, interpolation flag and locale
        process_project(project_id, resolution, fps, codec, text_settings, interpolate_values, locale=user_locale)

        return jsonify({'success': True, 'message': 'Processing started'})
    except Exception as e:
        logging.error(f"Error starting processing: {str(e)}")
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
                           download_name=f'processed_{project.csv_file}')

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
        text_settings = {'vertical_position': int(data.get('vertical_position', 50)),
            'top_padding': int(data.get('top_padding', 10)),
            'bottom_padding': int(data.get('bottom_padding', 30)),
            'spacing': int(data.get('spacing', 20)),
            'font_size': int(data.get('font_size', 26)),
            'border_radius': int(data.get('border_radius', 13)),
            # Speed indicator settings
            'indicator_x': float(data.get('indicator_x', 50)),
            'indicator_y': float(data.get('indicator_y', 80)),
            'speed_y': int(data.get('speed_y', 0)),
            'unit_y': int(data.get('unit_y',0)),'speed_size': float(data.get('speed_size', 100)),
            'unit_size': float(data.get('unit_size', 100)),
            'indicator_scale': float(data.get('indicator_scale', 100))
        }

        logging.info(f"Generating preview with settings: {text_settings}")

        # Get user's preferred locale
        user_locale = 'ru' if current_user.is_authenticated and hasattr(current_user, 'locale') and current_user.locale == 'ru' else 'en'

        preview_path = create_preview_frame(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project_id,
            resolution,
            text_settings,
            locale=user_locale  # Pass the user's locale
        )

        return jsonify({
            'success': True,
            'preview_url': url_for('serve_preview', filename=f'{project_id}_preview.png')
        })
    except Exception as e:
        logging.error(f"Error generating preview: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/stop/<int:project_id>', methods=['POST'])
@login_required
def stop_project(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    try:
        if project.status == 'processing':
            # Force status to error to stop processing
            project.status = 'error'
            project.error_message = 'Process stopped by user'
            project.processing_completed_at = datetime.now()
            db.session.commit()

            # Delete associated files
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
        else:
            return jsonify({'error': 'Project is not in processing state'}), 400

    except Exception as e:
        logging.error(f"Error stopping project: {str(e)}")
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
            used_folders = {f'project_{project.folder_number}'}  # frames directory

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

with app.app_context():
    db.create_all()

# Start collecting stats when the app starts
stats_thread = threading.Thread(target=collect_system_stats, daemon=True)
stats_thread.start()

# Start cleanup thread when app starts
cleanup_thread = threading.Thread(target=cleanup_expired_projects, daemon=True)
cleanup_thread.start()