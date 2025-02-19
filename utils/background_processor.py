import threading
import logging
import shutil
from extensions import db
from utils.csv_processor import process_csv_file
from utils.image_generator import generate_frames
from utils.video_creator import create_video
from utils.hardware_detection import get_hardware_info
import os
import time
from datetime import datetime

def remove_directory_with_retry(directory, max_retries=3, delay=1):
    """Attempts to remove a directory with retries"""
    for attempt in range(max_retries):
        try:
            if os.path.exists(directory):
                shutil.rmtree(directory)
            return True
        except Exception as e:
            if attempt == max_retries - 1:
                logging.error(f"Failed to remove directory {directory} after {max_retries} attempts: {e}")
                raise
            logging.warning(f"Attempt {attempt + 1} to remove directory failed, retrying in {delay} seconds...")
            time.sleep(delay)
    return False

def stop_project_processing(project_id):
    """Stop project processing and cleanup resources"""
    from app import app

    with app.app_context():
        try:
            from models import Project
            project = Project.query.get(project_id)
            if not project:
                logging.error(f"Project {project_id} not found")
                return False, "Project not found"

            # Update project status to indicate stopping
            project.status = 'stopping'
            db.session.commit()

            # Clean up project directories
            frames_dir = f'frames/project_{project.folder_number}'
            try:
                remove_directory_with_retry(frames_dir)
            except Exception as e:
                logging.error(f"Error cleaning up project directories: {e}")
                project.status = 'error'
                project.error_message = f"Failed to cleanup project resources: {str(e)}"
                db.session.commit()
                return False, str(e)

            # Update project status
            project.status = 'stopped'
            project.progress = 0
            db.session.commit()
            return True, "Project stopped successfully"

        except Exception as e:
            logging.error(f"Error stopping project {project_id}: {str(e)}")
            return False, str(e)

def process_project(project_id, resolution='fullhd', fps=29.97, codec='h264', text_settings=None, interpolate_values=True, locale='en'):
    """Process project in background thread"""
    # Initialize text_settings at the module level
    project_text_settings = text_settings if text_settings is not None else {}

    def _process():
        from app import app  # Import app here to avoid circular import

        with app.app_context():
            try:
                from models import Project
                project = Project.query.get(project_id)
                if not project:
                    logging.error(f"Project {project_id} not found")
                    return

                # Check if project is already being stopped
                if project.status == 'stopping':
                    logging.info(f"Project {project_id} is being stopped, canceling processing")
                    return

                # Log hardware information and settings at the start of processing
                hardware_info = get_hardware_info()
                logging.info(f"Starting project processing with hardware configuration: {hardware_info}")
                logging.info(f"Processing settings - Resolution: {resolution}, FPS: {fps}, Codec: {codec}, Interpolation: {'enabled' if interpolate_values else 'disabled'}")
                logging.info(f"Text settings for processing: {project_text_settings}")

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
                remove_directory_with_retry(frames_dir)
                os.makedirs(frames_dir, exist_ok=True)

                # Process CSV file using existing project csv_type and interpolation flag
                csv_file = os.path.join('uploads', project.csv_file)
                _, _ = process_csv_file(csv_file, project.folder_number, project.csv_type, interpolate_values)

                def progress_callback(current_frame, total_frames, stage='frames'):
                    """Update progress in database"""
                    try:
                        with app.app_context():
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

                # Log visibility settings before frame generation
                logging.info(f"Visibility settings before frame generation: {project_text_settings}")

                # Generate frames with progress tracking, interpolation setting and locale
                frame_count, duration = generate_frames(
                    csv_file,
                    project.folder_number,
                    resolution,
                    fps,
                    project_text_settings,  # Pass the complete text_settings dictionary
                    progress_callback,
                    interpolate_values,
                    locale
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