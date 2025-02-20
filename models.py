from extensions import db
from datetime import datetime, timedelta
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
import secrets

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256))
    name = db.Column(db.String(64))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_active = db.Column(db.Boolean, default=True)
    is_email_confirmed = db.Column(db.Boolean, default=False)
    email_confirmation_token = db.Column(db.String(100), unique=True)
    email_confirmation_sent_at = db.Column(db.DateTime)
    password_reset_token = db.Column(db.String(100), unique=True)
    password_reset_sent_at = db.Column(db.DateTime)
    is_admin = db.Column(db.Boolean, default=False)
    locale = db.Column(db.String(2), default='en')
    subscribed_to_emails = db.Column(db.Boolean, default=True)  # New field
    projects = db.relationship('Project', backref='user', lazy=True)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def generate_email_confirmation_token(self):
        self.email_confirmation_token = secrets.token_urlsafe(32)
        self.email_confirmation_sent_at = datetime.utcnow()
        return self.email_confirmation_token

    def generate_password_reset_token(self):
        self.password_reset_token = secrets.token_urlsafe(32)
        self.password_reset_sent_at = datetime.utcnow()
        return self.password_reset_token

    def can_reset_password(self):
        if not self.password_reset_sent_at:
            return False
        return self.password_reset_sent_at > datetime.utcnow() - timedelta(hours=24)

    def generate_unsubscribe_token(self):
        """Generate a secure token for email unsubscribe link"""
        return secrets.token_urlsafe(32)

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
    folder_number = db.Column(db.Integer)  # Field for storing unique folder number
    processing_started_at = db.Column(db.DateTime)  # When processing started
    processing_completed_at = db.Column(db.DateTime)  # When processing completed
    progress = db.Column(db.Float, default=0)  # Progress percentage from 0 to 100
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    def days_until_expiry(self):
        """DEPRECATED: Use time_until_expiry instead"""
        if self.expiry_date:
            delta = self.expiry_date - datetime.utcnow()
            return max(0, delta.days)
        return 0

    def time_until_expiry(self):
        """Return formatted time until expiry (e.g., '23h 45m')"""
        if self.expiry_date:
            delta = self.expiry_date - datetime.utcnow()
            total_seconds = max(0, delta.total_seconds())
            hours = int(total_seconds // 3600)
            minutes = int((total_seconds % 3600) // 60)
            if hours > 0:
                return f"{hours}h {minutes}m"
            elif minutes > 0:
                return f"{minutes}m"
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

class EmailCampaign(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    subject = db.Column(db.String(200), nullable=False)
    html_content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    recipients_count = db.Column(db.Integer, default=0)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    sender = db.relationship('User', backref='campaigns')