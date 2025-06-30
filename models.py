from extensions import db
from datetime import datetime, timedelta
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
import secrets
import markdown
import json

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
    subscribed_to_emails = db.Column(db.Boolean, default=True)
    projects = db.relationship('Project', backref='user', lazy=True)
    presets = db.relationship('Preset', backref='user', lazy=True)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def generate_email_confirmation_token(self):
        token = secrets.token_urlsafe(32)
        self.email_confirmation_token = token
        self.email_confirmation_sent_at = datetime.utcnow()
        return token

    def generate_password_reset_token(self):
        token = secrets.token_urlsafe(32)
        self.password_reset_token = token
        self.password_reset_sent_at = datetime.utcnow()
        return token

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

class News(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    author_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    author = db.relationship('User', backref='news_posts')

    def html_content(self):
        """Convert markdown content to HTML"""
        return markdown.markdown(self.content, extensions=['fenced_code', 'tables'])

class Preset(db.Model):
    """Model for storing user presets for project settings"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    settings = db.Column(db.Text, nullable=False)  # JSON string of settings
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    def get_settings(self):
        """Get settings as a dictionary"""
        return json.loads(self.settings)

    def set_settings(self, settings_dict):
        """Set settings from a dictionary"""
        self.settings = json.dumps(settings_dict)

    @staticmethod
    def create_from_form_data(name, settings_dict, user_id):
        """Create a new preset from form data"""
        preset = Preset(
            name=name,
            user_id=user_id
        )
        preset.set_settings(settings_dict)
        return preset


class RegistrationAttempt(db.Model):
    """Model for tracking registration attempts by IP address"""
    id = db.Column(db.Integer, primary_key=True)
    ip_address = db.Column(db.String(45), nullable=False)  # IPv6 can be up to 45 chars
    attempted_at = db.Column(db.DateTime, default=datetime.utcnow)
    email = db.Column(db.String(120), nullable=False)
    success = db.Column(db.Boolean, default=False)
    user_agent = db.Column(db.Text)

    @staticmethod
    def get_daily_attempts_count(ip_address):
        """Get count of registration attempts from IP in last 24 hours"""
        cutoff_time = datetime.utcnow() - timedelta(days=1)
        return RegistrationAttempt.query.filter(
            RegistrationAttempt.ip_address == ip_address,
            RegistrationAttempt.attempted_at > cutoff_time
        ).count()

    @staticmethod
    def can_register(ip_address, max_attempts=3):
        """Check if IP can register (under daily limit)"""
        return RegistrationAttempt.get_daily_attempts_count(ip_address) < max_attempts

    @staticmethod
    def log_attempt(ip_address, email, success=False, user_agent=None):
        """Log a registration attempt"""
        attempt = RegistrationAttempt(
            ip_address=ip_address,
            email=email,
            success=success,
            user_agent=user_agent
        )
        db.session.add(attempt)
        db.session.commit()
        return attempt


class Achievement(db.Model):
    """Model for storing achievement definitions"""
    id = db.Column(db.Integer, primary_key=True)
    achievement_id = db.Column(db.String(50), unique=True, nullable=False)  # internal ID like 'devil'
    title = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=False)
    icon = db.Column(db.String(100), nullable=False, default='default.svg')
    formula = db.Column(db.Text, nullable=False)  # Python code for achievement calculation
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    @staticmethod
    def get_default_achievements():
        """Get default achievement definitions"""
        return [
            {
                'achievement_id': 'devil',
                'title': 'Devil',
                'description': "You're a devil of the road — you hit 130 km/h!",
                'icon': 'devil.svg',
                'formula': 'max_speed >= 130'
            },
            {
                'achievement_id': 'tourist',
                'title': 'Tourist',
                'description': "You're a true tourist — you traveled over 90 km in a single day!",
                'icon': 'tourist.svg',
                'formula': 'max_daily_distance >= 90'
            },
            {
                'achievement_id': 'nomad',
                'title': 'Nomad',
                'description': "You're a true nomad — you traveled over 150 kilometers in a single day!",
                'icon': 'supertourist.svg',
                'formula': 'max_daily_distance >= 150'
            },
            {
                'achievement_id': 'strongrider',
                'title': 'Strong rider',
                'description': "You're a heavy, powerful rider — you managed to load the hub motor with 20,000 watts!",
                'icon': 'fat.svg',
                'formula': 'max_power >= 20000 or min_power <= -20000'
            },
            {
                'achievement_id': 'godlikepower',
                'title': 'Godlike power',
                'description': "You're a godlike-force rider — you managed to load the hub motor with 30,000 watts!",
                'icon': 'superfat.svg',
                'formula': 'max_power >= 30000 or min_power <= -30000'
            },
            {
                'achievement_id': 'clown',
                'title': 'Clown',
                'description': "You're a clown — your wheel and GPS speeds differ by more than 5 km/h on average!",
                'icon': 'clown.svg',
                'formula': 'avg_speed_diff > 5'
            }
        ]

    @staticmethod
    def initialize_defaults():
        """Initialize default achievements if they don't exist"""
        for achievement_data in Achievement.get_default_achievements():
            existing = Achievement.query.filter_by(achievement_id=achievement_data['achievement_id']).first()
            if not existing:
                achievement = Achievement(**achievement_data)
                db.session.add(achievement)
        db.session.commit()


class SiteStyle(db.Model):
    """Model for storing site styling configuration"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)  # Style setting name
    value = db.Column(db.String(100), nullable=False)  # Color value (hex, rgb, etc.)
    description = db.Column(db.String(200), nullable=False)  # Description of what this style controls
    category = db.Column(db.String(50), nullable=False, default='general')  # Category (colors, layout, etc.)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f'<SiteStyle {self.name}: {self.value}>'

    @staticmethod
    def get_default_styles():
        """Get default style definitions"""
        return [
            {
                'name': 'footer_bg_color',
                'value': '#232323',
                'description': 'Footer background color',
                'category': 'colors'
            },
            {
                'name': 'navbar_bg_color', 
                'value': '#212529',
                'description': 'Navigation bar background color',
                'category': 'colors'
            },
            {
                'name': 'primary_btn_color',
                'value': '#0d6efd',
                'description': 'Primary button background color',
                'category': 'colors'
            },
            {
                'name': 'secondary_btn_color',
                'value': '#6c757d', 
                'description': 'Secondary button background color',
                'category': 'colors'
            },
            {
                'name': 'success_btn_color',
                'value': '#198754',
                'description': 'Success button background color', 
                'category': 'colors'
            },
            {
                'name': 'danger_btn_color',
                'value': '#dc3545',
                'description': 'Danger button background color',
                'category': 'colors'
            },
            {
                'name': 'warning_btn_color',
                'value': '#ffc107',
                'description': 'Warning button background color',
                'category': 'colors'
            },
            {
                'name': 'body_bg_color',
                'value': '#212529',
                'description': 'Main body background color',
                'category': 'colors'
            },
            {
                'name': 'card_bg_color',
                'value': '#343a40',
                'description': 'Card background color',
                'category': 'colors'
            },
            {
                'name': 'text_color',
                'value': '#dee2e6',
                'description': 'Main text color',
                'category': 'colors'
            }
        ]

    @staticmethod
    def initialize_defaults():
        """Initialize default styles if they don't exist"""
        for style_data in SiteStyle.get_default_styles():
            existing = SiteStyle.query.filter_by(name=style_data['name']).first()
            if not existing:
                style = SiteStyle(**style_data)
                db.session.add(style)
        db.session.commit()

    @staticmethod
    def get_style_value(name, default=''):
        """Get style value by name"""
        style = SiteStyle.query.filter_by(name=name, is_active=True).first()
        return style.value if style else default

    @staticmethod
    def get_all_styles():
        """Get all active styles as dictionary"""
        styles = SiteStyle.query.filter_by(is_active=True).all()
        return {style.name: style.value for style in styles}