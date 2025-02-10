from extensions import db
from datetime import datetime, timedelta

class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    csv_file = db.Column(db.String(255), nullable=False)
    csv_type = db.Column(db.String(20), nullable=False)  # 'darnkessbot' or 'wheellog'
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    expiry_date = db.Column(db.DateTime, nullable=False)
    frame_count = db.Column(db.Integer, default=0)
    fps = db.Column(db.Float, default=29.97)
    video_file = db.Column(db.String(255))
    codec = db.Column(db.String(10))
    resolution = db.Column(db.String(10))  # 'fullhd' or '4k'
    video_duration = db.Column(db.Float)  # Duration in seconds
    status = db.Column(db.String(20), default='pending')  # pending, processing, completed, error
    error_message = db.Column(db.Text)
    folder_number = db.Column(db.Integer)  # New field for storing unique folder number
    processing_started_at = db.Column(db.DateTime)  # When processing started
    processing_completed_at = db.Column(db.DateTime)  # When processing completed
    progress = db.Column(db.Float, default=0)  # Progress percentage from 0 to 100

    def days_until_expiry(self):
        """DEPRECATED: Use time_until_expiry instead"""
        if self.expiry_date:
            delta = self.expiry_date - datetime.utcnow()
            return max(0, delta.days)
        return 0

    def time_until_expiry(self):
        """Return formatted time until expiry (e.g., '23 hours 45 minutes')"""
        if self.expiry_date:
            delta = self.expiry_date - datetime.utcnow()
            total_seconds = max(0, delta.total_seconds())
            hours = int(total_seconds // 3600)
            minutes = int((total_seconds % 3600) // 60)
            if hours > 0:
                return f"{hours} hours {minutes} minutes"
            elif minutes > 0:
                return f"{minutes} minutes"
            else:
                return "expiring"
        return "expired"

    def get_duration_str(self):
        """Return formatted duration string (e.g., '1:23' for 83 seconds)"""
        if self.video_duration is None:
            return '-'
        minutes = int(self.video_duration // 60)
        seconds = int(self.video_duration % 60)
        return f"{minutes}:{seconds:02d}"

    def get_processing_time_str(self):
        """Return formatted processing time string"""
        if not self.processing_started_at or not self.processing_completed_at:
            return '-'
        delta = self.processing_completed_at - self.processing_started_at
        minutes = int(delta.total_seconds() // 60)
        seconds = int(delta.total_seconds() % 60)
        return f"{minutes}:{seconds:02d}"

    @classmethod
    def get_next_folder_number(cls):
        """Find the next available folder number"""
        import os
        # Get all existing folder numbers from the frames directory
        existing_folders = set()
        if os.path.exists('frames'):
            for folder in os.listdir('frames'):
                if folder.startswith('project_') and folder[8:].isdigit():
                    existing_folders.add(int(folder[8:]))

        # Get all folder numbers from the database
        db_folders = set(p.folder_number for p in cls.query.all() if p.folder_number is not None)

        # Combine both sets
        all_used_numbers = existing_folders.union(db_folders)

        # Find the first available number
        next_number = 1
        while next_number in all_used_numbers:
            next_number += 1

        return next_number