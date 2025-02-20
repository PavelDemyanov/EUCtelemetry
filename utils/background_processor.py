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

        try:
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
                    project = Project.query.get(project_id)
                    if project and project.status != 'stopped':
                        progress = (current_frame / total_frames) * (50 if stage == 'frames' else 100)
                        project.progress = progress
                        db.session.commit()
                except Exception as e:
                    logging.error(f"Error updating progress: {e}")

            # Process CSV file
            csv_file = os.path.join('uploads', project.csv_file)

            # Check if project should continue
            project = Project.query.get(project_id)
            if project.status == 'stopped':
                return

            _, _ = process_csv_file(csv_file, project.folder_number, project.csv_type, interpolate_values)

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

            # Check if project should continue
            project = Project.query.get(project_id)
            if project.status == 'stopped':
                return

            # Update frame count and duration
            project.frame_count = int(frame_count)
            project.video_duration = float(duration)
            db.session.commit()

            # Create video
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
                return

            # Update project status on completion
            project.video_file = os.path.basename(video_path)
            project.status = 'completed'
            project.progress = 100
            project.processing_completed_at = datetime.now()
            db.session.commit()

        except Exception as e:
            logging.error(f"Error processing project {project_id}: {str(e)}")
            try:
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

def stop_project_processing(project_id):
    """Stop the processing of a project"""
    try:
        from models import Project

        # First update the project status
        project = Project.query.get(project_id)
        if project:
            project.status = 'stopped'
            project.error_message = 'Processing stopped by user'
            project.processing_completed_at = datetime.now()
            db.session.commit()

        # Then try to terminate the process if it exists
        if project_id in running_processes:
            try:
                pid = running_processes[project_id]['pid']
                os.kill(pid, signal.SIGTERM)
            except (ProcessLookupError, psutil.NoSuchProcess):
                logging.warning(f"Process {pid} for project {project_id} no longer exists")
            except Exception as e:
                logging.error(f"Error terminating process: {str(e)}")
            finally:
                del running_processes[project_id]

        return True

    except Exception as e:
        logging.error(f"Error stopping project {project_id}: {str(e)}")
        return False