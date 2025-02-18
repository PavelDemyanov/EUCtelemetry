import threading
import logging
from extensions import db
from utils.csv_processor import process_csv_file
from utils.image_generator import generate_frames
from utils.video_creator import create_video
from utils.hardware_detection import get_hardware_info
import os
from datetime import datetime
from flask_babel import get_locale

def process_project(project_id, resolution='fullhd', fps=29.97, codec='h264', text_settings=None, interpolate_values=True):
    """Process project in background thread"""
    # Get current locale before starting background process
    try:
        current_locale = str(get_locale())
    except RuntimeError:
        current_locale = 'en'  # Default to English if no request context
    logging.info(f"Using locale: {current_locale} for frame generation")

    def _process():
        from app import app  # Import app here to avoid circular import

        with app.app_context():
            try:
                from models import Project
                project = Project.query.get(project_id)
                if not project:
                    logging.error(f"Project {project_id} not found")
                    return

                # Log hardware information at the start of processing
                hardware_info = get_hardware_info()
                logging.info(f"Starting project processing with hardware configuration: {hardware_info}")
                logging.info(f"Processing settings - Resolution: {resolution}, FPS: {fps}, Codec: {codec}, Interpolation: {'enabled' if interpolate_values else 'disabled'}")

                project.status = 'processing'
                project.fps = float(fps)  # Convert to float explicitly
                project.resolution = resolution
                project.codec = codec
                project.processing_started_at = datetime.now()
                project.progress = 0  # Initialize progress
                db.session.commit()

                # Get unique folder number if not already assigned
                if project.folder_number is None:
                    project.folder_number = Project.get_next_folder_number()
                db.session.commit()

                # Create and clean project directory using unique folder number
                frames_dir = f'frames/project_{project.folder_number}'
                if os.path.exists(frames_dir):
                    shutil.rmtree(frames_dir)
                os.makedirs(frames_dir, exist_ok=True)

                # Process CSV file using existing project csv_type and interpolation flag
                csv_file = os.path.join('uploads', project.csv_file)
                _, _ = process_csv_file(csv_file, project.folder_number, project.csv_type, interpolate_values)

                def progress_callback(current_frame, total_frames, stage='frames'):
                    """Update progress in database"""
                    try:
                        with app.app_context():  # Ensure we have application context
                            # Reload project to avoid stale data
                            project = Project.query.get(project_id)
                            if project:
                                if stage == 'frames':
                                    # Frame generation progress (0-50%)
                                    progress = (current_frame / total_frames) * 50
                                else:
                                    # Video encoding progress (50-100%)
                                    progress = 50 + (current_frame / total_frames) * 50

                                project.progress = progress
                                db.session.commit()
                                logging.info(f"Progress updated in DB: {progress:.1f}% for stage: {stage}")
                    except Exception as e:
                        logging.error(f"Error updating progress: {e}")

                # Generate frames with progress tracking and interpolation setting
                frame_count, duration = generate_frames(
                    csv_file,
                    project.folder_number,
                    resolution,
                    fps,
                    text_settings,
                    progress_callback,
                    interpolate_values,
                    locale_str=current_locale  # Pass locale from outer scope
                )

                # Convert numpy values to Python native types
                project.frame_count = int(frame_count)
                project.video_duration = float(duration)
                db.session.commit()

                # Create video with progress tracking
                video_path = create_video(
                    project.folder_number,
                    fps,
                    codec,
                    resolution,
                    progress_callback
                )

                # Update project with video info and completion time
                project.video_file = os.path.basename(video_path)
                project.status = 'completed'
                project.progress = 100  # Ensure progress is 100% when completed
                project.processing_completed_at = datetime.now()
                db.session.commit()

            except Exception as e:
                logging.error(f"Error processing project {project_id}: {str(e)}")
                try:
                    with app.app_context():
                        project = Project.query.get(project_id)
                        if project:
                            project.status = 'error'
                            project.error_message = str(e)
                            project.processing_completed_at = datetime.now()
                            db.session.commit()
                except Exception as db_error:
                    logging.error(f"Error updating project status: {str(db_error)}")

    # Start background thread
    thread = threading.Thread(target=_process)
    thread.daemon = True
    thread.start()