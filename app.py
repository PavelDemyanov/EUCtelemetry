import os
import logging
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, send_file, url_for
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
os.makedirs('previews', exist_ok=True)
os.makedirs('temp', exist_ok=True)  # Added for temporary files

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

    try:
        # Generate temporary ID based on timestamp
        temp_id = int(datetime.now().timestamp() * 1000)

        filename = secure_filename(file.filename)
        temp_file_path = os.path.join('temp', f'{temp_id}_{filename}')
        file.save(temp_file_path)

        # Process CSV file to determine type
        csv_type, _ = process_csv_file(temp_file_path)

        return jsonify({
            'success': True,
            'temp_id': temp_id,
            'csv_type': csv_type,
            'original_filename': filename
        })

    except Exception as e:
        logging.error(f"Error processing upload: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/preview/<int:temp_id>', methods=['POST'])
def generate_preview(temp_id):
    resolution = request.form.get('resolution', 'fullhd')
    original_filename = request.form.get('filename')

    try:
        temp_file_path = next(
            f for f in os.listdir('temp') 
            if f.startswith(f'{temp_id}_')
        )

        from utils.image_generator import create_preview_frame

        preview_path = create_preview_frame(
            os.path.join('temp', temp_file_path),
            temp_id,
            resolution
        )

        return jsonify({
            'success': True,
            'preview_url': url_for('static', filename=f'previews/{temp_id}_preview.png')
        })
    except Exception as e:
        logging.error(f"Error generating preview: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/generate_frames/<int:temp_id>', methods=['POST'])
def generate_project_frames(temp_id):
    resolution = request.form.get('resolution', 'fullhd')
    fps = float(request.form.get('fps', 29.97))

    try:
        # Find temporary file
        temp_file_path = next(
            f for f in os.listdir('temp') 
            if f.startswith(f'{temp_id}_')
        )

        frame_count, duration = generate_frames(
            os.path.join('temp', temp_file_path),
            temp_id,
            resolution,
            fps
        )

        return jsonify({'success': True, 'frame_count': frame_count, 'duration': duration})
    except Exception as e:
        logging.error(f"Error generating frames: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/create_video/<int:temp_id>', methods=['POST'])
def create_project_video(temp_id):
    fps = float(request.form.get('fps', 29.97))
    codec = request.form.get('codec', 'h264')
    resolution = request.form.get('resolution', 'fullhd')
    project_name = request.form.get('project_name', '')

    try:
        # Find temporary file
        temp_file_path = next(
            f for f in os.listdir('temp') 
            if f.startswith(f'{temp_id}_')
        )

        # Create video
        video_path = create_video(temp_id, fps, codec, resolution)

        # Only now create the project in database
        if not project_name:
            project_name = f"project_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        # Get original filename from temp file
        original_filename = temp_file_path[len(str(temp_id))+1:]

        # Move temp file to uploads
        os.rename(
            os.path.join('temp', temp_file_path),
            os.path.join(app.config['UPLOAD_FOLDER'], original_filename)
        )

        # Create project
        project = Project(
            name=project_name,
            csv_file=original_filename,
            csv_type=request.form.get('csv_type'),
            created_at=datetime.now(),
            expiry_date=datetime.now() + timedelta(days=30),
            frame_count=int(request.form.get('frame_count', 0)),
            fps=fps,
            video_file=os.path.basename(video_path),
            codec=codec,
            resolution=resolution,
            video_duration=float(request.form.get('duration', 0))
        )
        db.session.add(project)
        db.session.commit()

        return jsonify({
            'success': True,
            'project_id': project.id,
            'video_path': video_path
        })
    except Exception as e:
        logging.error(f"Error creating video: {str(e)}")
        # Clean up temporary files on error
        try:
            if 'temp_file_path' in locals():
                os.remove(os.path.join('temp', temp_file_path))
            frames_dir = f'frames/project_{temp_id}'
            if os.path.exists(frames_dir):
                import shutil
                shutil.rmtree(frames_dir)
        except Exception as cleanup_error:
            logging.error(f"Error cleaning up: {cleanup_error}")
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
        # Delete associated files
        if project.csv_file:
            csv_path = os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file)
            if os.path.exists(csv_path):
                os.remove(csv_path)

        if project.video_file:
            video_path = os.path.join('videos', project.video_file)
            if os.path.exists(video_path):
                os.remove(video_path)

        # Delete frames directory
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