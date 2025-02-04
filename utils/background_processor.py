import threading
import logging
from extensions import db
from utils.csv_processor import process_csv_file
from utils.image_generator import generate_frames
from utils.video_creator import create_video
import os

def process_project(project_id, resolution='fullhd', fps=29.97, codec='h264'):
    """Process project in background thread"""
    def _process():
        from app import app  # Import app here to avoid circular import
        
        with app.app_context():
            try:
                from models import Project
                project = Project.query.get(project_id)
                if not project:
                    logging.error(f"Project {project_id} not found")
                    return

                project.status = 'processing'
                db.session.commit()

                # Generate frames
                frame_count, duration = generate_frames(
                    os.path.join('uploads', project.csv_file),
                    project_id,
                    resolution,
                    fps
                )

                project.frame_count = frame_count
                project.video_duration = duration
                project.fps = fps
                db.session.commit()

                # Create video
                video_path = create_video(project_id, fps, codec, resolution)
                
                # Update project with video info
                project.video_file = os.path.basename(video_path)
                project.codec = codec
                project.resolution = resolution
                project.status = 'completed'
                db.session.commit()

            except Exception as e:
                logging.error(f"Error processing project {project_id}: {str(e)}")
                try:
                    project.status = 'error'
                    project.error_message = str(e)
                    db.session.commit()
                except Exception as db_error:
                    logging.error(f"Error updating project status: {str(db_error)}")

    # Start background thread
    thread = threading.Thread(target=_process)
    thread.daemon = True
    thread.start()
