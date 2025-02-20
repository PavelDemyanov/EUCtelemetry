import threading
import logging
import shutil
from datetime import datetime
import os
import signal
import psutil
import time

# Dictionary to store running process information
running_processes = {}
stop_flags = {}

def process_project(project_id, resolution='fullhd', fps=29.97, codec='h264', text_settings=None, interpolate_values=True, locale='en'):
    """Process project in background thread"""
    from app import app, db
    from models import Project
    from utils.csv_processor import process_csv_file
    from utils.image_generator import generate_frames
    from utils.video_creator import create_video
    from utils.hardware_detection import get_hardware_info

    # Initialize stop flag for this project
    stop_flags[project_id] = False
    project_text_settings = text_settings if text_settings is not None else {}

    def should_stop():
        """Check if the project should stop processing"""
        return stop_flags.get(project_id, False)

    def _process():
        try:
            logging.info(f"Starting processing for project {project_id}")

            with app.app_context():
                project = Project.query.get(project_id)
                if not project:
                    logging.error(f"Project {project_id} not found")
                    return

                hardware_info = get_hardware_info()
                logging.info(f"Hardware configuration: {hardware_info}")
                logging.info(f"Settings - Resolution: {resolution}, FPS: {fps}, Codec: {codec}")

                project.status = 'processing'
                project.fps = float(fps)
                project.resolution = resolution
                project.codec = codec
                project.processing_started_at = datetime.now()
                project.progress = 0
                db.session.commit()

                running_processes[project_id] = {
                    'pid': os.getpid(),
                    'stage': 'frames'
                }

                def progress_callback(current_frame, total_frames, stage='frames'):
                    if should_stop():
                        raise InterruptedError("Processing was stopped by user")

                    try:
                        with app.app_context():
                            project = Project.query.get(project_id)
                            if project and project.status != 'stopped':
                                progress = (current_frame / total_frames) * (50 if stage == 'frames' else 100)
                                project.progress = progress
                                db.session.commit()
                                logging.info(f"Progress: {progress:.1f}% for stage: {stage}")
                    except Exception as e:
                        logging.error(f"Error updating progress: {e}")

                if should_stop():
                    raise InterruptedError("Processing was stopped by user")

                csv_file = os.path.join('uploads', project.csv_file)
                logging.info(f"Processing CSV file for project {project_id}")
                _, _ = process_csv_file(csv_file, project.folder_number, project.csv_type, interpolate_values)

                if should_stop():
                    raise InterruptedError("Processing was stopped by user")

                logging.info(f"Generating frames for project {project_id}")
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

                if should_stop():
                    raise InterruptedError("Processing was stopped by user")

                with app.app_context():
                    project = Project.query.get(project_id)
                    project.frame_count = int(frame_count)
                    project.video_duration = float(duration)
                    db.session.commit()

                if should_stop():
                    raise InterruptedError("Processing was stopped by user")

                logging.info(f"Creating video for project {project_id}")
                video_path = create_video(
                    project.folder_number,
                    fps,
                    codec,
                    resolution,
                    progress_callback
                )

                with app.app_context():
                    project = Project.query.get(project_id)
                    if not should_stop():
                        project.video_file = os.path.basename(video_path)
                        project.status = 'completed'
                        project.progress = 100
                        project.processing_completed_at = datetime.now()
                        db.session.commit()
                        logging.info(f"Project {project_id} completed successfully")

        except InterruptedError as e:
            logging.info(f"Project {project_id} was interrupted: {str(e)}")
            with app.app_context():
                project = Project.query.get(project_id)
                if project:
                    project.status = 'stopped'
                    project.error_message = str(e)
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

        finally:
            if project_id in running_processes:
                del running_processes[project_id]
            if project_id in stop_flags:
                del stop_flags[project_id]

    thread = threading.Thread(target=_process)
    thread.daemon = True
    thread.start()
    logging.info(f"Started background thread for project {project_id}")

def stop_project_processing(project_id):
    """Stop the processing of a project"""
    try:
        logging.info(f"Attempting to stop project {project_id}")

        # Set stop flag
        stop_flags[project_id] = True

        # Wait for up to 5 seconds for the process to stop gracefully
        for _ in range(5):
            if project_id not in running_processes:
                logging.info(f"Project {project_id} stopped gracefully")
                return True
            time.sleep(1)

        # If process is still running, try to terminate it
        if project_id in running_processes:
            try:
                pid = running_processes[project_id]['pid']
                process = psutil.Process(pid)

                # Try to terminate child processes first
                children = process.children(recursive=True)
                for child in children:
                    try:
                        child.terminate()
                    except (ProcessLookupError, psutil.NoSuchProcess):
                        pass

                # Give children time to terminate
                psutil.wait_procs(children, timeout=3)

                # Terminate main process
                process.terminate()
                process.wait(timeout=3)

                logging.info(f"Terminated process {pid} for project {project_id}")
            except (ProcessLookupError, psutil.NoSuchProcess):
                logging.warning(f"Process for project {project_id} no longer exists")
            except Exception as e:
                logging.error(f"Error terminating process: {str(e)}")
            finally:
                if project_id in running_processes:
                    del running_processes[project_id]

        return True

    except Exception as e:
        logging.error(f"Error stopping project {project_id}: {str(e)}")
        return False