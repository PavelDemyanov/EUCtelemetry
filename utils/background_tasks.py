import threading
import time
import logging
import os
from datetime import datetime
from utils.archive_creator import create_png_archive
from extensions import db

class BackgroundTaskManager:
    """Singleton class to manage background tasks"""
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialize_instance()
        return cls._instance
    
    def _initialize_instance(self):
        """Initialize instance attributes"""
        self.active_tasks = {}
        self.task_lock = threading.Lock()
    
    def create_png_archive_async(self, project_id, project_folder_number, project_name):
        """Start PNG archive creation in background"""
        task_id = f"png_archive_{project_id}"
        
        # Check if task is already running
        with self.task_lock:
            if task_id in self.active_tasks:
                logging.info(f"PNG archive task for project {project_id} is already running")
                return False
            
            # Add task to active tasks
            self.active_tasks[task_id] = {
                'status': 'starting',
                'started_at': datetime.utcnow(),
                'project_id': project_id
            }
        
        # Start background thread
        thread = threading.Thread(
            target=self._create_png_archive_worker,
            args=(project_id, project_folder_number, project_name),
            daemon=True
        )
        thread.start()
        
        logging.info(f"Started PNG archive creation task for project {project_id}")
        return True
    
    def _create_png_archive_worker(self, project_id, project_folder_number, project_name):
        """Worker function for PNG archive creation"""
        task_id = f"png_archive_{project_id}"
        
        try:
            # Update task status
            with self.task_lock:
                if task_id in self.active_tasks:
                    self.active_tasks[task_id]['status'] = 'creating'
            
            # Import here to avoid circular imports
            from app import app
            
            with app.app_context():
                from models import Project
                
                # Update project status
                project = Project.query.get(project_id)
                if project:
                    project.png_archive_status = 'creating'
                    db.session.commit()
                
                # Create the archive
                logging.info(f"Creating PNG archive for project {project_id}")
                archive_filename = create_png_archive(project_id, project_folder_number, project_name)
                
                if archive_filename:
                    # Update project with successful creation
                    project.png_archive_file = archive_filename
                    project.png_archive_status = 'ready'
                    project.png_archive_created_at = datetime.utcnow()
                    db.session.commit()
                    
                    logging.info(f"PNG archive created successfully for project {project_id}: {archive_filename}")
                    
                    # Update task status
                    with self.task_lock:
                        if task_id in self.active_tasks:
                            self.active_tasks[task_id]['status'] = 'completed'
                            self.active_tasks[task_id]['completed_at'] = datetime.utcnow()
                else:
                    # Update project with error
                    project.png_archive_status = 'error'
                    db.session.commit()
                    
                    logging.error(f"Failed to create PNG archive for project {project_id}")
                    
                    # Update task status
                    with self.task_lock:
                        if task_id in self.active_tasks:
                            self.active_tasks[task_id]['status'] = 'error'
                            self.active_tasks[task_id]['completed_at'] = datetime.utcnow()
        
        except Exception as e:
            logging.error(f"Error in PNG archive creation task for project {project_id}: {str(e)}")
            
            # Update project with error
            try:
                from app import app
                with app.app_context():
                    from models import Project
                    project = Project.query.get(project_id)
                    if project:
                        project.png_archive_status = 'error'
                        db.session.commit()
            except Exception as db_error:
                logging.error(f"Failed to update project status after error: {str(db_error)}")
            
            # Update task status
            with self.task_lock:
                if task_id in self.active_tasks:
                    self.active_tasks[task_id]['status'] = 'error'
                    self.active_tasks[task_id]['error'] = str(e)
                    self.active_tasks[task_id]['completed_at'] = datetime.utcnow()
        
        finally:
            # Clean up completed tasks after some time
            def cleanup_task():
                time.sleep(300)  # Wait 5 minutes before cleanup
                with self.task_lock:
                    if task_id in self.active_tasks:
                        del self.active_tasks[task_id]
                        logging.info(f"Cleaned up task {task_id}")
            
            cleanup_thread = threading.Thread(target=cleanup_task, daemon=True)
            cleanup_thread.start()
    
    def get_task_status(self, project_id):
        """Get status of PNG archive creation task"""
        task_id = f"png_archive_{project_id}"
        with self.task_lock:
            return self.active_tasks.get(task_id)
    
    def get_all_active_tasks(self):
        """Get all active tasks"""
        with self.task_lock:
            return dict(self.active_tasks)

# Global instance
task_manager = BackgroundTaskManager()