import os
import logging
import random
import re
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, send_file, url_for, send_from_directory, flash, redirect
from werkzeug.utils import secure_filename
from flask_migrate import Migrate
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from extensions import db
from utils.csv_processor import process_csv_file
from utils.image_generator import generate_frames, create_preview_frame
from utils.video_creator import create_video
from utils.background_processor import process_project
from forms import LoginForm, RegistrationForm, ProfileForm
from models import User, Project

# Configure logging
logging.basicConfig(level=logging.DEBUG)

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

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'your-secret-key-here')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'postgresql://your_default_username:your_default_password@localhost/euc_telemetry')
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_recycle': 300,
    'pool_pre_ping': True,
}
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# Initialize Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Пожалуйста, войдите для доступа к этой странице.'

@login_manager.user_loader
def load_user(id):
    return User.query.get(int(id))

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
            flash('Неверный email или пароль')
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
            flash('Этот email уже зарегистрирован')
            return redirect(url_for('register'))
        user = User(email=form.email.data, name=form.name.data)
        user.set_password(form.password.data)
        db.session.add(user)
        db.session.commit()
        flash('Поздравляем с успешной регистрацией!')
        return redirect(url_for('login'))
    return render_template('register.html', form=form)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/profile', methods=['GET', 'POST'])
@login_required
def profile():
    form = ProfileForm(obj=current_user)
    if form.validate_on_submit():
        current_user.name = form.name.data
        if form.email.data != current_user.email:
            if User.query.filter_by(email=form.email.data).first():
                flash('Этот email уже используется')
                return redirect(url_for('profile'))
            current_user.email = form.email.data
        db.session.commit()
        flash('Профиль обновлен')
        return redirect(url_for('profile'))
    return render_template('profile.html', form=form)


# Existing routes with added authentication
@app.route('/')
def index():
    return render_template('index.html')

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
            'border_radius': int(data.get('border_radius', 13))
        }

        logging.info(f"Starting processing with settings: {text_settings}")

        # Start background processing with text settings
        process_project(project_id, resolution, fps, codec, text_settings)

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
            import shutil
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
        text_settings = {
            'vertical_position': int(data.get('vertical_position', 50)),
            'top_padding': int(data.get('top_padding', 10)),
            'bottom_padding': int(data.get('bottom_padding', 30)),
            'spacing': int(data.get('spacing', 20)),
            'font_size': int(data.get('font_size', 26)),
            'border_radius': int(data.get('border_radius', 13))
        }

        logging.info(f"Generating preview with settings: {text_settings}")

        preview_path = create_preview_frame(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project_id,
            resolution,
            text_settings
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
                import shutil
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

with app.app_context():
    db.create_all()