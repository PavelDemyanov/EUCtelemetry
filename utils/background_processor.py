import threading
import logging
import shutil
from extensions import db
from utils.csv_processor import process_csv_file
from utils.image_generator import generate_frames
from utils.video_creator import create_video
from utils.hardware_detection import get_hardware_info
import os
import signal
import psutil
from datetime import datetime

# Dictionary to store running process information
running_processes = {}

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

                # Store the process information
                current_process = psutil.Process()
                process_info = {
                    'pid': current_process.pid,
                    'stage': 'frames'
                }
                running_processes[project_id] = process_info

                def progress_callback(current_frame, total_frames, stage='frames'):
                    """Update progress in database"""
                    try:
                        with app.app_context():
                            project = Project.query.get(project_id)
                            if project and project.status != 'stopped':
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

                # Check if project was stopped before frame generation
                if project_id not in running_processes:
                    logging.info(f"Project {project_id} was stopped before frame generation")
                    return

                # Process CSV file using existing project csv_type and interpolation flag
                csv_file = os.path.join('uploads', project.csv_file)
                _, _ = process_csv_file(csv_file, project.folder_number, project.csv_type, interpolate_values)

                # Generate frames with progress tracking
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

                # Check if project was stopped during frame generation
                if project_id not in running_processes:
                    logging.info(f"Project {project_id} was stopped during frame generation")
                    return

                # Update stage to video creation
                process_info['stage'] = 'video'
                running_processes[project_id] = process_info

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

                # Remove process from running processes
                if project_id in running_processes:
                    del running_processes[project_id]

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
                finally:
                    # Remove process from running processes in case of error
                    if project_id in running_processes:
                        del running_processes[project_id]

    # Start background thread
    thread = threading.Thread(target=_process)
    thread.daemon = True
    thread.start()

def stop_project_processing(project_id):
    """Stop the processing of a project"""
    if project_id not in running_processes:
        logging.warning(f"No running process found for project {project_id}")
        return False

    try:
        # First update project status in database
        from app import app
        with app.app_context():
            from models import Project
            project = Project.query.get(project_id)
            if project:
                project.status = 'stopped'
                project.error_message = 'Processing stopped by user'
                project.processing_completed_at = datetime.now()
                db.session.commit()

        # Then try to terminate the process
        process_info = running_processes[project_id]
        try:
            process = psutil.Process(process_info['pid'])

            # Try to terminate child processes first
            children = process.children(recursive=True)
            for child in children:
                try:
                    os.kill(child.pid, signal.SIGTERM)
                except (ProcessLookupError, psutil.NoSuchProcess):
                    pass

            # Give children time to terminate
            psutil.wait_procs(children, timeout=3)

            # Terminate the main process
            os.kill(process.pid, signal.SIGTERM)

        except (psutil.NoSuchProcess, ProcessLookupError):
            logging.warning(f"Process {process_info['pid']} for project {project_id} no longer exists")
        except Exception as e:
            logging.error(f"Error killing process: {str(e)}")

        # Finally remove from running processes
        if project_id in running_processes:
            del running_processes[project_id]

        return True

    except Exception as e:
        logging.error(f"Error stopping project {project_id}: {str(e)}")
        if project_id in running_processes:
            del running_processes[project_id]
        return False