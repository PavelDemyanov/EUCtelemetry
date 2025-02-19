import threading
import logging
import time
from extensions import db
from utils.csv_processor import process_csv_file
from utils.image_generator import generate_frames
from utils.video_creator import create_video
from utils.hardware_detection import get_hardware_info
import os
from datetime import datetime

# Global dictionary to track processing threads and stop events
processing_threads = {}
stop_events = {}

def process_project(project_id, resolution='fullhd', fps=29.97, codec='h264', text_settings=None, interpolate_values=True, locale='en'):
    """Process project in background thread"""
    # Initialize text_settings at the module level
    project_text_settings = text_settings if text_settings is not None else {}

    # Create stop event for this project
    stop_events[project_id] = threading.Event()

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
                            # Check if project was cancelled or stop event is set
                            if stop_events[project_id].is_set() or (project and project.status == 'cancelled'):
                                raise Exception("Project cancelled")

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
                        raise

                # Process CSV file
                csv_file = os.path.join('uploads', project.csv_file)
                _, _ = process_csv_file(csv_file, project.folder_number)

                # Check if project was cancelled
                if stop_events[project_id].is_set() or Project.query.get(project_id).status == 'cancelled':
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
                if stop_events[project_id].is_set() or Project.query.get(project_id).status == 'cancelled':
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
                            if project.status != 'cancelled':  # Don't overwrite status if project was cancelled
                                project.status = 'error'
                                project.error_message = str(e)
                            project.processing_completed_at = datetime.now()
                            db.session.commit()
                except Exception as db_error:
                    logging.error(f"Error updating project status: {str(db_error)}")
            finally:
                # Clean up flags and threads after completion
                if project_id in processing_threads:
                    del processing_threads[project_id]
                if project_id in stop_events:
                    del stop_events[project_id]

    # Create and start the processing thread
    process_thread = threading.Thread(target=_process)
    process_thread.daemon = True

    # Store the thread in the global dictionary
    processing_threads[project_id] = process_thread

    process_thread.start()

def stop_project_processing(project):
    """Stop project processing without cleaning up files"""
    try:
        # Set stop event if it exists
        if project.id in stop_events:
            stop_events[project.id].set()
            logging.info(f"Set stop event for project {project.id}")

        # Wait for processing thread to complete
        if project.id in processing_threads:
            logging.info(f"Waiting for processing thread to complete for project {project.id}")
            thread = processing_threads[project.id]
            thread.join(timeout=5)  # Short timeout, as we don't need to wait for all operations to finish

            if thread.is_alive():
                logging.warning(f"Thread for project {project.id} is still alive after timeout")

        return True
    except Exception as e:
        logging.error(f"Error in stop_project_processing: {e}")
        return False