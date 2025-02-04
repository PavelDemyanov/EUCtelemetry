import os
import logging
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, send_file
from werkzeug.utils import secure_filename
from extensions import db
from utils.csv_processor import process_csv_file
from utils.image_generator import generate_frames
from utils.video_creator import create_video

# Configure logging
logging.basicConfig(level=logging.DEBUG)

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

    project_name = request.form.get('project_name', '')
    if not project_name:
        project_name = f"project_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    try:
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        # Process CSV file
        csv_type, data = process_csv_file(file_path)

        # Create project
        project = Project(
            name=project_name,
            csv_file=filename,
            csv_type=csv_type,
            created_at=datetime.now(),
            expiry_date=datetime.now() + timedelta(days=30)
        )
        db.session.add(project)
        db.session.commit()

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
    resolution = request.form.get('resolution', 'fullhd')
    fps = float(request.form.get('fps', 29.97))

    try:
        frame_count, duration = generate_frames(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project_id,
            resolution,
            fps
        )

        project.frame_count = frame_count
        project.video_duration = duration  # Save the actual duration from timestamps
        project.fps = fps  # Save the user specified fps
        db.session.commit()

        return jsonify({'success': True, 'frame_count': frame_count, 'duration': duration})
    except Exception as e:
        logging.error(f"Error generating frames: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/create_video/<int:project_id>', methods=['POST'])
def create_project_video(project_id):
    project = Project.query.get_or_404(project_id)
    fps = float(request.form.get('fps', 29.97))
    codec = request.form.get('codec', 'h264')
    resolution = request.form.get('resolution', 'fullhd')

    try:
        video_path = create_video(project_id, fps, codec, resolution)
        project.video_file = os.path.basename(video_path)
        project.fps = fps
        project.codec = codec
        project.resolution = resolution
        # Duration is already set when generating frames
        db.session.commit()

        return jsonify({'success': True, 'video_path': video_path})
    except Exception as e:
        logging.error(f"Error creating video: {str(e)}")
        return jsonify({'error': str(e)}), 500

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

        if project.video_file:
            video_path = os.path.join('videos', project.video_file)
            if os.path.exists(video_path):
                os.remove(video_path)

        # Delete frames directory if it exists
        frames_dir = f'frames/project_{project_id}'
        if os.path.exists(frames_dir):
            import shutil
            shutil.rmtree(frames_dir)

        # Delete project from database
        db.session.delete(project)
        db.session.commit()

        return jsonify({'success': True})
    except Exception as e:
        logging.error(f"Error deleting project: {str(e)}")
        return jsonify({'error': str(e)}), 500

with app.app_context():
    db.create_all()