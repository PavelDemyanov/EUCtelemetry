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
    png_archive_file = db.Column(db.String(255))  # Path to PNG archive file
    codec = db.Column(db.String(10))
    resolution = db.Column(db.String(10))  # 'fullhd' or '4k'
    video_duration = db.Column(db.Float)  # Duration in seconds
    status = db.Column(db.String(20), default='pending')  # pending, processing, completed, error
    error_message = db.Column(db.Text)
    folder_number = db.Column(db.Integer)  # Field for storing unique folder number
    processing_started_at = db.Column(db.DateTime)  # When processing started
    processing_completed_at = db.Column(db.DateTime)  # When processing completed
    progress = db.Column(db.Float, default=0)  # Progress percentage from 0 to 100
    export_settings = db.Column(db.Text)  # JSON export settings for retry (video editor)
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

    def get_resolution_display(self):
        """Return human-readable resolution string"""
        if not self.resolution:
            return '–'
        mapping = {'fullhd': '1080p', '4k': '4K', '1080p': '1080p'}
        return mapping.get(self.resolution.lower(), self.resolution.upper())

    def get_codec_display(self):
        """Return human-readable codec string"""
        if not self.codec:
            return '–'
        mapping = {'h264': 'H.264', 'h265': 'H.265', 'hevc': 'H.265'}
        return mapping.get(self.codec.lower(), self.codec.upper())

    def hours_until_expiry(self):
        """Return hours until expiry as a float (for template logic)"""
        if self.expiry_date:
            delta = self.expiry_date - datetime.utcnow()
            return max(0, delta.total_seconds() / 3600)
        return 0

    def get_expiry_display(self):
        """Return formatted expiry string (e.g. '2d 5h' or '3h 12m')"""
        if not self.expiry_date:
            return 'expired'
        delta = self.expiry_date - datetime.utcnow()
        total_seconds = delta.total_seconds()
        if total_seconds <= 0:
            return 'expired'
        hours = int(total_seconds // 3600)
        minutes = int((total_seconds % 3600) // 60)
        if hours >= 24:
            days = hours // 24
            rem_h = hours % 24
            return f"{days}d {rem_h}h"
        elif hours > 0:
            return f"{hours}h {minutes}m"
        elif minutes > 0:
            return f"{minutes}m"
        else:
            return 'expiring'

    def is_expired(self):
        """True, если срок хранения проекта истёк.

        Сравнение с utcnow — ровно та же база, что у cleanup_expired_projects и
        get_expiry_display(). Поэтому карточка показывает «истёк» синхронно с тем,
        как фоновая очистка начинает физически удалять файлы проекта. В UI для таких
        проектов прячем кнопки скачивания (CSV/PNG/Video) — файлы уже удаляются."""
        return bool(self.expiry_date and self.expiry_date <= datetime.utcnow())

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
    
    # Background task tracking
    task_id = db.Column(db.String(100), nullable=True)  # UUID of background task
    is_completed = db.Column(db.Boolean, default=False)
    sent_count = db.Column(db.Integer, default=0)
    failed_count = db.Column(db.Integer, default=0)
    started_at = db.Column(db.DateTime, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)

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
            },
            {
                'achievement_id': 'sleep',
                'title': 'Sleep',
                'description': "You're a sleepy rider — your maximum speed was only 15 km/h!",
                'icon': 'sleep.svg',
                'formula': 'max_speed <= 15'
            },
            {
                'achievement_id': 'fast',
                'title': 'Fast',
                'description': "You're a fast rider — you hit 70 km/h!",
                'icon': 'fast.svg',
                'formula': 'max_speed >= 70'
            },
            {
                'achievement_id': 'superfast',
                'title': 'Super Fast',
                'description': "You're a super fast rider — you hit 100 km/h!",
                'icon': 'superfast.svg',
                'formula': 'max_speed >= 100'
            },
            {
                'achievement_id': 'suicidalmadman',
                'title': 'Suicidal madman',
                'description': "You're a suicidal madman — you hit 150 km/h!",
                'icon': 'suicidalmadman.svg',
                'formula': 'max_speed >= 150'
            },
            {
                'achievement_id': 'dead',
                'title': 'Dead',
                'description': "You're dead — high speed with PWM=100, then complete PWM failure!",
                'icon': 'dead.svg',
                'formula': 'dead_condition_met'
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

class SiteSetting(db.Model):
    __tablename__ = 'site_settings'
    key = db.Column(db.String(100), primary_key=True)
    value = db.Column(db.String(500), nullable=False)
    description = db.Column(db.String(500), nullable=True)

    @staticmethod
    def get(key, default=None):
        s = SiteSetting.query.get(key)
        return s.value if s else default

    @staticmethod
    def get_int(key, default=0):
        v = SiteSetting.get(key)
        try:
            return int(v)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def set(key, value, description=None):
        from extensions import db
        s = SiteSetting.query.get(key)
        if s:
            s.value = str(value)
            if description:
                s.description = description
        else:
            s = SiteSetting(key=key, value=str(value), description=description)
            db.session.add(s)
        db.session.commit()


class Coauthor(db.Model):
    """Соавтор / contributor проекта — отображается на странице About под информацией о создателе."""
    __tablename__ = 'coauthor'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    role = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=False)
    # Путь к файлу относительно static/, например "uploads/coauthors/abc123.jpg".
    # NULL означает "нет фото — отрисуем плейсхолдер с инициалами".
    photo = db.Column(db.String(255), nullable=True)
    # Порядок отображения; меньшее значение — выше в списке.
    display_order = db.Column(db.Integer, nullable=False, default=0, index=True)
    # Флаг видимости — позволяет временно скрыть без удаления.
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def get_initials(self):
        """Получить инициалы для плейсхолдера (если фото нет)."""
        if not self.name:
            return '?'
        parts = [p for p in self.name.strip().split() if p]
        if len(parts) >= 2:
            return (parts[0][0] + parts[1][0]).upper()
        return parts[0][0].upper() if parts else '?'

    def __repr__(self):
        return f'<Coauthor {self.id} {self.name!r}>'


class UsageEvent(db.Model):
    """Несгораемое событие создания видео — для продуктовой статистики админки.

    В отличие от Project (который автоочистка физически удаляет через 12-48 ч),
    UsageEvent живёт вечно и пишется ОДИН раз на каждый успешный экспорт из всех
    трёх путей: классический рендер, серверный экспорт редактора и Local Export
    (последний — через beacon из браузера, т.к. иначе не оставляет следов на сервере).
    """
    __tablename__ = 'usage_event'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    # Режим создания: 'classic' | 'editor_server' | 'editor_local'
    mode = db.Column(db.String(20), nullable=False, index=True)
    # Источник телеметрии: 'darknessbot' | 'wheellog' | 'eucworld' | None
    csv_source = db.Column(db.String(20))
    resolution = db.Column(db.String(20))   # 'fullhd' | '4k' | 'WxH' | 'source'
    codec = db.Column(db.String(10))        # 'h264' | 'h265'
    quality = db.Column(db.String(20))      # 'low' | 'medium' | 'high' | 'superhigh' | None
    duration_sec = db.Column(db.Float)      # длительность результирующего видео, сек
    frame_count = db.Column(db.Integer)
    has_track_map = db.Column(db.Boolean, default=False)  # включена VBO трек-карта
    has_laps = db.Column(db.Boolean, default=False)       # включена доска кругов
    success = db.Column(db.Boolean, default=True, index=True)

    # Отношение для удобного доступа к юзеру (без обратной ссылки, чтобы не плодить backref)
    user = db.relationship('User', foreign_keys=[user_id])

    @staticmethod
    def log(**kwargs):
        """Записать событие, НИКОГДА не роняя основной поток обработки.

        Любая ошибка БД (например, таблица ещё не создана при первом старте) глотается
        и откатывается — статистика не должна ломать сам экспорт видео.
        """
        from extensions import db
        try:
            ev = UsageEvent(**kwargs)
            db.session.add(ev)
            db.session.commit()
            return ev
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            return None


class SystemMetric(db.Model):
    """Минутный замер загрузки железа (CPU/RAM/Disk/GPU) — персистентно в БД.

    Заменяет старый in-memory dict: графики System Resources теперь переживают
    рестарт gunicorn и согласованы между всеми 8 воркерами (раньше у каждого
    воркера была своя копия в памяти). Дедуп между воркерами — через PK `ts`
    (начало минуты, UTC) + UPSERT. Retention ~3 дня; используется для 1 Hour / 1 Day.
    """
    __tablename__ = 'system_metric'
    ts = db.Column(db.DateTime, primary_key=True)  # начало минуты, UTC
    cpu = db.Column(db.Float, default=0)
    memory = db.Column(db.Float, default=0)
    disk = db.Column(db.Float, default=0)
    gpu = db.Column(db.Float, default=0)


class SystemMetricDaily(db.Model):
    """Дневное среднее загрузки железа — для длинных периодов (Week / Month / Year).

    Пересчитывается из минутных SystemMetric за текущий день. Хранится ~год
    (retention 400 дней), поэтому недельный/месячный/годовой графики реально
    наполняются, а не показывают только последние сутки."""
    __tablename__ = 'system_metric_daily'
    day = db.Column(db.Date, primary_key=True)  # календарный день, UTC
    cpu = db.Column(db.Float, default=0)
    memory = db.Column(db.Float, default=0)
    disk = db.Column(db.Float, default=0)
    gpu = db.Column(db.Float, default=0)
