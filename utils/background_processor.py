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
        from models import Project  # Import here to avoid circular import
        from flask import current_app

        try:
            with current_app.app_context():
                project = Project.query.get(project_id)
                if not project:
                    logging.error(f"Project {project_id} not found")
                    return

                # Log hardware information and settings at the start of processing
                hardware_info = get_hardware_info()
                logging.info(f"Starting project processing with hardware configuration: {hardware_info}")
                logging.info(f"Processing settings - Resolution: {resolution}, FPS: {fps}, Codec: {codec}")
                logging.info(f"Text settings for processing: {project_text_settings}")

                project.status = 'processing'
                project.fps = float(fps)
                project.resolution = resolution
                project.codec = codec
                project.processing_started_at = datetime.now()
                project.progress = 0
                db.session.commit()

                # Store process info
                running_processes[project_id] = {
                    'pid': os.getpid(),
                    'stage': 'frames'
                }

                def progress_callback(current_frame, total_frames, stage='frames'):
                    try:
                        with current_app.app_context():
                            project = Project.query.get(project_id)
                            if project and project.status != 'stopped':
                                progress = (current_frame / total_frames) * (50 if stage == 'frames' else 100)
                                project.progress = progress
                                db.session.commit()
                                logging.info(f"Updated progress: {progress:.1f}% for stage: {stage}")
                    except Exception as e:
                        logging.error(f"Error updating progress: {e}")

                # Process CSV file
                csv_file = os.path.join('uploads', project.csv_file)
                logging.info(f"Starting CSV processing for project {project_id}")
                _, _ = process_csv_file(csv_file, project.folder_number, project.csv_type, interpolate_values)

                # Check if project should continue
                project = Project.query.get(project_id)
                if project.status == 'stopped':
                    logging.info(f"Project {project_id} was stopped after CSV processing")
                    return

                # Generate frames
                logging.info(f"Starting frame generation for project {project_id}")
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

                # Check if project should continue
                project = Project.query.get(project_id)
                if project.status == 'stopped':
                    logging.info(f"Project {project_id} was stopped after frame generation")
                    return

                # Update frame count and duration
                project.frame_count = int(frame_count)
                project.video_duration = float(duration)
                db.session.commit()

                # Create video
                logging.info(f"Starting video creation for project {project_id}")
                video_path = create_video(
                    project.folder_number,
                    fps,
                    codec,
                    resolution,
                    progress_callback
                )

                # Final check before completion
                project = Project.query.get(project_id)
                if project.status == 'stopped':
                    logging.info(f"Project {project_id} was stopped after video creation")
                    return

                # Update project status on completion
                project.video_file = os.path.basename(video_path)
                project.status = 'completed'
                project.progress = 100
                project.processing_completed_at = datetime.now()
                db.session.commit()
                logging.info(f"Project {project_id} completed successfully")

        except Exception as e:
            logging.error(f"Error processing project {project_id}: {str(e)}")
            try:
                with current_app.app_context():
                    project = Project.query.get(project_id)
                    if project:
                        project.status = 'error'
                        project.error_message = str(e)
                        project.processing_completed_at = datetime.now()
                        db.session.commit()
            except Exception as db_error:
                logging.error(f"Error updating project status: {str(db_error)}")
        finally:
            # Cleanup process info
            if project_id in running_processes:
                del running_processes[project_id]

    # Start background thread
    thread = threading.Thread(target=_process)
    thread.daemon = True
    thread.start()
    logging.info(f"Started background processing thread for project {project_id}")

def stop_project_processing(project_id):
    """Stop the processing of a project"""
    try:
        from models import Project
        from flask import current_app

        with current_app.app_context():
            # First update the project status
            project = Project.query.get(project_id)
            if project:
                project.status = 'stopped'
                project.error_message = 'Processing stopped by user'
                project.processing_completed_at = datetime.now()
                db.session.commit()
                logging.info(f"Updated status to stopped for project {project_id}")

        # Then try to terminate the process if it exists
        if project_id in running_processes:
            try:
                pid = running_processes[project_id]['pid']
                os.kill(pid, signal.SIGTERM)
                logging.info(f"Sent SIGTERM to process {pid} for project {project_id}")
            except (ProcessLookupError, psutil.NoSuchProcess):
                logging.warning(f"Process for project {project_id} no longer exists")
            except Exception as e:
                logging.error(f"Error terminating process: {str(e)}")
            finally:
                del running_processes[project_id]
                logging.info(f"Removed project {project_id} from running processes")

        return True

    except Exception as e:
        logging.error(f"Error stopping project {project_id}: {str(e)}")
        return False