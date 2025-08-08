"""
Background task processing for email campaigns and other long-running tasks
"""
import threading
import queue
import time
import logging
from typing import Dict, Any, List
from dataclasses import dataclass
from enum import Enum

class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running" 
    COMPLETED = "completed"
    FAILED = "failed"

@dataclass
class Task:
    id: str
    type: str
    status: TaskStatus
    data: Dict[str, Any]
    created_at: float
    started_at: float = None
    completed_at: float = None
    progress: int = 0
    error: str = None
    result: Any = None

class BackgroundTaskManager:
    def __init__(self):
        self.task_queue = queue.Queue()
        self.tasks: Dict[str, Task] = {}
        self.worker_thread = None
        self.shutdown_event = threading.Event()
        self.start_worker()
    
    def start_worker(self):
        """Start the background worker thread"""
        if self.worker_thread is None or not self.worker_thread.is_alive():
            self.worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
            self.worker_thread.start()
            logging.info("Background task worker started")
    
    def _worker_loop(self):
        """Main worker loop that processes tasks from the queue"""
        while not self.shutdown_event.is_set():
            try:
                # Get task from queue with timeout
                task_id = self.task_queue.get(timeout=1.0)
                if task_id in self.tasks:
                    task = self.tasks[task_id]
                    self._process_task(task)
                self.task_queue.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                logging.error(f"Error in background worker: {e}")
    
    def _process_task(self, task: Task):
        """Process a single task"""
        try:
            task.status = TaskStatus.RUNNING
            task.started_at = time.time()
            
            logging.info(f"Processing task {task.id} of type {task.type}")
            
            if task.type == "email_campaign":
                self._process_email_campaign(task)
            else:
                raise ValueError(f"Unknown task type: {task.type}")
                
            task.status = TaskStatus.COMPLETED
            task.completed_at = time.time()
            logging.info(f"Task {task.id} completed successfully")
            
        except Exception as e:
            task.status = TaskStatus.FAILED
            task.error = str(e)
            task.completed_at = time.time()
            logging.error(f"Task {task.id} failed: {e}")
    
    def _process_email_campaign(self, task: Task):
        """Process email campaign task"""
        from utils.email_sender import send_email_batch
        from app import db
        from models import User, EmailCampaign
        
        campaign_id = task.data.get('campaign_id')
        subject = task.data.get('subject')
        html_content = task.data.get('html_content')
        user_ids = task.data.get('user_ids', [])
        
        if not all([campaign_id, subject, html_content, user_ids]):
            raise ValueError("Missing required campaign data")
        
        # Process emails in batches to avoid overwhelming SMTP server
        batch_size = 10
        total_users = len(user_ids)
        sent_count = 0
        failed_count = 0
        
        for i in range(0, total_users, batch_size):
            batch_user_ids = user_ids[i:i + batch_size]
            
            # Get users for this batch
            users = User.query.filter(User.id.in_(batch_user_ids)).all()
            
            # Prepare batch emails
            emails_to_send = []
            for user in users:
                # Generate unsubscribe token
                unsubscribe_token = user.generate_unsubscribe_token()
                user.email_confirmation_token = unsubscribe_token
                db.session.commit()
                
                # Create unsubscribe URL (we'll need to import url_for)
                from flask import url_for
                unsubscribe_url = url_for('unsubscribe', token=unsubscribe_token, _external=True)
                
                # Add localized footer
                user_locale = user.locale or 'en'
                if user_locale == 'ru':
                    footer = f"""
                    <hr>
                    <p style="font-size: 12px; color: #666;">
                        Чтобы отписаться от рассылки, <a href="{unsubscribe_url}">нажмите здесь</a>.
                    </p>
                    """
                else:
                    footer = f"""
                    <hr>
                    <p style="font-size: 12px; color: #666;">
                        To unsubscribe from these emails, <a href="{unsubscribe_url}">click here</a>.
                    </p>
                    """
                
                full_content = html_content + footer
                emails_to_send.append({
                    'to_email': user.email,
                    'subject': subject,
                    'html_content': full_content
                })
            
            # Send batch
            batch_results = send_email_batch(emails_to_send)
            
            # Count results
            for result in batch_results:
                if result['success']:
                    sent_count += 1
                else:
                    failed_count += 1
                    logging.warning(f"Failed to send email to {result['email']}: {result.get('error', 'Unknown error')}")
            
            # Update progress
            task.progress = int((sent_count + failed_count) / total_users * 100)
            
            # Small delay between batches to avoid overwhelming server
            time.sleep(0.5)
        
        # Update campaign record
        campaign = EmailCampaign.query.get(campaign_id)
        if campaign:
            campaign.sent_count = sent_count
            campaign.failed_count = failed_count
            campaign.is_completed = True
            db.session.commit()
        
        task.result = {
            'sent_count': sent_count,
            'failed_count': failed_count,
            'total_count': total_users
        }
    
    def add_task(self, task_type: str, data: Dict[str, Any]) -> str:
        """Add a new task to the queue"""
        import uuid
        task_id = str(uuid.uuid4())
        
        task = Task(
            id=task_id,
            type=task_type,
            status=TaskStatus.PENDING,
            data=data,
            created_at=time.time()
        )
        
        self.tasks[task_id] = task
        self.task_queue.put(task_id)
        
        logging.info(f"Added task {task_id} of type {task_type} to queue")
        return task_id
    
    def get_task_status(self, task_id: str) -> Dict[str, Any]:
        """Get task status and progress"""
        if task_id not in self.tasks:
            return None
        
        task = self.tasks[task_id]
        return {
            'id': task.id,
            'type': task.type,
            'status': task.status.value,
            'progress': task.progress,
            'created_at': task.created_at,
            'started_at': task.started_at,
            'completed_at': task.completed_at,
            'error': task.error,
            'result': task.result
        }
    
    def cleanup_old_tasks(self, max_age_hours: int = 24):
        """Remove old completed/failed tasks"""
        current_time = time.time()
        max_age_seconds = max_age_hours * 3600
        
        to_remove = []
        for task_id, task in self.tasks.items():
            if (task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED] and 
                task.completed_at and 
                current_time - task.completed_at > max_age_seconds):
                to_remove.append(task_id)
        
        for task_id in to_remove:
            del self.tasks[task_id]
        
        if to_remove:
            logging.info(f"Cleaned up {len(to_remove)} old tasks")
    
    def shutdown(self):
        """Shutdown the background worker"""
        self.shutdown_event.set()
        if self.worker_thread:
            self.worker_thread.join(timeout=5.0)

# Global task manager instance
task_manager = BackgroundTaskManager()