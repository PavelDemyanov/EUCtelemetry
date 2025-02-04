from extensions import db
from datetime import datetime

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

    def days_until_expiry(self):
        if self.expiry_date:
            delta = self.expiry_date - datetime.utcnow()
            return max(0, delta.days)
        return 0

    def get_duration_str(self):
        """Return formatted duration string (e.g., '1:23' for 83 seconds)"""
        if self.video_duration is None:
            return '-'
        minutes = int(self.video_duration // 60)
        seconds = int(self.video_duration % 60)
        return f"{minutes}:{seconds:02d}"