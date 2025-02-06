import os
import logging
import random
import re
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, send_file, url_for
from werkzeug.utils import secure_filename
from extensions import db
from utils.csv_processor import process_csv_file
from utils.image_generator import generate_frames, create_preview_frame
from utils.video_creator import create_video
from utils.background_processor import process_project

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Символы для генерации имени проекта
PROJECT_NAME_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

def generate_project_name():
    """Генерирует случайное имя проекта длиной 5 символов"""
    return ''.join(random.choice(PROJECT_NAME_CHARS) for _ in range(5))

def validate_project_name(name):
    """Проверяет валидность имени проекта"""
    if not name:
        return False
    # Проверяем длину и допустимые символы (буквы любого языка и цифры)
    return len(name) <= 7 and bool(re.match(r'^[\w\d]+$', name, re.UNICODE))

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///projects.db'
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# Ensure upload directories exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs('frames', exist_ok=True)
os.makedirs('videos', exist_ok=True)
os.makedirs('processed_data', exist_ok=True)
os.makedirs('previews', exist_ok=True)

db.init_app(app)

from models import Project

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    project_name = request.form.get('project_name', '').strip()

    # Валидация пользовательского имени или генерация нового
    if project_name:
        if not validate_project_name(project_name):
            return jsonify({'error': 'Invalid project name. Use up to 7 letters or numbers.'}), 400
    else:
        project_name = generate_project_name()

    try:
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        # Process CSV file
        csv_type, data = process_csv_file(file_path)

        # Create project with a unique folder number
        project = Project(
            name=project_name,
            csv_file=filename,
            csv_type=csv_type,
            created_at=datetime.now(),
            expiry_date=datetime.now() + timedelta(days=30),
            status='pending',
            folder_number=Project.get_next_folder_number()  # Get a unique folder number
        )
        db.session.add(project)
        db.session.commit()

        # Create initial preview with default settings
        default_settings = {
            'vertical_position': 1,
            'top_padding': 14,
            'bottom_padding': 47,
            'spacing': 10,
            'font_size': 26,
            'border_radius': 13  # Explicitly set default border radius
        }

        preview_path = create_preview_frame(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project.id,
            'fullhd',
            default_settings
        )

        return jsonify({
            'success': True,
            'project_id': project.id,
            'csv_type': csv_type
        })

    except Exception as e:
        logging.error(f"Error processing upload: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/generate_frames/<int:project_id>', methods=['POST'])
def generate_project_frames(project_id):
    project = Project.query.get_or_404(project_id)

    try:
        # Get settings from request
        data = request.get_json() if request.is_json else {}
        resolution = data.get('resolution', 'fullhd')
        fps = float(data.get('fps', 29.97))
        codec = data.get('codec', 'h264')

        # Get text display settings with explicit defaults
        text_settings = {
            'vertical_position': int(data.get('vertical_position', 50)),
            'top_padding': int(data.get('top_padding', 10)),
            'bottom_padding': int(data.get('bottom_padding', 30)),
            'spacing': int(data.get('spacing', 20)),
            'font_size': int(data.get('font_size', 26)),
            'border_radius': int(data.get('border_radius', 13))  # Ensure border_radius is included
        }

        logging.info(f"Starting processing with settings: {text_settings}")  # Add logging

        # Start background processing with text settings
        process_project(project_id, resolution, fps, codec, text_settings)

        return jsonify({'success': True, 'message': 'Processing started'})
    except Exception as e:
        logging.error(f"Error starting processing: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/project_status/<int:project_id>')
def project_status(project_id):
    project = Project.query.get_or_404(project_id)
    return jsonify({
        'status': project.status,
        'frame_count': project.frame_count,
        'video_file': project.video_file,
        'error_message': project.error_message
    })


@app.route('/projects')
def list_projects():
    page = request.args.get('page', 1, type=int)
    projects = Project.query.order_by(Project.created_at.desc())\
        .paginate(page=page, per_page=10, error_out=False)
    return render_template('projects.html', projects=projects)

@app.route('/download/<int:project_id>/<type>')
def download_file(project_id, type):
    project = Project.query.get_or_404(project_id)

    if type == 'video' and project.video_file:
        return send_file(f'videos/{project.video_file}')
    elif type == 'frames':
        # TODO: Implement frame download as ZIP
        pass
    elif type == 'processed_csv':
        processed_csv = os.path.join('processed_data', f'processed_{project.csv_file}')
        if os.path.exists(processed_csv):
            return send_file(processed_csv, as_attachment=True, 
                           download_name=f'processed_{project.csv_file}')

    return jsonify({'error': 'File not found'}), 404

@app.route('/delete/<int:project_id>', methods=['POST'])
def delete_project(project_id):
    project = Project.query.get_or_404(project_id)

    try:
        # Delete associated files if they exist
        if project.csv_file:
            csv_path = os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file)
            if os.path.exists(csv_path):
                os.remove(csv_path)

        # Delete preview file if exists
        preview_path = os.path.join('static/previews', f'{project_id}_preview.png')
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
        processed_csv = os.path.join('processed_data', f'processed_{project.csv_file}')
        if os.path.exists(processed_csv):
            os.remove(processed_csv)

        # Delete project from database
        db.session.delete(project)
        db.session.commit()

        return jsonify({'success': True})
    except Exception as e:
        logging.error(f"Error deleting project: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/preview/<int:project_id>', methods=['POST'])
def generate_preview(project_id):
    project = Project.query.get_or_404(project_id)

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
            'border_radius': int(data.get('border_radius', 13))  # Use same default as in upload
        }

        logging.info(f"Generating preview with settings: {text_settings}")  # Add logging

        preview_path = create_preview_frame(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project_id,
            resolution,
            text_settings
        )

        return jsonify({
            'success': True,
            'preview_url': url_for('static', filename=f'previews/{project_id}_preview.png')
        })
    except Exception as e:
        logging.error(f"Error generating preview: {str(e)}")
        return jsonify({'error': str(e)}), 500

with app.app_context():
    db.create_all()