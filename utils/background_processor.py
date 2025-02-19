import threading
import logging
import shutil
import time
from extensions import db
from utils.csv_processor import process_csv_file
from utils.image_generator import generate_frames
from utils.video_creator import create_video
from utils.hardware_detection import get_hardware_info
import os
from datetime import datetime

# Global dictionary to track processing threads
processing_threads = {}
processing_stop_flags = {}

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

                # Create frames directory
                frames_dir = f'frames/project_{project.folder_number}'
                os.makedirs(frames_dir, exist_ok=True)

                def progress_callback(current_frame, total_frames, stage='frames'):
                    """Update progress in database"""
                    try:
                        with app.app_context():
                            project = Project.query.get(project_id)
                            # Check if project was cancelled
                            if project and project.status != 'cancelled':
                                if stage == 'frames':
                                    # Frame generation progress (0-50%)
                                    progress = (current_frame / total_frames) * 50
                                else:
                                    # Video encoding progress (50-100%)
                                    progress = 50 + (current_frame / total_frames) * 50

                                project.progress = progress
                                db.session.commit()
                                logging.info(f"Progress updated in DB: {progress:.1f}% for stage: {stage}")
                            else:
                                # Если проект отменён, поднимаем исключение для остановки процесса
                                raise Exception("Project cancelled")
                    except Exception as e:
                        logging.error(f"Error updating progress: {e}")
                        raise

                # Process CSV file
                csv_file = os.path.join('uploads', project.csv_file)
                _, _ = process_csv_file(csv_file, project.folder_number)

                # Check if project was cancelled before frame generation
                project = Project.query.get(project_id)
                if project.status == 'cancelled':
                    logging.info(f"Project {project_id} was cancelled before frame generation")
                    return

                # Generate frames
                frame_count, duration = generate_frames(
                    csv_file,
                    project.folder_number,
                    resolution,
                    fps,
                    project_text_settings,
                    progress_callback,
                    interpolate_values,
                    locale
                )

                # Check if project was cancelled after frame generation
                project = Project.query.get(project_id)
                if project.status == 'cancelled':
                    logging.info(f"Project {project_id} was cancelled after frame generation")
                    return

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
                project.progress = 100
                project.processing_completed_at = datetime.now()
                db.session.commit()

            except Exception as e:
                logging.error(f"Error processing project {project_id}: {str(e)}")
                try:
                    with app.app_context():
                        project = Project.query.get(project_id)
                        if project:
                            if project.status != 'cancelled':  # Не перезаписываем статус, если проект был отменён
                                project.status = 'error'
                                project.error_message = str(e)
                            project.processing_completed_at = datetime.now()
                            db.session.commit()
                except Exception as db_error:
                    logging.error(f"Error updating project status: {str(db_error)}")
            finally:
                # Очищаем флаги и потоки после завершения
                if project_id in processing_threads:
                    del processing_threads[project_id]
                if project_id in processing_stop_flags:
                    del processing_stop_flags[project_id]

    # Create and start the processing thread
    process_thread = threading.Thread(target=_process)
    process_thread.daemon = True

    # Store the thread in the global dictionary
    processing_threads[project_id] = process_thread
    processing_stop_flags[project_id] = False

    process_thread.start()

def cleanup_project_files(project):
    """Clean up project files safely"""
    max_retries = 3
    retry_delay = 2  # seconds

    try:
        # Ждём, пока процесс обработки точно завершится
        if project.id in processing_threads:
            logging.info(f"Waiting for processing thread to complete for project {project.id}")
            processing_threads[project.id].join(timeout=10)  # Ждём максимум 10 секунд

        frames_dir = f'frames/project_{project.folder_number}'
        if os.path.exists(frames_dir):
            for attempt in range(max_retries):
                try:
                    time.sleep(retry_delay)  # Ждём перед каждой попыткой
                    shutil.rmtree(frames_dir, ignore_errors=True)
                    logging.info(f"Successfully cleaned up frames directory: {frames_dir} on attempt {attempt + 1}")
                    break
                except Exception as e:
                    logging.error(f"Error cleaning up frames directory on attempt {attempt + 1}: {e}")
                    if attempt == max_retries - 1:
                        logging.error(f"Failed to clean up frames directory after {max_retries} attempts")
    except Exception as e:
        logging.error(f"Error in cleanup_project_files: {e}")