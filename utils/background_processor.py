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

    stop_flags[project_id] = False
    project_text_settings = text_settings if text_settings is not None else {}

    def _process():
        folder_number = None
        try:
            logging.info(f"Starting processing for project {project_id}")

            # Initial setup with project information
            with app.app_context():
                project = db.session.get(Project, project_id)
                if not project:
                    logging.error(f"Project {project_id} not found")
                    return

                folder_number = project.folder_number
                csv_file = os.path.join('uploads', project.csv_file)

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

            def update_progress(current, total, stage='frames'):
                if stop_flags.get(project_id, False):
                    raise InterruptedError("Processing was stopped by user")

                try:
                    with app.app_context():
                        project = db.session.get(Project, project_id)
                        if project and project.status == 'stopped':
                            raise InterruptedError("Processing was stopped by user")
                        if project:
                            # Для стадии frames прогресс идёт от 0 до 50%
                            # Для video прогресс идёт от 50 до 100%
                            base_progress = 0 if stage == 'frames' else 50
                            stage_progress = (current / total) * 50  # 50% для каждой стадии
                            total_progress = base_progress + stage_progress
                            project.progress = total_progress
                            db.session.commit()
                            logging.info(f"Progress: {total_progress:.1f}% for stage: {stage}")
                except Exception as e:
                    logging.error(f"Error updating progress: {e}")
                    raise

            # Process CSV
            try:
                logging.info(f"Processing CSV file {csv_file}")
                _, _ = process_csv_file(csv_file, folder_number)
            except Exception as e:
                logging.error(f"Error processing CSV: {e}")
                raise

            if stop_flags.get(project_id, False):
                raise InterruptedError("Processing was stopped by user")

            # Generate frames
            try:
                logging.info(f"Generating frames for project {project_id}")
                frame_count, duration = generate_frames(
                    csv_file,
                    folder_number,
                    resolution,
                    fps,
                    project_text_settings,
                    update_progress,
                    interpolate_values,
                    locale
                )

                with app.app_context():
                    project = db.session.get(Project, project_id)
                    if project.status == 'stopped':
                        raise InterruptedError("Processing was stopped by user")
                    project.frame_count = int(frame_count)
                    project.video_duration = float(duration)
                    db.session.commit()

            except Exception as e:
                logging.error(f"Error generating frames: {e}")
                raise

            if stop_flags.get(project_id, False):
                raise InterruptedError("Processing was stopped by user")

            # Create video
            try:
                logging.info(f"Creating video for project {project_id}")
                video_path = create_video(
                    folder_number,
                    fps,
                    codec,
                    resolution,
                    update_progress
                )

                with app.app_context():
                    project = db.session.get(Project, project_id)
                    if project.status == 'stopped':
                        raise InterruptedError("Processing was stopped by user")
                    project.video_file = os.path.basename(video_path)
                    project.status = 'completed'
                    project.progress = 100
                    project.processing_completed_at = datetime.now()
                    db.session.commit()
                    logging.info(f"Project {project_id} completed successfully")

            except Exception as e:
                logging.error(f"Error creating video: {e}")
                raise

        except InterruptedError as e:
            logging.info(f"Project {project_id} was interrupted: {str(e)}")
            with app.app_context():
                project = db.session.get(Project, project_id)
                if project:
                    project.status = 'stopped'
                    project.error_message = str(e)
                    project.processing_completed_at = datetime.now()
                    db.session.commit()

        except Exception as e:
            logging.error(f"Error processing project {project_id}: {str(e)}")
            with app.app_context():
                project = db.session.get(Project, project_id)
                if project:
                    project.status = 'error'
                    project.error_message = str(e)
                    project.processing_completed_at = datetime.now()
                    db.session.commit()

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
    from app import app, db
    from models import Project

    try:
        logging.info(f"Attempting to stop project {project_id}")

        # First update the project status
        with app.app_context():
            project = db.session.get(Project, project_id)
            if project:
                project.status = 'stopped'
                project.error_message = 'Processing stopped by user'
                project.processing_completed_at = datetime.now()
                db.session.commit()
                logging.info(f"Updated status to stopped for project {project_id}")

        # Set the stop flag
        stop_flags[project_id] = True
        logging.info(f"Set stop flag for project {project_id}")

        # Give the process a chance to stop gracefully
        for _ in range(5):
            if project_id not in running_processes:
                logging.info(f"Project {project_id} stopped gracefully")
                return True
            time.sleep(0.5)

        # If still running, try to terminate the process
        if project_id in running_processes:
            try:
                pid = running_processes[project_id]['pid']
                process = psutil.Process(pid)

                logging.info(f"Terminating process {pid} for project {project_id}")
                process.terminate()

                # Wait briefly for termination
                process.wait(timeout=3)

            except (psutil.NoSuchProcess, ProcessLookupError):
                logging.warning(f"Process for project {project_id} no longer exists")
            except psutil.TimeoutExpired:
                logging.warning(f"Timeout waiting for process to terminate")
                try:
                    os.kill(pid, signal.SIGKILL)
                except:
                    pass
            except Exception as e:
                logging.error(f"Error terminating process: {str(e)}")
            finally:
                if project_id in running_processes:
                    del running_processes[project_id]

        return True

    except Exception as e:
        logging.error(f"Error stopping project {project_id}: {str(e)}")
        return False