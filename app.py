import os
import logging
import random
import re
import shutil
import threading
import time
import json
import tempfile
from datetime import datetime, timedelta
from collections import defaultdict
from functools import wraps

import psutil
import pandas as pd
from dotenv import load_dotenv
from flask import (Flask, render_template, request, jsonify, send_file, 
                  url_for, send_from_directory, flash, redirect, abort)
from flask_migrate import Migrate
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.utils import secure_filename
from flask_babel import Babel, gettext as _, get_locale
from extensions import db
from utils.csv_processor import process_csv_file, detect_csv_type
from utils.image_generator import generate_frames, create_preview_frame, clear_icon_cache
from utils.video_creator import create_video
from utils.background_processor import process_project, stop_project_processing
from utils.env_setup import setup_env_variables
from utils.email_sender import send_email, test_smtp_connection
from forms import (LoginForm, RegistrationForm, ProfileForm,
                  ChangePasswordForm, ForgotPasswordForm, ResetPasswordForm, DeleteAccountForm,
                  NewsForm, EmailCampaignForm, ResendConfirmationForm, EmailTestForm, AchievementForm,
                  CoauthorForm, generate_math_captcha)
from models import User, Project, EmailCampaign, News, Preset, RegistrationAttempt, Achievement, SiteSetting, Coauthor, UsageEvent, SystemMetric, SystemMetricDaily, ErrorReport
import markdown
from sqlalchemy import desc

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Add markdown filter to the Jinja environment
def markdown_filter(text):
    if text:
        return markdown.markdown(text, extensions=['fenced_code', 'tables'])
    return ''

app = Flask(__name__)
app.jinja_env.filters['markdown'] = markdown_filter

# Load environment variables from .env file
load_dotenv()

app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', os.urandom(32))
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL')
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_recycle': 300,
    'pool_pre_ping': True,
}
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024 * 1024  # 2GB max (local export merge needs large uploads)
app.config['WTF_CSRF_ENABLED'] = True
app.config['BABEL_DEFAULT_LOCALE'] = 'en'

# Session settings
app.config['SESSION_PERMANENT'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=180)  # 6 months

# Add Mail configuration
app.config['MAIL_SERVER'] = os.environ.get('SMTP_SERVER')
app.config['MAIL_PORT'] = int(os.environ.get('SMTP_PORT', 465))
app.config['MAIL_USERNAME'] = os.environ.get('SMTP_LOGIN')
app.config['MAIL_PASSWORD'] = os.environ.get('SMTP_PASSWORD')
app.config['MAIL_USE_TLS'] = False
app.config['MAIL_USE_SSL'] = True

# Initialize used_folders as an empty set
used_folders = set()

# Clear icon cache on startup to ensure updated SVG files are loaded
clear_icon_cache()

# Initialize Babel
babel = Babel(app)

def get_locale():
    # Try to get locale from query string
    locale = request.args.get('lang')
    if locale in ['en', 'ru']:
        return locale
    # Try to get locale from user settings
    if current_user.is_authenticated and hasattr(current_user, 'locale'):
        if current_user.locale in ['en', 'ru']:
            return current_user.locale
    # Try to get locale from request header
    best_match = request.accept_languages.best_match(['en', 'ru'])
    if best_match:
        return best_match
    # Default to English if no locale is found
    return 'en'

# Configure Babel with locale selector
babel.init_app(app, locale_selector=get_locale)

# Make get_locale available in templates
app.jinja_env.globals['get_locale'] = get_locale

# Project name characters
PROJECT_NAME_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

def generate_project_name():
    """Generate a random 5-character project name"""
    return ''.join(random.choice(PROJECT_NAME_CHARS) for _ in range(5))

def validate_project_name(name):
    """Validate project name"""
    if not name:
        return False
    # Allow alphanumeric characters, dashes, and underscores
    # with length between 1 and 7 characters
    return bool(re.match(r'^[\w\d-]{1,7}$', name))

def cleanup_project_files(project):
    """Delete all files associated with a project"""
    try:
        # Delete CSV file
        if project.csv_file:
            csv_path = os.path.join('uploads', project.csv_file)
            if os.path.exists(csv_path):
                os.remove(csv_path)
                logging.info(f"Deleted CSV file: {csv_path}")

        # Delete preview file
        preview_path = os.path.join('previews', f'{project.id}_preview.png')
        if os.path.exists(preview_path):
            os.remove(preview_path)
            logging.info(f"Deleted preview file: {preview_path}")

        # Delete video file
        if project.video_file:
            video_path = os.path.join('videos', project.video_file)
            if os.path.exists(video_path):
                os.remove(video_path)
                logging.info(f"Deleted video file: {video_path}")

        # Delete PNG archive file
        if project.png_archive_file:
            archive_path = os.path.join('archives', project.png_archive_file)
            if os.path.exists(archive_path):
                os.remove(archive_path)
                logging.info(f"Deleted PNG archive file: {archive_path}")

        # Delete frames directory
        frames_dir = f'frames/project_{project.folder_number}'
        if os.path.exists(frames_dir):
            shutil.rmtree(frames_dir)
            logging.info(f"Deleted frames directory: {frames_dir}")

        # Delete overlay frames directory (video editor server export leaves these,
        # especially on a failed export — they were never cleaned up before and piled up).
        overlay_dir = f'frames/project_{project.folder_number}_overlay'
        if os.path.exists(overlay_dir):
            shutil.rmtree(overlay_dir)
            logging.info(f"Deleted overlay frames directory: {overlay_dir}")

        # Delete processed CSV file
        if project.csv_file:
            processed_csv = os.path.join('processed_data', f'project_{project.folder_number}_{os.path.basename(project.csv_file)}')
            if os.path.exists(processed_csv):
                os.remove(processed_csv)
                logging.info(f"Deleted processed CSV file: {processed_csv}")

        return True
    except Exception as e:
        logging.error(f"Error cleaning up project files: {str(e)}")
        return False

def _cleanup_ve_uploads_files(max_age_hours=24):
    """Удалить заброшенные video-editor загрузки: orphan chunk-директории + файлы
    старше max_age_hours. Общая логика для админ-кнопки (/admin/cleanup-ve-uploads)
    и для часового фонового таймера. Исходные видео грузятся в
    uploads/video_editor/<user>/ и НЕ привязаны к Project (Local Export вообще не
    создаёт проект), поэтому раньше чистились ТОЛЬКО вручную и копились гигабайтами."""
    import time as _time
    deleted_count = 0
    freed_bytes = 0
    deleted_files = []
    ve_dir = os.path.join('uploads', 'video_editor')
    if not os.path.exists(ve_dir):
        return {'deleted_count': 0, 'freed_bytes': 0, 'deleted_files': []}
    now = _time.time()
    for user_dir_name in os.listdir(ve_dir):
        user_path = os.path.join(ve_dir, user_dir_name)
        if not os.path.isdir(user_path):
            continue
        for item in os.listdir(user_path):
            item_path = os.path.join(user_path, item)
            try:
                # Orphan chunk directories — всегда мусор
                if item.endswith('_chunks') and os.path.isdir(item_path):
                    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, dn, fnames in os.walk(item_path) for f in fnames)
                    shutil.rmtree(item_path)
                    deleted_files.append(f'video_editor/{user_dir_name}/{item}')
                    deleted_count += 1
                    freed_bytes += size
                    continue
                # Hash index — индекс дедупликации, не трогаем
                if item == '_video_hashes.json':
                    continue
                # Обычные файлы старше порога
                if os.path.isfile(item_path):
                    age_hours = (now - os.path.getmtime(item_path)) / 3600
                    if age_hours > max_age_hours:
                        size = os.path.getsize(item_path)
                        os.remove(item_path)
                        deleted_files.append(f'video_editor/{user_dir_name}/{item}')
                        deleted_count += 1
                        freed_bytes += size
            except Exception as e:
                logging.error(f"VE cleanup error on {item_path}: {e}")
    return {'deleted_count': deleted_count, 'freed_bytes': freed_bytes, 'deleted_files': deleted_files}


def cleanup_expired_projects():
    """Check and remove expired projects"""
    while True:
        try:
            with app.app_context():
                # Find all expired projects
                expired_projects = Project.query.filter(
                    Project.expiry_date <= datetime.utcnow()
                ).all()

                for project in expired_projects:
                    logging.info(f"Cleaning up expired project {project.id}")

                    # Delete associated files
                    if cleanup_project_files(project):
                        # Delete project from database
                        db.session.delete(project)
                        logging.info(f"Deleted expired project {project.id} from database")
                    else:
                        logging.error(f"Failed to clean up files for project {project.id}")

                db.session.commit()

            # Также чистим заброшенные video-editor загрузки (>24ч) — раньше копились,
            # т.к. очистка была только ручной кнопкой в админке.
            try:
                ve = _cleanup_ve_uploads_files(max_age_hours=24)
                if ve['deleted_count']:
                    logging.info(f"VE auto-cleanup: removed {ve['deleted_count']} items, freed {ve['freed_bytes']/1024/1024:.1f} MB")
            except Exception as e:
                logging.error(f"VE auto-cleanup error: {e}")

        except Exception as e:
            logging.error(f"Error in cleanup task: {str(e)}")

        # Sleep for 1 hour before next cleanup
        time.sleep(3600)

# Initialize Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Please log in to access this page.'

# Initialize background task manager
from utils.background_tasks import task_manager
logging.info("Background task manager initialized")

# Check for orphaned projects (projects in processing or pending status when server restarted)
def check_orphaned_projects():
    """
    Check for projects in 'processing' or 'pending' status that were orphaned 
    due to server restart and mark them as 'error'
    """
    try:
        # Find all projects in processing or pending status
        orphaned_projects = Project.query.filter(
            Project.status.in_(['processing', 'pending'])
        ).all()
        
        count = 0
        for project in orphaned_projects:
            project.status = 'error'
            project.error_message = 'Project processing was interrupted due to server restart'
            count += 1
        
        if count > 0:
            db.session.commit()
            logging.info(f"Marked {count} orphaned projects as 'error' during server startup")
        
        return count
    except Exception as e:
        logging.error(f"Error checking orphaned projects: {str(e)}")
        db.session.rollback()
        return 0

# Note: Moved below - this will be called after app and DB initialization

@login_manager.user_loader
def load_user(id):
    return User.query.get(int(id))

# Add admin required decorator after the login_manager setup
def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            abort(403)
        return f(*args, **kwargs)
    return decorated_function

# Add this new route before the app.context_processor
def get_system_stats():
    """Get system resource usage statistics"""
    cpu_percent = psutil.cpu_percent()
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage('/')

    # GPU stats - return 0 if not available
    gpu_percent = 0
    try:
        import GPUtil
        gpus = GPUtil.getGPUs()
        if gpus:
            gpu_percent = gpus[0].load * 100
    except:
        pass

    return {
        'cpu_percent': cpu_percent,
        'memory_percent': memory.percent,
        'disk_percent': disk.percent,
        'gpu_percent': gpu_percent
    }


def collect_system_stats():
    """Background thread: пишет загрузку железа в БД (персистентно, общо для воркеров).

    Раньше история жила в памяти каждого из 8 воркеров — терялась при рестарте и
    «прыгала» между воркерами. Теперь:
      • минутная точка -> system_metric (retention ~3 дня; для графиков 1 Hour / 1 Day);
      • дневное среднее -> system_metric_daily (retention ~400 дней; для Week / Month / Year).
    Дедуп между воркерами — UPSERT по ключу (минута / день): 8 воркеров пишут одно и
    то же в одну минуту, последний просто перезаписывает. Ошибки БД глотаются, чтобы
    фоновый поток не падал.
    """
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy import func
    while True:
        try:
            stats = get_system_stats()
            now = datetime.utcnow()
            ts = now.replace(second=0, microsecond=0)
            today = now.date()
            day_start = datetime(now.year, now.month, now.day)
            with app.app_context():
                # 1. UPSERT минутной точки
                vals = {
                    'cpu': stats['cpu_percent'], 'memory': stats['memory_percent'],
                    'disk': stats['disk_percent'], 'gpu': stats['gpu_percent'],
                }
                m_stmt = pg_insert(SystemMetric.__table__).values(ts=ts, **vals)
                m_stmt = m_stmt.on_conflict_do_update(index_elements=['ts'], set_=vals)
                db.session.execute(m_stmt)

                # 2. Дневное среднее за сегодня (из минутных точек этого дня)
                avg = db.session.query(
                    func.avg(SystemMetric.cpu), func.avg(SystemMetric.memory),
                    func.avg(SystemMetric.disk), func.avg(SystemMetric.gpu)
                ).filter(SystemMetric.ts >= day_start).one()
                dvals = {
                    'cpu': float(avg[0] or 0), 'memory': float(avg[1] or 0),
                    'disk': float(avg[2] or 0), 'gpu': float(avg[3] or 0),
                }
                d_stmt = pg_insert(SystemMetricDaily.__table__).values(day=today, **dvals)
                d_stmt = d_stmt.on_conflict_do_update(index_elements=['day'], set_=dvals)
                db.session.execute(d_stmt)

                # 3. Retention
                db.session.query(SystemMetric).filter(SystemMetric.ts < now - timedelta(days=3)).delete()
                db.session.query(SystemMetricDaily).filter(SystemMetricDaily.day < today - timedelta(days=400)).delete()
                db.session.commit()
        except Exception as e:
            try:
                db.session.rollback()
            except Exception:
                pass
            logging.warning(f"collect_system_stats DB error: {e}")
        time.sleep(60)  # Collect stats every minute

@app.route('/admin')
@login_required
@admin_required
def admin_dashboard():
    # Get system stats
    stats = get_system_stats()

    # Get paginated projects
    project_page = request.args.get('project_page', 1, type=int)
    projects = Project.query.order_by(Project.created_at.desc())\
        .paginate(page=project_page, per_page=20, error_out=False)

    # Get paginated recent users (registered in the last 30 days)
    user_page = request.args.get('user_page', 1, type=int)
    today = datetime.utcnow().date()
    users = User.query.filter(User.created_at >= today - timedelta(days=30))\
        .order_by(User.created_at.desc())\
        .paginate(page=user_page, per_page=10, error_out=False)

    return render_template('admin/dashboard.html', 
                         projects=projects,
                         users=users,
                         today=today,
                         **stats)

@app.route('/admin/stats')
@login_required
@admin_required
def admin_stats():
    """API endpoint to get updated system stats (персистентно из БД).

    history       — минутные точки за ~25 ч (для графиков 1 Hour / 1 Day);
    history_daily — дневные средние за ~год (для Week / Month / Year).
    Формат точек '[ "YYYY-MM-DD HH:MM", value ]' совместим с фронтом (он парсит как UTC).
    """
    current_stats = get_system_stats()
    now = datetime.utcnow()

    empty = {'cpu': [], 'memory': [], 'disk': [], 'gpu': []}
    history = {k: [] for k in empty}
    history_daily = {k: [] for k in empty}

    try:
        minute_cut = now - timedelta(hours=25)
        for r in db.session.query(SystemMetric).filter(SystemMetric.ts >= minute_cut).order_by(SystemMetric.ts).all():
            ts_str = r.ts.strftime('%Y-%m-%d %H:%M')
            history['cpu'].append([ts_str, r.cpu])
            history['memory'].append([ts_str, r.memory])
            history['disk'].append([ts_str, r.disk])
            history['gpu'].append([ts_str, r.gpu])

        day_cut = now.date() - timedelta(days=400)
        for r in db.session.query(SystemMetricDaily).filter(SystemMetricDaily.day >= day_cut).order_by(SystemMetricDaily.day).all():
            d_str = r.day.strftime('%Y-%m-%d 00:00')
            history_daily['cpu'].append([d_str, r.cpu])
            history_daily['memory'].append([d_str, r.memory])
            history_daily['disk'].append([d_str, r.disk])
            history_daily['gpu'].append([d_str, r.gpu])
    except Exception as e:
        try:
            db.session.rollback()
        except Exception:
            pass
        logging.warning(f"admin_stats DB read error: {e}")

    return jsonify({
        'current': current_stats,
        'history': history,
        'history_daily': history_daily
    })

@app.route('/admin/lists')
@login_required
@admin_required
def admin_lists():
    """API endpoint to get updated users and projects lists"""
    project_page = request.args.get('project_page', 1, type=int)
    user_page = request.args.get('user_page', 1, type=int)
    today = datetime.utcnow().date()

    # Get paginated projects
    projects = Project.query.order_by(Project.created_at.desc())\
        .paginate(page=project_page, per_page=20, error_out=False)

    # Get paginated users (all users, not just recent ones)
    users = User.query.order_by(User.created_at.desc())\
        .paginate(page=user_page, per_page=10, error_out=False)

    # Format users data with additional fields
    users_data = [{
        'id': u.id,
        'name': u.name,
        'email': u.email,
        'created_at': u.created_at.strftime('%Y-%m-%d %H:%M'),
        'is_email_confirmed': u.is_email_confirmed,
        'is_new': u.created_at.date() == today,
        'is_admin': u.is_admin,
        'is_active': u.is_active
    } for u in users.items]

    # Format projects data with additional fields
    projects_data = [{
        'id': p.id,
        'user_name': p.user.name,
        'user_email': p.user.email,
        'name': p.name,
        'status': p.status,
        'csv_type': p.csv_type,
        'mode': 'editor' if p.csv_type == 'video_editor' else 'classic',
        'created_at': p.created_at.strftime('%Y-%m-%d %H:%M'),
        'progress': int(p.progress),  # Round progress to integer
        'duration': p.get_duration_str(),  # Add duration
        'time_until_expiry': p.time_until_expiry(),  # Add expiry time
        'processing_time': p.get_processing_time_str(),  # Add processing time
        'fps': f"{p.fps:.2f}" if p.fps else '-',  # Add FPS
        'resolution': p.resolution or '-',  # Add resolution
        'has_csv': bool(p.csv_file and os.path.exists(os.path.join('processed_data', f'project_{p.folder_number}_{os.path.basename(p.csv_file)}'))),
        'has_video': bool(p.video_file and os.path.exists(os.path.join('videos', p.video_file)))
    } for p in projects.items]

    return jsonify({
        'projects': {
            'items': projects_data,
            'has_next': projects.has_next,
            'has_prev': projects.has_prev,
            'page': projects.page,
            'pages': projects.pages,
            'total': projects.total
        },
        'users': {
            'items': users_data,
            'has_next': users.has_next,
            'has_prev': users.has_prev,
            'page': users.page,
            'pages': users.pages,
            'total': users.total
        }
    })

@app.route('/admin/usage-stats')
@login_required
@admin_required
def admin_usage_stats():
    """Агрегаты несгораемой таблицы UsageEvent для карточки аналитики на дашборде.

    Отвечает на вопрос «классика vs серверный редактор vs Local Export» с полной
    историей (UsageEvent не удаляется автоочисткой, в отличие от Project)."""
    from sqlalchemy import func
    now = datetime.utcnow()
    day_ago = now - timedelta(hours=24)
    week_ago = now - timedelta(days=7)

    def scalar(q):
        return q.scalar() or 0

    def mode_breakdown(since=None):
        q = db.session.query(UsageEvent.mode, func.count(UsageEvent.id))
        if since is not None:
            q = q.filter(UsageEvent.created_at >= since)
        rows = dict(q.group_by(UsageEvent.mode).all())
        return {
            'classic': int(rows.get('classic', 0)),
            'editor_server': int(rows.get('editor_server', 0)),
            'editor_local': int(rows.get('editor_local', 0)),
        }

    def group_count(col, only_modes=None):
        q = db.session.query(col, func.count(UsageEvent.id))
        if only_modes is not None:
            q = q.filter(UsageEvent.mode.in_(only_modes))
        out = {}
        for k, v in q.group_by(col).all():
            out[str(k) if k is not None else '—'] = int(v)
        return out

    totals = {
        'today': scalar(db.session.query(func.count(UsageEvent.id)).filter(UsageEvent.created_at >= day_ago)),
        'week': scalar(db.session.query(func.count(UsageEvent.id)).filter(UsageEvent.created_at >= week_ago)),
        'all': scalar(db.session.query(func.count(UsageEvent.id))),
    }

    users_total = scalar(db.session.query(func.count(User.id)))
    users_confirmed = scalar(db.session.query(func.count(User.id)).filter(User.is_email_confirmed == True))
    creators = scalar(db.session.query(func.count(func.distinct(UsageEvent.user_id))))

    track_on = scalar(db.session.query(func.count(UsageEvent.id)).filter(UsageEvent.has_track_map == True))
    laps_on = scalar(db.session.query(func.count(UsageEvent.id)).filter(UsageEvent.has_laps == True))

    recent = []
    for ev in db.session.query(UsageEvent).order_by(UsageEvent.created_at.desc()).limit(12).all():
        recent.append({
            'created_at': ev.created_at.strftime('%Y-%m-%d %H:%M') if ev.created_at else '',
            'mode': ev.mode,
            'user_email': ev.user.email if ev.user else '—',
            'csv_source': ev.csv_source or '—',
            'resolution': ev.resolution or '—',
            'codec': ev.codec or '—',
            'quality': ev.quality or '—',
            'duration': round(ev.duration_sec) if ev.duration_sec else None,
            'has_track_map': bool(ev.has_track_map),
            'has_laps': bool(ev.has_laps),
            'success': bool(ev.success),
        })

    return jsonify({
        'totals': totals,
        'by_mode': {
            'today': mode_breakdown(day_ago),
            'week': mode_breakdown(week_ago),
            'all': mode_breakdown(None),
        },
        'by_csv': group_count(UsageEvent.csv_source),
        'by_resolution': group_count(UsageEvent.resolution),
        'by_quality': group_count(UsageEvent.quality, only_modes=['editor_server']),
        'track_usage': {'with_track': track_on, 'with_laps': laps_on},
        'funnel': {'users_total': users_total, 'users_confirmed': users_confirmed, 'creators': creators},
        'recent': recent,
    })


@app.route('/admin/usage-history')
@login_required
@admin_required
def admin_usage_history():
    """Пагинируемая история UsageEvent для под-вкладки «История экспортов».

    Несгораемый лог всех экспортов (классика / серверный редактор / Local Export)
    с опциональным фильтром по режиму. `recent` в admin_usage_stats ограничен 12 —
    здесь полная история с пагинацией."""
    page = request.args.get('page', 1, type=int)
    mode = request.args.get('mode', '') or ''
    q = UsageEvent.query
    if mode in ('classic', 'editor_server', 'editor_local'):
        q = q.filter(UsageEvent.mode == mode)
    pag = q.order_by(UsageEvent.created_at.desc()).paginate(page=page, per_page=25, error_out=False)
    items = [{
        'created_at': ev.created_at.strftime('%Y-%m-%d %H:%M') if ev.created_at else '',
        'mode': ev.mode,
        'user_email': ev.user.email if ev.user else '—',
        'csv_source': ev.csv_source or '—',
        'resolution': ev.resolution or '—',
        'codec': ev.codec or '—',
        'quality': ev.quality or '—',
        'duration': round(ev.duration_sec) if ev.duration_sec else None,
        'has_track_map': bool(ev.has_track_map),
        'has_laps': bool(ev.has_laps),
        'success': bool(ev.success),
    } for ev in pag.items]
    return jsonify({
        'items': items,
        'page': pag.page, 'pages': pag.pages, 'total': pag.total,
        'has_next': pag.has_next, 'has_prev': pag.has_prev,
        'mode': mode,
    })


@app.route('/admin/error-reports')
@login_required
@admin_required
def admin_error_reports():
    """Список отчётов об ошибках (JSON) для раздела админки. Фильтр open/all + пагинация."""
    page = request.args.get('page', 1, type=int)
    show = request.args.get('show', 'open')  # 'open' = только нерешённые | 'all'
    q = ErrorReport.query
    if show == 'open':
        q = q.filter(ErrorReport.resolved == False)
    pag = q.order_by(ErrorReport.created_at.desc()).paginate(page=page, per_page=20, error_out=False)

    def short(s, n=140):
        if not s:
            return ''
        s = str(s)
        return s[:n] + ('…' if len(s) > n else '')

    items = [{
        'id': r.id,
        'created_at': r.created_at.strftime('%Y-%m-%d %H:%M') if r.created_at else '',
        'user_email': r.user.email if r.user else '—',
        'source': r.source or '—',
        'error_message': short(r.error_message),
        'resolved': bool(r.resolved),
        'has_note': bool(r.user_note),
    } for r in pag.items]

    return jsonify({
        'items': items,
        'page': pag.page, 'pages': pag.pages, 'total': pag.total,
        'has_next': pag.has_next, 'has_prev': pag.has_prev,
        'open_count': ErrorReport.query.filter(ErrorReport.resolved == False).count(),
        'total_count': ErrorReport.query.count(),
        'show': show,
    })


@app.route('/admin/error-reports/<int:report_id>')
@login_required
@admin_required
def admin_error_report_detail(report_id):
    """Полные детали одного отчёта, включая распарсенный JSON-контекст."""
    r = ErrorReport.query.get_or_404(report_id)
    return jsonify({
        'id': r.id,
        'created_at': r.created_at.strftime('%Y-%m-%d %H:%M:%S') if r.created_at else '',
        'user_email': r.user.email if r.user else None,
        'user_id': r.user_id,
        'source': r.source,
        'error_message': r.error_message,
        'error_stack': r.error_stack,
        'context': r.get_context(),
        'user_agent': r.user_agent,
        'url': r.url,
        'user_note': r.user_note,
        'resolved': bool(r.resolved),
    })


@app.route('/admin/error-reports/<int:report_id>/resolve', methods=['POST'])
@login_required
@admin_required
def admin_error_report_resolve(report_id):
    r = ErrorReport.query.get_or_404(report_id)
    r.resolved = not r.resolved
    db.session.commit()
    return jsonify({'success': True, 'resolved': bool(r.resolved)})


@app.route('/admin/error-reports/<int:report_id>/delete', methods=['POST'])
@login_required
@admin_required
def admin_error_report_delete(report_id):
    r = ErrorReport.query.get_or_404(report_id)
    db.session.delete(r)
    db.session.commit()
    return jsonify({'success': True})


# Add context processor for datetime
@app.context_processor
def inject_now():
    return {'now': datetime.utcnow()}

# Create required directories with proper error handling
for directory in ['uploads', 'frames', 'videos', 'processed_data', 'previews', 'archives']:
    try:
        os.makedirs(directory, exist_ok=True)
        logging.info(f"Ensuring directory exists: {directory}")
    except Exception as e:
        logging.error(f"Error creating directory {directory}: {str(e)}")
        raise

db.init_app(app)
migrate = Migrate(app, db)

# Mark orphaned projects as error during startup (only after DB init)
with app.app_context():
    orphaned_count = check_orphaned_projects()
    if orphaned_count > 0:
        logging.info(f"Marked {orphaned_count} projects as 'error' due to server restart")


# Authentication routes
@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    form = LoginForm()
    show_resend_option = False  # По умолчанию не показываем опцию повторной отправки
    
    # Проверяем, был ли передан запрос на отображение опции повторной отправки
    email_needs_confirmation = request.args.get('email_needs_confirmation')
    
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user is None or not user.check_password(form.password.data) or not user.is_active:
            flash(_('Invalid email or password'))
            return redirect(url_for('login'))
        if not user.is_email_confirmed:
            flash(_('Please confirm your email address before logging in.'))
            # Добавляем параметр для показа опции повторной отправки
            return redirect(url_for('login', email_needs_confirmation=1))
        login_user(user, remember=True)  # Remember user session for 6 months
        return redirect(url_for('index'))
        
    # Если пользователь ввел верные данные, но email не подтвержден - показать опцию
    if email_needs_confirmation:
        show_resend_option = True
        
    return render_template('login.html', form=form, show_resend_option=show_resend_option)

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    form = RegistrationForm()
    if form.validate_on_submit():
        # Get client IP address
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr)
        if client_ip and ',' in client_ip:
            client_ip = client_ip.split(',')[0].strip()
        
        # Check IP registration limit BEFORE creating any user records
        if not RegistrationAttempt.can_register(client_ip):
            attempts_count = RegistrationAttempt.get_daily_attempts_count(client_ip)
            if get_locale() == 'ru':
                flash('Превышен лимит регистраций с вашего IP-адреса (максимум 3 в день). Попробуйте снова завтра.')
            else:
                flash('Registration limit exceeded from your IP address (maximum 3 per day). Please try again tomorrow.')
            logging.warning(f"Registration blocked for IP {client_ip}: {attempts_count} attempts in 24 hours")
            # Do NOT log failed attempts or create user records to prevent database spam
            return redirect(url_for('register'))
        
        # Проверяем, существует ли пользователь с таким email (активный или неактивный)
        existing_user = User.query.filter_by(email=form.email.data).first()
        
        # Проверяем дополнительно неактивных пользователей с этим же email (может случиться при смене регистра)
        if not existing_user:
            existing_user = User.query.filter(User.email.ilike(form.email.data)).first()
        
        if existing_user:
            if existing_user.is_active:
                # Если пользователь активен, сообщаем что email занят
                flash(_('This email is already registered'))
                # Если email не подтвержден, предлагаем запросить подтверждение снова
                if not existing_user.is_email_confirmed:
                    flash(_('If you have not received the confirmation email, you can request a new one'))
                return redirect(url_for('register'))
            else:
                # Если пользователь неактивен, активируем и обновляем данные
                existing_user.is_active = True
                existing_user.name = form.name.data
                existing_user.set_password(form.password.data)
                confirmation_token = existing_user.generate_email_confirmation_token()
                db.session.commit()
                
                # Перенаправляем на отправку подтверждения
                try:
                    # Get user's preferred language
                    user_locale = request.accept_languages.best_match(['en', 'ru'])
                    
                    # Prepare email content based on locale
                    confirmation_link = url_for('confirm_email', token=confirmation_token, _external=True)
                    if user_locale == 'ru':
                        confirmation_html = f"""
                        <h2>Подтвердите регистрацию</h2>
                        <p>Здравствуйте, {existing_user.name},</p>
                        <p>Спасибо за регистрацию в EUCTelemetry. Пожалуйста, нажмите на ссылку ниже, чтобы подтвердить ваш email:</p>
                        <p><a href="{confirmation_link}">{confirmation_link}</a></p>
                        <p>Эта ссылка будет действительна в течение 24 часов.</p>
                        <p>С наилучшими пожеланиями,<br>Команда EUCTelemetry</p>
                        """
                    else:
                        confirmation_html = f"""
                        <h2>Confirm Your Registration</h2>
                        <p>Hello {existing_user.name},</p>
                        <p>Thank you for registering with EUCTelemetry. Please click the link below to confirm your email address:</p>
                        <p><a href="{confirmation_link}">{confirmation_link}</a></p>
                        <p>This link will expire in 24 hours.</p>
                        <p>Best regards,<br>EUCTelemetry Team</p>
                        """
                    
                    if send_email(existing_user.email, "Confirm Your Email Address", confirmation_html):
                        flash(_('Please check your email to complete registration.'))
                        # Перенаправляем с параметром, чтобы показать опцию повторной отправки
                        return redirect(url_for('login', email_needs_confirmation=1))
                    else:
                        flash(_('Error sending confirmation email. Please try registering again.'))
                        existing_user.is_active = False
                        db.session.commit()
                        return redirect(url_for('login'))
                    
                except Exception as e:
                    db.session.rollback()
                    logging.error(f"Registration error: {str(e)}")
                    flash(_('An error occurred during registration. Please try again later.'))
                    return redirect(url_for('register'))

        # Check if this is the first user
        is_first_user = User.query.count() == 0

        user = User(
            email=form.email.data,
            name=form.name.data,
            is_admin=is_first_user  # Set admin status based on whether this is the first user
        )
        user.set_password(form.password.data)
        confirmation_token = user.generate_email_confirmation_token()
        db.session.add(user)

        try:
            # Коммит для сохранения токена в базе данных до отправки письма
            db.session.commit()
            
            # Дополнительная проверка токена в базе данных
            stored_token = User.query.filter_by(email=form.email.data).first().email_confirmation_token
            if stored_token != confirmation_token:
                logging.warning(f"Token mismatch: generated={confirmation_token}, stored={stored_token}")
                # В этом случае используем токен из базы данных
                confirmation_token = stored_token

            # Get user's preferred language
            user_locale = request.accept_languages.best_match(['en', 'ru'])

            # Prepare email content based on locale
            confirmation_link = url_for('confirm_email', token=confirmation_token, _external=True)
            if user_locale == 'ru':
                confirmation_html = f"""
                <h2>Подтвердите регистрацию</h2>
                <p>Здравствуйте, {user.name},</p>
                <p>Спасибо за регистрацию в EUCTelemetry. Пожалуйста, нажмите на ссылку ниже, чтобы подтвердить ваш email:</p>
                <p><a href="{confirmation_link}">{confirmation_link}</a></p>
                <p>Эта ссылка будет действительна в течение 24 часов.</p>
                <p>С наилучшими пожеланиями,<br>Команда EUCTelemetry</p>
                """
            else:
                confirmation_html = f"""
                <h2>Confirm Your Registration</h2>
                <p>Hello {user.name},</p>
                <p>Thank you for registering with EUCTelemetry. Please click the link below to confirm your email address:</p>
                <p><a href="{confirmation_link}">{confirmation_link}</a></p>
                <p>This link will expire in 24 hours.</p>
                <p>Best regards,<br>EUCTelemetry Team</p>
                """

            if send_email(user.email, "Confirm Your Email Address", confirmation_html):
                # Log successful registration attempt
                RegistrationAttempt.log_attempt(
                    ip_address=client_ip,
                    email=form.email.data,
                    success=True,
                    user_agent=request.headers.get('User-Agent')
                )
                flash(_('Please check your email to complete registration.'))
                # Перенаправляем с параметром, чтобы показать опцию повторной отправки
                return redirect(url_for('login', email_needs_confirmation=1))
            else:
                flash(_('Error sending confirmation email. Please try registering again.'))
                # Деактивировать пользователя вместо удаления 
                user.is_active = False
                db.session.commit()
                return redirect(url_for('login'))

        except Exception as e:
            db.session.rollback()
            logging.error(f"Registration error: {str(e)}")
            flash(_('An error occurred during registration. Please try again later.'))
            return redirect(url_for('register'))

    # Generate math captcha for GET requests or after form validation errors
    captcha_question = generate_math_captcha()
    return render_template('register.html', form=form, 
                         captcha_question=captcha_question,
                         recaptcha_site_key=os.environ.get('RECAPTCHA_SITE_KEY'))

@app.route('/confirm/<token>')
def confirm_email(token):
    # Добавляем логирование для отладки
    logging.info(f"Attempting to confirm email with token: {token}")
    
    # Проверим наличие пользователя с таким токеном
    user = User.query.filter_by(email_confirmation_token=token).first()
    
    # Проверяем, найден ли пользователь с этим токеном
    if not user:
        logging.info(f"No user found with token: {token}")
        # Попробуем найти любого пользователя с ожидающим подтверждением
        users_waiting_confirmation = User.query.filter(
            User.email_confirmation_token.isnot(None)
        ).all()
        logging.info(f"Users waiting for confirmation: {len(users_waiting_confirmation)}")
        if users_waiting_confirmation:
            for u in users_waiting_confirmation:
                logging.info(f"User {u.email} has token: {u.email_confirmation_token}")
                # Проверим, был ли проблемный токен URLEncoded
                from urllib.parse import quote, unquote
                quoted_token = quote(u.email_confirmation_token)
                unquoted_token = unquote(token)
                if quoted_token == token or unquoted_token == u.email_confirmation_token:
                    logging.info(f"Match found with encoding differences: {u.email}")
                    user = u
                    break
        
        if not user:
            flash(_('Invalid confirmation link.'))
            return redirect(url_for('login'))
    
    logging.info(f"Found user: {user.email} with token: {user.email_confirmation_token}")

    # Проверяем, не истек ли срок действия ссылки
    if user.email_confirmation_sent_at < datetime.utcnow() - timedelta(days=1):
        logging.info(f"Token expired for user: {user.email}")
        flash(_('This confirmation link has expired. Please request a new confirmation email.'))
        # Вместо удаления пользователя, обнуляем токен подтверждения
        user.email_confirmation_token = None
        db.session.commit()
        return redirect(url_for('resend_confirmation'))

    # Подтверждаем email пользователя
    user.is_email_confirmed = True
    user.email_confirmation_token = None
    db.session.commit()
    logging.info(f"Email confirmed successfully for user: {user.email}")

    flash(_('Your email has been confirmed! You can now log in.'))
    return redirect(url_for('login'))

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/profile', methods=['GET', 'POST'])
@login_required
def profile():
    profile_form = ProfileForm(obj=current_user)
    password_form = ChangePasswordForm()
    delete_form = DeleteAccountForm()

    if profile_form.validate_on_submit():
        current_user.name = profile_form.name.data
        current_user.subscribed_to_emails = profile_form.subscribed_to_emails.data
        # Save the selected locale
        locale = request.form.get('locale')
        if locale in ['en', 'ru']:
            current_user.locale = locale
        db.session.commit()
        flash(_('Profile updated successfully'))
        return redirect(url_for('profile'))

    return render_template('profile.html', 
                         profile_form=profile_form, 
                         password_form=password_form,
                         delete_form=delete_form)

@app.route('/delete_account', methods=['POST'])
@login_required
def delete_account():
    form = DeleteAccountForm()
    if form.validate_on_submit():
        if current_user.check_password(form.password.data):
            # Delete all user's projects first
            projects = Project.query.filter_by(user_id=current_user.id).all()
            for project in projects:
                # Delete project files
                if project.csv_file:
                    csv_path = os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file)
                    if os.path.exists(csv_path):
                        os.remove(csv_path)

                # Delete preview file
                preview_path = os.path.join('previews', f'{project.id}_preview.png')
                if os.path.exists(preview_path):
                    os.remove(preview_path)

                if project.video_file:
                    video_path = os.path.join('videos', project.video_file)
                    if os.path.exists(video_path):
                        os.remove(video_path)

                # Delete frames directory
                frames_dir = f'frames/project_{project.folder_number}'
                if os.path.exists(frames_dir):
                    shutil.rmtree(frames_dir)

                # Delete processed CSV file
                if project.csv_file:
                    processed_csv = os.path.join('processed_data', f'project_{project.folder_number}_{os.path.basename(project.csv_file)}')
                    if os.path.exists(processed_csv):
                        os.remove(processed_csv)

            # Delete all projects from database
            Project.query.filter_by(user_id=current_user.id).delete()

            # Деактивировать пользователя вместо физического удаления
            current_user.is_active = False
            db.session.commit()
            
            # Выход из системы
            logout_user()
            
            flash('Your account has been successfully deleted')
            return redirect(url_for('index'))
        else:
            flash('Incorrect password')
    return redirect(url_for('profile'))


@app.route('/')
def index():
    if not current_user.is_authenticated:
        return redirect(url_for('home'))
    return render_template('index.html')

@app.route('/home')
def home():
    return render_template('home.html')

@app.route('/about')
def about():
    # Активные соавторы, отсортированные по display_order, затем по имени.
    coauthors = Coauthor.query.filter_by(is_active=True).order_by(
        Coauthor.display_order.asc(), Coauthor.name.asc()
    ).all()
    return render_template('about.html', coauthors=coauthors)

@app.route('/upload', methods=['POST'])
@login_required
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': _('No file provided')}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': _('No file selected')}), 400

    project_name = request.form.get('project_name', '').strip()

    # Validate project name
    if project_name:
        if not validate_project_name(project_name):
            return jsonify({'error': _('Invalid project name. Use up to 7 letters, numbers, dashes or underscores.')}), 400
    else:
        project_name = generate_project_name()

    try:
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        # Try to detect CSV type and validate format
        try:
            import pandas as pd
            # Try reading with different encodings
            try:
                df = pd.read_csv(file_path, encoding='utf-8')
            except UnicodeDecodeError:
                try:
                    df = pd.read_csv(file_path, encoding='latin1')
                except:
                    os.remove(file_path)
                    return jsonify({'error': 'Invalid file encoding. Please ensure your CSV file is properly encoded.'}), 400

            # Validate CSV format using the centralized detect_csv_type function
            from utils.csv_processor import detect_csv_type
            try:
                csv_type = detect_csv_type(df)
                if csv_type == 'processed':
                    csv_type = 'darnkessbot'
            except ValueError:
                os.remove(file_path)
                return jsonify({'error': 'Invalid CSV format. Please upload a CSV file from DarknessBot, WheelLog, or EUC World.'}), 400

        except Exception as e:
            logging.error(f"Error validating CSV format: {str(e)}")
            os.remove(file_path)
            return jsonify({'error': 'Invalid CSV file. Please upload a CSV file from DarknessBot, WheelLog, or EUC World.'}), 400

        # Create project with detected type and user_id
        project = Project(
            name=project_name,
            csv_file=filename,
            csv_type=csv_type,
            created_at=datetime.now(),
            expiry_date=datetime.now() + timedelta(hours=SiteSetting.get_int("upload_expiry_hours", 24)),
            status='pending',
            folder_number=Project.get_next_folder_number(),
            user_id=current_user.id
        )
        db.session.add(project)
        db.session.commit()

        # Create initial preview with default settings
        default_settings = {
            'vertical_position': 1,
            'horizontal_position': 50,
            'top_padding': 14,
            'bottom_padding': 41,
            'spacing': 10,
            'font_size': 22,
            'border_radius': 13,
            'show_speed': True,
            'show_max_speed': True,
            'show_voltage': True,
            'show_temp': True,
            'show_battery': True,
            'show_gps': True,
            'show_mileage': True,
            'show_pwm': True,
            'show_power': True,
            'show_current': True,
            'show_time': False,
            'show_bottom_elements': True,
            'indicator_x': 50,
            'indicator_y': 80,
            'speed_y': 0,
            'unit_y': 0,
            'speed_size': 100,
            'unit_size': 100,
            'indicator_scale': 100
        }

        preview_path = create_preview_frame(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project.id,
            'fullhd',
            default_settings
        )

        return jsonify({
            'success': True,
            'project_id': project.id
        })

    except Exception as e:
        logging.error(f"Error processing upload: {str(e)}")
        # Clean up file if it was saved
        if 'file_path' in locals() and os.path.exists(file_path):
            os.remove(file_path)
        return jsonify({'error': str(e)}), 500

@app.route('/generate_frames/<int:project_id>', methods=['POST'])
@login_required
def generate_project_frames(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    try:
        # Get settings from request
        data = request.get_json() if request.is_json else {}
        resolution = data.get('resolution', 'fullhd')
        fps = float(data.get('fps', 29.97))
        codec = data.get('codec', 'h264')
        interpolate_values = data.get('interpolate_values', True)

        # Get text display settings with explicit defaults
        text_settings = {
            'vertical_position': int(data.get('vertical_position', 50)),
            'horizontal_position': float(data.get('horizontal_position', 50)),
            'top_padding': int(data.get('top_padding', 10)),
            'bottom_padding': int(data.get('bottom_padding', 30)),
            'spacing': int(data.get('spacing', 20)),
            'font_size': int(data.get('font_size', 26)),
            'border_radius': int(data.get('border_radius', 13)),
            'indicator_x': float(data.get('indicator_x', 50)),
            'indicator_y': float(data.get('indicator_y', 80)),
            'speed_y': int(data.get('speed_y', 0)),
            'unit_y': int(data.get('unit_y', 0)),
            'speed_size': float(data.get('speed_size', 100)),
            'unit_size': float(data.get('unit_size', 100)),
            'indicator_scale': float(data.get('indicator_scale', 100)),
            # Add visibility settings with explicit defaults
            'show_speed': data.get('show_speed', True),
            'show_max_speed': data.get('show_max_speed', True),
            'show_voltage': data.get('show_voltage', True),
            'show_temp': data.get('show_temp', True),
            'show_battery': data.get('show_battery', True),
            'show_mileage': data.get('show_mileage', True),
            'show_pwm': data.get('show_pwm', True),
            'show_power': data.get('show_power', True),
            'show_current': data.get('show_current', True),  # Add current visibility setting
            'show_gps': data.get('show_gps', False),
            'show_time': data.get('show_time', False),
            'show_bottom_elements': data.get('show_bottom_elements', True),
            'use_icons': data.get('use_icons', False),
            'icon_vertical_offset': int(data.get('icon_vertical_offset', 5)),
            'icon_horizontal_spacing': int(data.get('icon_horizontal_spacing', 10)),
            'static_box_size': data.get('static_box_size', False),
            'vertical_layout': data.get('vertical_layout', False)
        }

        logging.info(f"Starting processing with settings: {text_settings}, interpolate_values: {interpolate_values}")

        # Update project settings immediately
        project.fps = round(fps, 2) if fps else fps
        project.resolution = resolution
        project.codec = codec
        project.processing_started_at = datetime.now()
        db.session.commit()

        # Get user's preferred locale
        user_locale = 'ru' if current_user.is_authenticated and hasattr(current_user, 'locale') and current_user.locale == 'ru' else 'en'

        # Start background processing with text settings, interpolation flag and locale
        process_project(project_id, resolution, fps, codec, text_settings, interpolate_values, locale=user_locale)

        return jsonify({'success': True, 'message': 'Processing started'})
    except Exception as e:
        logging.error(f"Error starting processing: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/project_status/<int:project_id>')
@login_required
def project_status(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    return jsonify({
        'status': project.status,
        'frame_count': project.frame_count,
        'video_file': project.video_file,
        'error_message': project.error_message,
        'progress': project.progress,  # Add progress to the response
        'processing_time': project.get_processing_time_str()
    })

@app.route('/check_processing_projects', methods=['GET'])
@login_required
def check_processing_projects():
    """Check the number of projects currently in 'processing' status for the user"""
    try:
        processing_count = Project.query.filter_by(
            user_id=current_user.id,
            status='processing'
        ).count()
        
        return jsonify({
            'count': processing_count,
            'can_process_more': processing_count < 2  # Limit is 2 processing projects
        })
    except Exception as e:
        logging.error(f"Error in check_processing_projects: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/projects')
@login_required
def list_projects():
    page = request.args.get('page', 1, type=int)
    from sqlalchemy import func
    projects = Project.query.filter_by(user_id=current_user.id)\
        .order_by(func.coalesce(Project.processing_completed_at, Project.created_at).desc())\
        .paginate(page=page, per_page=10, error_out=False)
    return render_template('projects.html', projects=projects)

@app.route('/download/<int:project_id>/<type>')
@login_required
def download_file(project_id, type):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id and not current_user.is_admin:
        return jsonify({'error': 'Unauthorized'}), 403

    # Срок хранения истёк — файлы удаляются фоновой очисткой; не отдаём «протухшую»
    # ссылку (например, из старой вкладки), а возвращаем к списку проектов.
    if project.is_expired():
        return redirect(url_for('list_projects'))

    if type == 'video' and project.video_file:
        video_path = os.path.join('videos', project.video_file)
        return send_file(video_path, as_attachment=True, conditional=True)
    elif type == 'png_archive':
        # Create PNG archive if it doesn't exist
        if not project.png_archive_file:
            from utils.archive_creator import create_png_archive
            archive_filename = create_png_archive(project.id, project.folder_number, project.name)
            if archive_filename:
                project.png_archive_file = archive_filename
                db.session.commit()
            else:
                return jsonify({'error': 'Failed to create PNG archive'}), 500
        
        # Download existing archive
        archive_path = os.path.join('archives', project.png_archive_file)
        if os.path.exists(archive_path):
            return send_file(archive_path, as_attachment=True, download_name=f'{project.name}_frames.zip', conditional=True)
        else:
            return jsonify({'error': 'Archive file not found'}), 404
    elif type == 'frames':
        # Legacy support - redirect to png_archive
        return download_file(project_id, 'png_archive')
    elif type == 'processed_csv':
        processed_csv = os.path.join('processed_data', f'project_{project.folder_number}_{os.path.basename(project.csv_file)}')
        if os.path.exists(processed_csv):
            return send_file(processed_csv, as_attachment=True)

    return jsonify({'error': 'File not found'}), 404

@app.route('/delete/<int:project_id>', methods=['POST'])
@login_required
def delete_project(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    try:
        # Delete associated files if they exist
        if project.csv_file:
            csv_path = os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file)
            if os.path.exists(csv_path):
                os.remove(csv_path)

        # Delete preview file if exists
        preview_path = os.path.join('previews', f'{project_id}_preview.png')
        if os.path.exists(preview_path):
            os.remove(preview_path)

        if project.video_file:
            video_path = os.path.join('videos', project.video_file)
            if os.path.exists(video_path):
                os.remove(video_path)

        # Delete PNG archive file if exists
        if project.png_archive_file:
            archive_path = os.path.join('archives', project.png_archive_file)
            if os.path.exists(archive_path):
                os.remove(archive_path)

        # Delete frames directory if it exists
        frames_dir = f'frames/project_{project.folder_number}'
        if os.path.exists(frames_dir):
            shutil.rmtree(frames_dir)

        # Delete processed CSV file if exists
        if project.csv_file:
            processed_csv = os.path.join('processed_data', f'project_{project.folder_number}_{os.path.basename(project.csv_file)}')
            if os.path.exists(processed_csv):
                os.remove(processed_csv)

        # Delete project from database
        db.session.delete(project)
        db.session.commit()

        return jsonify({'success': True})
    except Exception as e:
        logging.error(f"Error deleting project: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/get_csv_timerange/<int:project_id>', methods=['GET'])
@login_required
def get_csv_timerange(project_id):
    """Get the minimum and maximum timestamps of the CSV file"""
    try:
        import pandas as pd
        
        project = Project.query.get_or_404(project_id)
        if project.user_id != current_user.id:
            return jsonify({'error': 'Unauthorized'}), 403

        # Get processed file path
        processed_csv_path = os.path.join('processed_data', f'project_{project.folder_number}_{os.path.basename(project.csv_file)}')
        
        if not os.path.exists(processed_csv_path):
            return jsonify({'error': 'Processed CSV file not found'}), 404
        
        # Load the data and get min/max timestamps
        df = pd.read_csv(processed_csv_path)
        min_timestamp = float(df['timestamp'].min())
        max_timestamp = float(df['timestamp'].max())
        
        # Format timestamps as human-readable date strings
        min_date = datetime.fromtimestamp(min_timestamp).strftime('%Y-%m-%d %H:%M:%S')
        max_date = datetime.fromtimestamp(max_timestamp).strftime('%Y-%m-%d %H:%M:%S')
        
        # Count total rows
        total_rows = len(df)
        
        # Get speed and PWM data for the chart
        chart_data = {
            'timestamps': df['timestamp'].tolist(),
            'speed_values': df['speed'].tolist(),
            'pwm_values': df['pwm'].tolist()
        }
        
        return jsonify({
            'success': True, 
            'min_timestamp': min_timestamp,
            'max_timestamp': max_timestamp,
            'min_date': min_date,
            'max_date': max_date,
            'total_rows': total_rows,
            'chart_data': chart_data
        })
        
    except Exception as e:
        logging.error(f"Error getting CSV time range: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/trim_csv/<int:project_id>', methods=['POST'])
@login_required
def trim_csv(project_id):
    """Trim CSV file to the specified time range"""
    try:
        from utils.csv_processor import trim_csv_data
        
        project = Project.query.get_or_404(project_id)
        if project.user_id != current_user.id:
            return jsonify({'error': 'Unauthorized'}), 403
        
        # Get start and end timestamps from request
        data = request.json
        start_timestamp = float(data.get('start_timestamp'))
        end_timestamp = float(data.get('end_timestamp'))
        
        if start_timestamp >= end_timestamp:
            return jsonify({'error': 'Start timestamp must be less than end timestamp'}), 400
        
        # Trim the CSV data
        trim_csv_data(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project.folder_number,
            start_timestamp,
            end_timestamp
        )
        
        # Get settings from request for preview update
        resolution = data.get('resolution', 'fullhd')
        text_settings = {
            'vertical_position': int(data.get('vertical_position', 50)),
            'horizontal_position': float(data.get('horizontal_position', 50)),
            'top_padding': int(data.get('top_padding', 10)),
            'bottom_padding': int(data.get('bottom_padding', 30)),
            'spacing': int(data.get('spacing', 20)),
            'font_size': int(data.get('font_size', 26)),
            'border_radius': int(data.get('border_radius', 13)),
            'indicator_x': float(data.get('indicator_x', 50)),
            'indicator_y': float(data.get('indicator_y', 80)),
            'speed_y': int(data.get('speed_y', 0)),
            'unit_y': int(data.get('unit_y', 0)),
            'speed_size': float(data.get('speed_size', 100)),
            'unit_size': float(data.get('unit_size', 100)),
            'indicator_scale': float(data.get('indicator_scale', 100)),
            'show_speed': data.get('show_speed', True),
            'show_max_speed': data.get('show_max_speed', True),
            'show_voltage': data.get('show_voltage', True),
            'show_temp': data.get('show_temp', True),
            'show_battery': data.get('show_battery', True),
            'show_gps': data.get('show_gps', True),
            'show_mileage': data.get('show_mileage', True),
            'show_pwm': data.get('show_pwm', True),
            'show_power': data.get('show_power', True),
            'show_current': data.get('show_current', True),
            'show_time': data.get('show_time', False),
            'show_bottom_elements': data.get('show_bottom_elements', True),
            'use_icons': data.get('use_icons', False),
            'icon_vertical_offset': int(data.get('icon_vertical_offset', 5)),
            'icon_horizontal_spacing': int(data.get('icon_horizontal_spacing', 10)),
            'static_box_size': data.get('static_box_size', False),
            'vertical_layout': data.get('vertical_layout', False)
        }
        
        # Get user's preferred locale
        user_locale = 'ru' if current_user.is_authenticated and hasattr(current_user, 'locale') and current_user.locale == 'ru' else 'en'
        
        # Update preview after trimming
        preview_path = create_preview_frame(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project.id,
            resolution,
            text_settings,
            locale=user_locale
        )
        
        # Get updated time range
        import pandas as pd
        processed_csv_path = os.path.join('processed_data', f'project_{project.folder_number}_{os.path.basename(project.csv_file)}')
        df = pd.read_csv(processed_csv_path)
        min_timestamp = float(df['timestamp'].min())
        max_timestamp = float(df['timestamp'].max())
        total_rows = len(df)
        
        # Get speed and PWM data for the chart
        chart_data = {
            'timestamps': df['timestamp'].tolist(),
            'speed_values': df['speed'].tolist(),
            'pwm_values': df['pwm'].tolist()
        }
        
        return jsonify({
            'success': True, 
            'preview_url': url_for('serve_preview', filename=f'{project.id}_preview.png'),
            'min_timestamp': min_timestamp,
            'max_timestamp': max_timestamp,
            'total_rows': total_rows,
            'chart_data': chart_data
        })
        
    except Exception as e:
        logging.error(f"Error trimming CSV file: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/stop/<int:project_id>', methods=['POST'])
@login_required
def stop_project(project_id):
    """Stop project processing"""
    try:
        project = Project.query.get_or_404(project_id)
        if project.user_id != current_user.id:
            return jsonify({'error': 'Unauthorized'}), 403

        if project.status not in ['processing', 'pending']:
            return jsonify({'error': 'Project is not being processed'}), 400

        from utils.background_processor import stop_project_processing
        if stop_project_processing(project_id):
            return jsonify({'success': True})

        return jsonify({'error': 'Failed to stop project processing'}), 500

    except Exception as e:
        logging.error(f"Error in stop_project route: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/change_password', methods=['POST'])
@login_required
def change_password():
    form = ChangePasswordForm()
    if form.validate_on_submit():
        if current_user.check_password(form.current_password.data):
            current_user.set_password(form.new_password.data)
            db.session.commit()
            flash('Your password has been updated')
        else:
            flash('Current password is incorrect')
    return redirect(url_for('profile'))

@app.route('/resend_confirmation', methods=['GET', 'POST'])
def resend_confirmation():
    """Handle resending confirmation email for users whose link expired"""
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    form = ResendConfirmationForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user and not user.is_email_confirmed and user.is_active:
            # Generate a new confirmation token
            confirmation_token = user.generate_email_confirmation_token()
            # Сохраняем токен в базе данных немедленно
            db.session.commit()
            
            # Дополнительная проверка токена в базе данных
            stored_token = User.query.filter_by(email=form.email.data).first().email_confirmation_token
            if stored_token != confirmation_token:
                logging.warning(f"Token mismatch in resend: generated={confirmation_token}, stored={stored_token}")
                # В этом случае используем токен из базы данных
                confirmation_token = stored_token
            
            # Get user's preferred language or detect from browser
            user_locale = user.locale or request.accept_languages.best_match(['en', 'ru']) or 'en'
            
            # Prepare email content based on locale
            confirmation_link = url_for('confirm_email', token=confirmation_token, _external=True)
            if user_locale == 'ru':
                confirmation_html = f"""
                <h2>Подтвердите регистрацию</h2>
                <p>Здравствуйте, {user.name},</p>
                <p>Спасибо за регистрацию в EUCTelemetry. Пожалуйста, нажмите на ссылку ниже, чтобы подтвердить ваш email:</p>
                <p><a href="{confirmation_link}">{confirmation_link}</a></p>
                <p>Эта ссылка будет действительна в течение 24 часов.</p>
                <p>С наилучшими пожеланиями,<br>Команда EUCTelemetry</p>
                """
                subject = _("Подтвердите ваш адрес электронной почты")
            else:
                confirmation_html = f"""
                <h2>Confirm Your Registration</h2>
                <p>Hello {user.name},</p>
                <p>Thank you for registering with EUCTelemetry. Please click the link below to confirm your email address:</p>
                <p><a href="{confirmation_link}">{confirmation_link}</a></p>
                <p>This link will expire in 24 hours.</p>
                <p>Best regards,<br>EUCTelemetry Team</p>
                """
                subject = _("Confirm Your Email Address")

            if send_email(user.email, subject, confirmation_html):
                flash(_('New confirmation email sent. Please check your inbox.'))
            else:
                flash(_('Error sending confirmation email. Please try again later.'))
        else:
            # Don't reveal whether the email exists or is already confirmed
            flash(_('If your email is registered and not confirmed, a new confirmation email has been sent.'))
        
        return redirect(url_for('login'))
    
    return render_template('resend_confirmation.html', form=form)

@app.route('/forgot_password', methods=['GET', 'POST'])
def forgot_password():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    form = ForgotPasswordForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user:
            token = user.generate_password_reset_token()
            # Сохраняем токен в базе данных немедленно
            db.session.commit()
            
            # Дополнительная проверка токена в базе данных
            stored_token = User.query.filter_by(email=form.email.data).first().password_reset_token
            if stored_token != token:
                logging.warning(f"Token mismatch in password reset: generated={token}, stored={stored_token}")
                # В этом случае используем токен из базы данных
                token = stored_token
                
            reset_link = url_for('reset_password', token=token, _external=True)
            reset_html = f"""
            <h2>Password Reset Request</h2>
            <p>Hello {user.name},</p>
            <p>You have requested to reset your password. Please click the link below to set a new password:</p>
            <p><a href="{reset_link}">{reset_link}</a></p>
            <p>This link will expire in 24 hours.</p>
            <p>If you did not request this reset, please ignore this email.</p>
            <p>Best regards,<br>EUCTelemetry Team</p>
            """
            if send_email(user.email, "Password Reset Request", reset_html):
                flash('Check your email for password reset instructions')
            else:
                flash('Error sending password reset email. Please try again later.')
        else:
            flash('Check your email for password reset instructions')  # Security through obscurity
        return redirect(url_for('login'))
    return render_template('forgot_password.html', form=form)

@app.route('/reset_password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    user = User.query.filter_by(password_reset_token=token).first()
    if not user or not user.can_reset_password():
        flash('Invalid or expired password reset link')
        return redirect(url_for('login'))

    form = ResetPasswordForm()
    if form.validate_on_submit():
        user.set_password(form.password.data)
        user.password_reset_token = None
        user.password_reset_sent_at = None
        db.session.commit()
        flash('Your password has been reset')
        return redirect(url_for('login'))
    return render_template('reset_password.html', form=form)

@app.route('/admin/user/<int:user_id>', methods=['PUT'])
@login_required
@admin_required
def update_user(user_id):
    """Update user details from admin panel"""
    try:
        user = User.query.get_or_404(user_id)
        data = request.get_json()

        if 'name' in data:
            user.name = data['name']
        if 'email' in data:
            # Check if email is already taken by another user
            existing_user = User.query.filter_by(email=data['email']).first()
            if existing_user and existing_user.id != user_id:
                return jsonify({'success': False, 'error': 'Email already taken'}), 400
            user.email = data['email']
        if 'is_admin' in data:
            user.is_admin = bool(data['is_admin'])
        if 'is_email_confirmed' in data:
            user.is_email_confirmed = bool(data['is_email_confirmed'])
            # If email confirmation is manually set by admin, clear token
            if user.is_email_confirmed:
                user.email_confirmation_token = None
        if 'is_active' in data:
            # Обновляем статус активации пользователя
            was_active = user.is_active
            user.is_active = bool(data['is_active'])
            
            # Логируем изменение статуса
            action = "activated" if user.is_active else "deactivated"
            logging.info(f"User {user.id} ({user.email}) {action} by admin")
            
            # Если пользователь активирован, но email не подтвержден, сбрасываем токен
            # чтобы пользователь мог запросить новое письмо для подтверждения
            if user.is_active and not was_active and not user.is_email_confirmed:
                user.email_confirmation_token = None

        db.session.commit()
        return jsonify({
            'success': True,
            'message': 'User updated successfully'
        })
    except Exception as e:
        logging.error(f"Error updating user: {str(e)}")
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/admin/user/<int:user_id>', methods=['DELETE'])
@login_required
@admin_required
def delete_admin_user(user_id):
    """Delete user and all associated data"""
    user = User.query.get_or_404(user_id)

    try:
        # Delete all user's projects first
        projects = Project.query.filter_by(user_id=user.id).all()
        for project in projects:
            if not cleanup_project_files(project):
                return jsonify({'error': f'Failed to clean up files for project {project.id}'}), 500
            db.session.delete(project)

        # Деактивируем пользователя вместо физического удаления
        user.is_active = False
        # Сохраняем запись о деактивации
        logging.info(f"User {user.id} ({user.email}) deactivated by admin")
        db.session.commit()

        return jsonify({'success': True})

    except Exception as e:
        db.session.rollback()
        logging.error(f"Error deactivating user: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/admin/search-users', methods=['POST'])
@login_required
@admin_required
def search_users():
    """Search users by name pattern"""
    try:
        data = request.get_json()
        pattern = data.get('pattern', '').strip()
        
        if not pattern:
            return jsonify({'error': 'Pattern is required'}), 400
            
        # Search for users whose name contains the exact sequence of characters (case-insensitive)
        users = User.query.filter(User.name.ilike(f'%{pattern}%')).all()
        
        return jsonify({
            'users': [{
                'id': user.id,
                'name': user.name,
                'email': user.email,
                'is_admin': user.is_admin
            } for user in users]
        })
        
    except Exception as e:
        logging.error(f"Error searching users: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/admin/bulk-delete-users', methods=['POST'])
@login_required
@admin_required
def bulk_delete_users():
    """Bulk delete users by their IDs"""
    try:
        data = request.get_json()
        user_ids = data.get('user_ids', [])
        
        if not user_ids:
            return jsonify({'error': 'No user IDs provided'}), 400
            
        deleted_count = 0
        
        for user_id in user_ids:
            user = User.query.get(user_id)
            if user and not user.is_admin:  # Don't delete admin users
                # Delete all user's projects and files first
                projects = Project.query.filter_by(user_id=user.id).all()
                for project in projects:
                    cleanup_project_files(project)
                    db.session.delete(project)
                
                # Delete all user's presets
                presets = Preset.query.filter_by(user_id=user.id).all()
                for preset in presets:
                    db.session.delete(preset)
                
                # Delete registration attempts for this user
                registration_attempts = RegistrationAttempt.query.filter_by(email=user.email).all()
                for attempt in registration_attempts:
                    db.session.delete(attempt)
                    
                # Delete the user completely
                db.session.delete(user)
                deleted_count += 1
                logging.info(f"Admin deleted user {user.id} ({user.email}) via bulk delete")
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'deleted_count': deleted_count
        })
        
    except Exception as e:
        db.session.rollback()
        logging.error(f"Error bulk deleting users: {str(e)}")
        return jsonify({'error': str(e)}), 500

import os
# Add this new endpoint after other admin routes
@app.route('/admin/cleanup-storage', methods=['POST'])
@login_required
@admin_required
def cleanup_storage():
    """Clean up unused files from storage directories"""
    try:
        # Get all project files from database
        projects = Project.query.all()
        used_files = set()
        used_folders = set()  # Define used_folders set

        # Collect all files that are used by projects
        for project in projects:
            if project.csv_file:
                used_files.add(project.csv_file)  # uploads directory
                used_files.add(f'project_{project.folder_number}_{os.path.basename(project.csv_file)}')  # processed_data directory
            if project.video_file:
                used_files.add(project.video_file)  # videos directory
            if project.png_archive_file:
                used_files.add(project.png_archive_file)  # archives directory
            used_files.add(f'{project.id}_preview.png')  # previews directory
            # frames directory is handled by folder name
            used_folders.add(f'project_{project.folder_number}')  # frames directory

        deleted_files = []
        deleted_count = 0

        # Check uploads directory
        for filename in os.listdir('uploads'):
            if filename not in used_files:
                file_path = os.path.join('uploads', filename)
                try:
                    os.remove(file_path)
                    deleted_files.append(f'uploads/{filename}')
                    deleted_count += 1
                    logging.info(f"Deleted unused file: {file_path}")
                except Exception as e:
                    logging.error(f"Error deleting file {file_path}: {str(e)}")

        # Check previews directory
        for filename in os.listdir('previews'):
            if filename not in used_files:
                file_path = os.path.join('previews', filename)
                try:
                    os.remove(file_path)
                    deleted_files.append(f'previews/{filename}')
                    deleted_count += 1
                    logging.info(f"Deleted unused file: {file_path}")
                except Exception as e:
                    logging.error(f"Error deleting file {file_path}: {str(e)}")

        # Check videos directory
        for filename in os.listdir('videos'):
            if filename not in used_files:
                file_path = os.path.join('videos', filename)
                try:
                    os.remove(file_path)
                    deleted_files.append(f'videos/{filename}')
                    deleted_count += 1
                    logging.info(f"Deleted unused file: {file_path}")
                except Exception as e:
                    logging.error(f"Error deleting file {file_path}: {str(e)}")

        # Check processed_data directory
        for filename in os.listdir('processed_data'):
            if filename not in used_files:
                file_path = os.path.join('processed_data', filename)
                try:
                    os.remove(file_path)
                    deleted_files.append(f'processed_data/{filename}')
                    deleted_count += 1
                    logging.info(f"Deleted unused file: {file_path}")
                except Exception as e:
                    logging.error(f"Error deleting file {file_path}: {str(e)}")

        # Check frames directory
        for foldername in os.listdir('frames'):
            if foldername not in used_folders:
                folder_path = os.path.join('frames', foldername)
                try:
                    if os.path.isdir(folder_path):
                        shutil.rmtree(folder_path)
                        deleted_files.append(f'frames/{foldername}')
                        deleted_count += 1
                        logging.info(f"Deleted unused folder: {folder_path}")
                except Exception as e:
                    logging.error(f"Error deleting folder {folder_path}: {str(e)}")

        # Check archives directory
        if os.path.exists('archives'):
            for filename in os.listdir('archives'):
                if filename not in used_files:
                    file_path = os.path.join('archives', filename)
                    try:
                        os.remove(file_path)
                        deleted_files.append(f'archives/{filename}')
                        deleted_count += 1
                        logging.info(f"Deleted unused archive: {file_path}")
                    except Exception as e:
                        logging.error(f"Error deleting archive {file_path}: {str(e)}")

        return jsonify({
            'success': True,
            'deleted_count': deleted_count,
            'deleted_files': deleted_files
        })

    except Exception as e:
        logging.error(f"Error during storage cleanup: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/admin/cleanup-ve-uploads', methods=['POST'])
@login_required
@admin_required
def cleanup_ve_uploads():
    """Clean up abandoned video editor uploads: orphan chunks + files older than 24h.
    Использует общую логику _cleanup_ve_uploads_files (та же, что и часовой таймер)."""
    try:
        res = _cleanup_ve_uploads_files(max_age_hours=24)
        return jsonify({
            'success': True,
            'deleted_count': res['deleted_count'],
            'freed_mb': round(res['freed_bytes'] / 1024 / 1024, 1),
            'deleted_files': res['deleted_files']
        })
    except Exception as e:
        logging.error(f"VE cleanup error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/admin/cleanup-old-projects', methods=['POST'])
@login_required
@admin_required
def cleanup_old_projects():
    """Delete all completed projects older than N days and their files"""
    try:
        days = int(request.json.get('days', 7))
        cutoff = datetime.now() - timedelta(days=days)
        projects = Project.query.filter(Project.created_at < cutoff).all()

        deleted_count = 0
        freed_bytes = 0

        for project in projects:
            # Delete associated files
            paths_to_delete = []
            if project.csv_file:
                paths_to_delete.append(os.path.join('uploads', project.csv_file))
            if project.video_file:
                paths_to_delete.append(os.path.join('videos', project.video_file))
            if project.png_archive_file:
                paths_to_delete.append(os.path.join('archives', project.png_archive_file))
            # Frames folder
            frame_dir = os.path.join('frames', f'project_{project.folder_number}')
            if os.path.isdir(frame_dir):
                for dp, dn, fnames in os.walk(frame_dir):
                    for f in fnames:
                        freed_bytes += os.path.getsize(os.path.join(dp, f))
                shutil.rmtree(frame_dir)
            # Processed data
            if project.csv_file:
                pd_file = os.path.join('processed_data', f'project_{project.folder_number}_{os.path.basename(project.csv_file)}')
                paths_to_delete.append(pd_file)
            # Preview
            paths_to_delete.append(os.path.join('previews', f'{project.id}_preview.png'))

            for p in paths_to_delete:
                if os.path.isfile(p):
                    freed_bytes += os.path.getsize(p)
                    os.remove(p)

            db.session.delete(project)
            deleted_count += 1

        db.session.commit()
        return jsonify({
            'success': True,
            'deleted_count': deleted_count,
            'freed_mb': round(freed_bytes / 1024 / 1024, 1),
        })
    except Exception as e:
        db.session.rollback()
        logging.error(f"Old projects cleanup error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/admin/storage-stats', methods=['GET'])
@login_required
@admin_required
def storage_stats():
    """Get storage usage breakdown"""
    dirs = {
        'uploads': 'uploads',
        'uploads/video_editor': os.path.join('uploads', 'video_editor'),
        'videos': 'videos',
        'frames': 'frames',
        'archives': 'archives',
        'processed_data': 'processed_data',
        'previews': 'previews',
    }
    result = {}
    for name, path in dirs.items():
        if os.path.exists(path):
            total = sum(os.path.getsize(os.path.join(dp, f)) for dp, dn, fnames in os.walk(path) for f in fnames)
            result[name] = round(total / 1024 / 1024, 1)
        else:
            result[name] = 0
    result['total'] = round(sum(result.values()), 1)
    return jsonify(result)


@app.route('/set_language/<lang>')
def set_language(lang):
    if lang not in ['en', 'ru']:
        return redirect(request.referrer or url_for('index'))

    # Save language preference for logged in users
    if current_user.is_authenticated:
        current_user.locale = lang
        db.session.commit()

    # Store language in query parameter for the redirect
    next_url = request.referrer or url_for('index')
    if '?' in next_url:
        next_url = next_url.split('?')[0]
    next_url = f"{next_url}?lang={lang}"

    return redirect(next_url)

# Add new route for unsubscribe
@app.route('/unsubscribe/<token>')
def unsubscribe(token):
    user = User.query.filter_by(email_confirmation_token=token).first()
    if not user:
        flash(_('Invalid unsubscribe link.'))
        return redirect(url_for('index'))

    user.subscribed_to_emails = False
    user.email_confirmation_token = None  # Clear the token
    db.session.commit()

    flash(_('You have been successfully unsubscribed from email notifications.'))
    if current_user.is_authenticated:
        return redirect(url_for('profile'))
    return redirect(url_for('index'))

@app.route('/admin/email-campaigns', methods=['GET', 'POST'])
@login_required
@admin_required
def email_campaigns():
    form = EmailCampaignForm()
    if form.validate_on_submit():
        try:
            # Get all subscribed users
            subscribed_users = User.query.filter_by(subscribed_to_emails=True).all()
            if not subscribed_users:
                flash(_('No subscribed users found.'))
                return redirect(url_for('email_campaigns'))

            # Create campaign record
            campaign = EmailCampaign(
                subject=form.subject.data,
                html_content=form.html_content.data,
                sender_id=current_user.id,
                recipients_count=len(subscribed_users),
                started_at=datetime.utcnow()
            )
            db.session.add(campaign)
            db.session.commit()

            # Start background email sending task
            from utils.background_tasks import task_manager
            
            user_ids = [user.id for user in subscribed_users]
            task_id = task_manager.add_task('email_campaign', {
                'campaign_id': campaign.id,
                'subject': form.subject.data,
                'html_content': form.html_content.data,
                'user_ids': user_ids
            })
            
            # Update campaign with task ID
            campaign.task_id = task_id
            db.session.commit()

            flash(_('Campaign queued successfully for %(count)d users. Sending in background.', count=len(subscribed_users)))
            return jsonify({
                'success': True, 
                'message': _('Campaign queued successfully. Sending in background.'),
                'task_id': task_id
            })

        except Exception as e:
            db.session.rollback()
            logging.error(f"Error sending campaign: {str(e)}")
            return jsonify({'success': False, 'error': str(e)})

    campaigns = EmailCampaign.query.order_by(EmailCampaign.created_at.desc()).all()
    return render_template('admin/email_campaigns.html', form=form, campaigns=campaigns)

@app.route('/admin/campaign-status/<task_id>')
@login_required
@admin_required
def campaign_status(task_id):
    """Get status of email campaign background task"""
    try:
        from utils.background_tasks import task_manager
        status = task_manager.get_task_status(task_id)
        
        logging.info(f"Task manager status for {task_id}: {status}")
        
        # Also get campaign info from database
        campaign = EmailCampaign.query.filter_by(task_id=task_id).first()
        
        if not status:
            if campaign:
                # Return database status if task not in memory (after server restart)
                logging.info(f"Task not found in manager, using database status for campaign {campaign.id}")
                return jsonify({
                    'status': 'completed' if campaign.is_completed else 'running',
                    'progress': 100 if campaign.is_completed else 50,
                    'sent_count': campaign.sent_count or 0,
                    'failed_count': campaign.failed_count or 0,
                    'campaign_id': campaign.id,
                    'subject': campaign.subject,
                    'recipients_count': campaign.recipients_count or 0
                })
            return jsonify({'error': 'Task not found'}), 404
        
        if campaign:
            status['campaign_id'] = campaign.id
            status['subject'] = campaign.subject
            status['recipients_count'] = campaign.recipients_count
        
        return jsonify(status)
        
    except Exception as e:
        logging.error(f"Error getting campaign status: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/admin/campaign/<int:campaign_id>')
@login_required
@admin_required
def view_campaign(campaign_id):
    """API endpoint to get campaign details for viewing"""
    campaign = EmailCampaign.query.get_or_404(campaign_id)
    # Convert markdown to HTML for display
    html_content = markdown_filter(campaign.html_content)
    return jsonify({
        'id': campaign.id,
        'subject': campaign.subject,
        'html_content': html_content,
        'created_at': campaign.created_at.strftime('%Y-%m-%d %H:%M'),
        'recipients_count': campaign.recipients_count
    })

with app.app_context():
    db.create_all()

# Start collecting stats when the app starts
stats_thread = threading.Thread(target=collect_system_stats, daemon=True)
stats_thread.start()

# Start cleanup thread when app starts
cleanup_thread = threading.Thread(target=cleanup_expired_projects, daemon=True)
cleanup_thread.start()

# Add to imports at the top
from forms import NewsForm
from models import News
import markdown
from sqlalchemy import desc

# Add these routes after existing routes

@app.route('/news')
def news_list():
    page = request.args.get('page', 1, type=int)
    news = News.query.order_by(desc(News.created_at)).paginate(
        page=page, per_page=10, error_out=False
    )
    return render_template('news/list.html', news=news)

@app.route('/news/create', methods=['GET', 'POST'])
@login_required
@admin_required
def news_create():
    form = NewsForm()
    if form.validate_on_submit():
        news = News(
            title=form.title.data,
            content=form.content.data,
            author_id=current_user.id
        )
        db.session.add(news)
        db.session.commit()
        flash(_('News created successfully'))
        return redirect(url_for('news_list'))
    return render_template('news/edit.html', form=form, is_create=True)

@app.route('/news/<int:id>/edit', methods=['GET', 'POST'])
@login_required
@admin_required
def news_edit(id):
    news = News.query.get_or_404(id)
    form = NewsForm(obj=news)
    if form.validate_on_submit():
        news.title = form.title.data
        news.content = form.content.data
        db.session.commit()
        flash(_('News updated successfully'))
        return redirect(url_for('news_list'))
    return render_template('news/edit.html', form=form, news=news, is_create=False)

@app.route('/news/<int:id>/delete', methods=['POST'])
@login_required
@admin_required
def news_delete(id):
    news = News.query.get_or_404(id)
    db.session.delete(news)
    db.session.commit()
    flash(_('News deleted successfully'))
    return redirect(url_for('news_list'))

@app.route('/news/<int:id>/send-campaign', methods=['POST'])
@login_required
@admin_required
def news_send_campaign(id):
    """Send news as an email campaign to all subscribed users"""
    news = News.query.get_or_404(id)
    
    try:
        # Get all subscribed users
        subscribed_users = User.query.filter_by(subscribed_to_emails=True).all()
        if not subscribed_users:
            flash(_('No subscribed users found.'))
            return redirect(url_for('news_list'))
            
        # Create campaign record
        campaign = EmailCampaign(
            subject=news.title,
            html_content=news.content,  # Using original markdown content
            sender_id=current_user.id,
            recipients_count=len(subscribed_users),
            started_at=datetime.utcnow()
        )
        db.session.add(campaign)
        db.session.commit()
        
        # Start background email sending task
        from utils.background_tasks import task_manager
        
        # Convert markdown to HTML for email
        html_content = markdown_filter(news.content)
        
        user_ids = [user.id for user in subscribed_users]
        task_id = task_manager.add_task('email_campaign', {
            'campaign_id': campaign.id,
            'subject': news.title,
            'html_content': html_content,  # Use converted HTML content
            'user_ids': user_ids
        })
        
        # Update campaign with task ID
        campaign.task_id = task_id
        db.session.commit()
        
        flash(_('News campaign queued successfully for %(count)d users. Sending in background.', count=len(subscribed_users)))
        return redirect(url_for('news_list'))
            
    except Exception as e:
        db.session.rollback()
        logging.error(f"Error sending news campaign: {str(e)}")
        flash(_('Error sending campaign: %(error)s', error=str(e)), 'error')
        return redirect(url_for('news_list'))

#Adding new routes for preview
@app.route('/previews/<path:filename>')
def serve_preview(filename):
    return send_from_directory('previews', filename)

@app.route('/preview/<int:project_id>', methods=['POST'])
@login_required
def generate_preview(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    try:
        # Get text display settings from request
        data = request.get_json() if request.is_json else {}
        resolution = data.get('resolution', 'fullhd')

        # Get all visibility settings with explicit defaults of True
        text_settings = {
            'vertical_position': int(data.get('vertical_position', 50)),
            'horizontal_position': float(data.get('horizontal_position', 50)),
            'top_padding': int(data.get('top_padding', 10)),
            'bottom_padding': int(data.get('bottom_padding', 30)),
            'spacing': int(data.get('spacing', 20)),
            'font_size': int(data.get('font_size', 26)),
            'border_radius': int(data.get('border_radius', 13)),
            # Speed indicator settings
            'indicator_x': float(data.get('indicator_x', 50)),
            'indicator_y': float(data.get('indicator_y', 80)),
            'speed_y': int(data.get('speed_y', 0)),
            'unit_y': int(data.get('unit_y', 0)),
            'speed_size': float(data.get('speed_size', 100)),
            'unit_size': float(data.get('unit_size', 100)),
            'indicator_scale': float(data.get('indicator_scale', 100)),
            # Visibility settings - default to True unless explicitly set to False
            'show_speed': data.get('show_speed', True),
            'show_max_speed': data.get('show_max_speed', True),
            'show_voltage': data.get('show_voltage', True),
            'show_temp': data.get('show_temp', True),
            'show_battery': data.get('show_battery', True),
            'show_gps': data.get('show_gps', True),
            'show_mileage': data.get('show_mileage', True),
            'show_pwm': data.get('show_pwm', True),
            'show_power': data.get('show_power', True),
            'show_current': data.get('show_current', True),
            'show_time': data.get('show_time', False),
            'show_bottom_elements': data.get('show_bottom_elements', True),
            'use_icons': data.get('use_icons', False),
            'icon_vertical_offset': int(data.get('icon_vertical_offset', 5)),
            'icon_horizontal_spacing': int(data.get('icon_horizontal_spacing', 10)),
            'static_box_size': data.get('static_box_size', False),
            'vertical_layout': data.get('vertical_layout', False)
        }

        logging.info(f"Generating preview with settings: {text_settings}")

        # Get user's preferred locale
        user_locale = 'ru' if current_user.is_authenticated and hasattr(current_user, 'locale') and current_user.locale == 'ru' else 'en'

        preview_path = create_preview_frame(
            os.path.join(app.config['UPLOAD_FOLDER'], project.csv_file),
            project.id,
            resolution,
            text_settings,
            locale=user_locale
        )

        return jsonify({'success': True, 'preview_url': url_for('serve_preview', filename=f'{project.id}_preview.png')})

    except Exception as e:
        logging.error(f"Error generating preview: {str(e)}")
        return jsonify({'error': str(e)}), 500

# Add these routes near other route definitions

@app.route('/save_preset', methods=['POST'])
@login_required
def save_preset():
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    settings = data.get('settings', {})

    if not name:
        return jsonify({'error': _('Preset name is required.')}), 400

    try:
        preset = Preset.create_from_form_data(name, settings, current_user.id)
        db.session.add(preset)
        db.session.commit()
        return jsonify({'success': True, 'id': preset.id})
    except Exception as e:
        logging.error(f"Error saving preset: {str(e)}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/get_presets')
@login_required
def get_presets():
    try:
        presets = Preset.query.filter_by(user_id=current_user.id).all()
        presets_list = [{'id': p.id, 'name': p.name} for p in presets]
        return jsonify({'presets': presets_list})
    except Exception as e:
        logging.error(f"Error getting presets: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/get_preset/<int:preset_id>')
@login_required
def get_preset(preset_id):
    preset = Preset.query.get_or_404(preset_id)
    if preset.user_id != current_user.id:
        return jsonify({'error': _('Unauthorized')}), 403
    try:
        return jsonify({
            'settings': preset.get_settings(),
            'name': preset.name,
            'id': preset.id
        })
    except Exception as e:
        logging.error(f"Error getting preset {preset_id}: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/delete_preset/<int:preset_id>', methods=['DELETE'])
@login_required
def delete_preset(preset_id):
    preset = Preset.query.get_or_404(preset_id)
    if preset.user_id != current_user.id:
        return jsonify({'error': _('Unauthorized')}), 403
    try:
        db.session.delete(preset)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        logging.error(f"Error deleting preset {preset_id}: {str(e)}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
        
# Analytics routes
@app.route('/analytics')
@login_required
def analytics():
    """Render the analytics page"""
    return render_template('analytics.html')

@app.route('/analyze_csv', methods=['POST'])
@login_required
def analyze_csv():
    """Process a CSV file for analytics and return data for charts"""
    # Import gettext function directly instead of using _ alias
    from flask_babel import gettext
    
    if 'file' not in request.files:
        return jsonify({'error': gettext('No file provided')}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': gettext('No file selected')}), 400
    
    # Check file size - limit to 50MB to prevent memory issues
    # Read only beginning of the file to get size
    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)  # Reset file pointer to beginning
    
    # 50MB = 50 * 1024 * 1024 bytes
    if file_size > 50 * 1024 * 1024:
        return jsonify({'error': gettext('File is too large. Please upload a CSV file smaller than 50MB.')}), 400
        
    temp_dir = None
    temp_file_path = None
    
    try:
        # Create a temporary file to store the uploaded CSV
        temp_dir = tempfile.mkdtemp()
        temp_file_path = os.path.join(temp_dir, secure_filename(file.filename))
        file.save(temp_file_path)
        
        # Log file size for debugging
        file_size_mb = os.path.getsize(temp_file_path) / (1024 * 1024)
        logging.info(f"Saved CSV file for analytics, size: {file_size_mb:.2f} MB")
        
        # Read and validate CSV file
        try:
            # Try reading with different encodings
            try:
                df = pd.read_csv(temp_file_path, encoding='utf-8')
            except UnicodeDecodeError:
                try:
                    df = pd.read_csv(temp_file_path, encoding='latin1')
                except UnicodeDecodeError:
                    return jsonify({'error': gettext('Invalid file encoding. Please ensure your CSV file is properly encoded.')}), 400
            
            # Detect CSV type
            try:
                csv_type = detect_csv_type(df)
                if csv_type == 'processed':
                    csv_type = 'darnkessbot'
                logging.info(f"Detected CSV type: {csv_type}")
            except ValueError:
                return jsonify({'error': gettext('Invalid CSV format. Please upload a CSV file from DarknessBot, WheelLog, or EUC World.')}), 400
            
            # Process the CSV file to get standardized data
            csv_type, processed_data = process_csv_file(temp_file_path, interpolate_values=True)
            
            # Log the type of processed_data for debugging
            logging.info(f"Processed data type: {type(processed_data)}")
            if isinstance(processed_data, dict):
                logging.info(f"Dict keys: {list(processed_data.keys())}")
                if 'timestamp' in processed_data:
                    logging.info(f"Timestamp data type: {type(processed_data['timestamp'])}")
                    logging.info(f"Number of timestamps: {len(processed_data['timestamp'])}")
            
            # Convert processed data to a list of dictionaries for JSON serialization
            serializable_data = []
            
            # Check if processed_data is a dict or DataFrame and handle accordingly
            if isinstance(processed_data, pd.DataFrame):
                # For DataFrame format
                for _, row in processed_data.iterrows():
                    row_dict = {}
                    for col in processed_data.columns:
                        value = row[col]
                        # Handle special data types
                        if pd.isna(value):
                            row_dict[col] = None
                        else:
                            row_dict[col] = float(value) if isinstance(value, (int, float)) else str(value)
                    serializable_data.append(row_dict)
            elif isinstance(processed_data, dict):
                # For dictionary format 
                # Process structure like {'timestamp': [...], 'speed': [...], ...}
                if 'timestamp' in processed_data and isinstance(processed_data['timestamp'], (list, tuple)):
                    # Get the number of data points
                    num_points = len(processed_data['timestamp'])
                    
                    # Create a record for each data point
                    for i in range(num_points):
                        record = {}
                        for key, values in processed_data.items():
                            if i < len(values):
                                value = values[i]
                                # Handle special data types
                                if pd.isna(value):
                                    record[key] = None
                                else:
                                    record[key] = float(value) if isinstance(value, (int, float)) else str(value)
                            else:
                                record[key] = None
                        serializable_data.append(record)
                else:
                    # Handle other dictionary formats if needed
                    logging.warning("Unrecognized dictionary data format")
            
            # Calculate achievements using database-driven system
            achievements = []
            
            # Calculate analytics variables for achievement formulas
            analytics_vars = {}
            
            # Calculate max speed
            max_speed = 0
            if isinstance(processed_data, dict) and 'speed' in processed_data:
                speed_values = [float(val) for val in processed_data['speed'] if not pd.isna(val)]
                max_speed = max(speed_values, default=0)
            elif isinstance(processed_data, pd.DataFrame):
                max_speed = processed_data['speed'].max()
            analytics_vars['max_speed'] = max_speed
            
            # Calculate daily travel distance
            max_daily_distance = 0
            if isinstance(processed_data, dict) and 'timestamp' in processed_data and 'mileage' in processed_data:
                # Convert timestamps to date strings
                dates = [datetime.utcfromtimestamp(float(ts)).strftime('%Y-%m-%d') 
                      for ts in processed_data['timestamp'] if not pd.isna(ts)]
                
                # Get mileage values
                mileage_values = [float(val) for val in processed_data['mileage'] if not pd.isna(val)]
                
                # Create a DataFrame to group by date
                if len(dates) == len(mileage_values) and len(dates) > 0:
                    mileage_df = pd.DataFrame({
                        'date': dates,
                        'mileage': mileage_values
                    })
                    
                    # Calculate mileage difference by date
                    mileage_by_date = mileage_df.groupby('date').agg({
                        'mileage': lambda x: max(x) - min(x)
                    })
                    
                    # Get the maximum daily distance
                    max_daily_distance = mileage_by_date['mileage'].max()
            analytics_vars['max_daily_distance'] = max_daily_distance
            
            # Calculate power values
            max_power = 0
            min_power = 0
            if isinstance(processed_data, dict) and 'power' in processed_data:
                power_values = [float(val) for val in processed_data['power'] if not pd.isna(val)]
                if power_values:
                    max_power = max(power_values)
                    min_power = min(power_values)
            analytics_vars['max_power'] = max_power
            analytics_vars['min_power'] = min_power
            
            # Calculate average speed difference (Clown achievement)
            avg_speed_diff = 0
            if isinstance(processed_data, dict) and 'speed' in processed_data and 'gps' in processed_data:
                speed_pairs = []
                for i in range(len(processed_data['speed'])):
                    if (i < len(processed_data['gps']) and 
                        not pd.isna(processed_data['speed'][i]) and 
                        not pd.isna(processed_data['gps'][i])):
                        
                        speed = float(processed_data['speed'][i])
                        gps_speed = float(processed_data['gps'][i])
                        
                        if gps_speed > 0:
                            speed_pairs.append((speed, gps_speed))
                
                if speed_pairs:
                    differences = [abs(pair[0] - pair[1]) for pair in speed_pairs]
                    avg_speed_diff = sum(differences) / len(differences)
            analytics_vars['avg_speed_diff'] = avg_speed_diff
            
            # Calculate PWM-related achievements
            pwm_100_survived = False
            pwm_100_dead = False
            if isinstance(processed_data, dict) and 'pwm' in processed_data and 'speed' in processed_data and 'timestamp' in processed_data:
                if (len(processed_data['pwm']) > 0 and 
                    len(processed_data['speed']) > 0 and 
                    len(processed_data['timestamp']) > 0):
                    
                    # Find all instances of 100% PWM
                    max_pwm_indices = []
                    for i in range(len(processed_data['pwm'])):
                        if (not pd.isna(processed_data['pwm'][i]) and 
                            float(processed_data['pwm'][i]) >= 100):
                            max_pwm_indices.append(i)
                    
                    if max_pwm_indices:
                        last_max_pwm_index = max_pwm_indices[-1]
                        last_max_pwm_timestamp = float(processed_data['timestamp'][last_max_pwm_index])
                        
                        # Check all speed values in the 10 seconds after last 100% PWM
                        suicidal = True
                        dead = False
                        
                        for i in range(len(processed_data['timestamp'])):
                            if (not pd.isna(processed_data['timestamp'][i]) and 
                                not pd.isna(processed_data['speed'][i])):
                                
                                timestamp = float(processed_data['timestamp'][i])
                                speed = float(processed_data['speed'][i])
                                
                                if (timestamp > last_max_pwm_timestamp and 
                                    timestamp <= last_max_pwm_timestamp + 10):
                                    
                                    if speed < 5:
                                        suicidal = False
                                        
                                    if speed < 2:
                                        dead = True
                        
                        pwm_100_survived = suicidal
                        pwm_100_dead = dead
            
            analytics_vars['pwm_100_survived'] = pwm_100_survived
            analytics_vars['pwm_100_dead'] = pwm_100_dead
            
            # Calculate complex Dead achievement condition
            dead_condition_met = False
            if isinstance(processed_data, dict) and all(key in processed_data for key in ['speed', 'pwm', 'timestamp']):
                if (len(processed_data['speed']) > 0 and 
                    len(processed_data['pwm']) > 0 and 
                    len(processed_data['timestamp']) > 0):
                    
                    logging.debug("Starting Dead achievement analysis...")
                    
                    # Find periods where speed > 30 km/h for at least 3 seconds with PWM = 100
                    high_speed_periods = []
                    
                    # First pass: identify high speed periods with PWM 100
                    i = 0
                    while i < len(processed_data['timestamp']):
                        if (not pd.isna(processed_data['timestamp'][i]) and 
                            not pd.isna(processed_data['speed'][i])):
                            
                            timestamp = float(processed_data['timestamp'][i])
                            speed = float(processed_data['speed'][i])
                            
                            if speed > 30:
                                # Start of potential high speed period
                                period_start = timestamp
                                period_end = timestamp
                                has_pwm_100 = False
                                
                                # Check PWM at start
                                if (i < len(processed_data['pwm']) and 
                                    not pd.isna(processed_data['pwm'][i]) and 
                                    float(processed_data['pwm'][i]) == 100):
                                    has_pwm_100 = True
                                
                                # Continue through the high speed period
                                j = i + 1
                                while j < len(processed_data['timestamp']):
                                    if (not pd.isna(processed_data['timestamp'][j]) and 
                                        not pd.isna(processed_data['speed'][j])):
                                        
                                        next_timestamp = float(processed_data['timestamp'][j])
                                        next_speed = float(processed_data['speed'][j])
                                        
                                        if next_speed > 30:
                                            period_end = next_timestamp
                                            # Check for PWM 100 in this period
                                            if (j < len(processed_data['pwm']) and 
                                                not pd.isna(processed_data['pwm'][j]) and 
                                                float(processed_data['pwm'][j]) == 100):
                                                has_pwm_100 = True
                                                logging.debug(f"Found PWM=100 at timestamp {next_timestamp} during high speed period")
                                        else:
                                            break
                                    j += 1
                                
                                # Check if period duration >= 3 seconds and has PWM 100
                                period_duration = period_end - period_start
                                if period_duration >= 3 and has_pwm_100:
                                    high_speed_periods.append((period_start, period_end))
                                    logging.debug(f"Found high speed period: {period_start} to {period_end} (duration: {period_duration}s)")
                                
                                # Move to end of this period
                                i = j
                            else:
                                i += 1
                        else:
                            i += 1
                    
                    logging.debug(f"Found {len(high_speed_periods)} high speed periods with PWM 100")
                    
                    # Check for PWM failure after high speed periods
                    for period_start, period_end in high_speed_periods:
                        logging.debug(f"Checking PWM failure after period ending at {period_end}")
                        
                        # Look for PWM = 0 within 5 seconds after the period
                        check_until = period_end + 5
                        
                        pwm_zero_found = False
                        pwm_zero_timestamp = None
                        
                        for i in range(len(processed_data['timestamp'])):
                            if (not pd.isna(processed_data['timestamp'][i]) and 
                                not pd.isna(processed_data['pwm'][i])):
                                
                                timestamp = float(processed_data['timestamp'][i])
                                pwm = float(processed_data['pwm'][i])
                                
                                if (timestamp > period_end and 
                                    timestamp <= check_until and 
                                    pwm == 0):
                                    pwm_zero_found = True
                                    pwm_zero_timestamp = timestamp
                                    logging.debug(f"Found PWM=0 at {pwm_zero_timestamp}")
                                    break
                        
                        # If PWM = 0 found, check if it stays < 3 for 5 seconds
                        if pwm_zero_found:
                            pwm_stays_low = True
                            check_until_low = pwm_zero_timestamp + 5
                            
                            for i in range(len(processed_data['timestamp'])):
                                if (not pd.isna(processed_data['timestamp'][i]) and 
                                    not pd.isna(processed_data['pwm'][i])):
                                    
                                    timestamp = float(processed_data['timestamp'][i])
                                    pwm = float(processed_data['pwm'][i])
                                    
                                    if (timestamp > pwm_zero_timestamp and 
                                        timestamp <= check_until_low and 
                                        pwm >= 3):
                                        pwm_stays_low = False
                                        logging.debug(f"PWM went above 3 at {timestamp}, value: {pwm}")
                                        break
                            
                            if pwm_stays_low:
                                dead_condition_met = True
                                logging.debug("Dead condition MET!")
                                break
                            else:
                                logging.debug("PWM did not stay low enough")
                        else:
                            logging.debug("No PWM=0 found within 5 seconds after high speed period")
                    
                    logging.debug(f"Final dead_condition_met: {dead_condition_met}")
            
            analytics_vars['dead_condition_met'] = dead_condition_met
            
            # Get all active achievements from database and evaluate them
            active_achievements = Achievement.query.filter_by(is_active=True).all()
            
            for achievement in active_achievements:
                try:
                    # Evaluate achievement formula with analytics variables
                    if eval(achievement.formula, {"__builtins__": {}}, analytics_vars):
                        achievements.append({
                            'id': achievement.achievement_id,
                            'title': achievement.title,
                            'description': achievement.description,
                            'icon': achievement.icon
                        })
                except Exception as e:
                    logging.warning(f"Error evaluating achievement formula for {achievement.achievement_id}: {str(e)}")
                    continue
            
            # Return the processed data with achievements for visualization
            return jsonify({
                'success': True,
                'csv_type': csv_type,
                'csv_data': json.dumps(serializable_data),
                'achievements': achievements
            })
            
        except MemoryError:
            # Special handling for memory errors
            logging.error("Memory error while processing CSV file - file may be too large")
            return jsonify({'error': gettext('Memory error while processing CSV file. The file is too large or contains too much data. Try uploading a smaller file or reducing the data points.')}), 400
        except Exception as e:
            logging.error(f"Error processing CSV file: {str(e)}")
            # Check if error message suggests memory issues
            error_str = str(e).lower()
            if 'memory' in error_str or 'allocation' in error_str or 'buffer' in error_str:
                return jsonify({'error': gettext('The CSV file appears to be too large for processing. Please try a smaller file or contact support.')}), 400
            return jsonify({'error': gettext('Error processing CSV file: ') + str(e)}), 400
            
    except Exception as e:
        logging.error(f"Error in analyze_csv: {str(e)}")
        return jsonify({'error': gettext('An unexpected error occurred')}), 500
    finally:
        # Clean up temporary files
        try:
            if temp_file_path and os.path.exists(temp_file_path):
                os.remove(temp_file_path)
            if temp_dir and os.path.exists(temp_dir):
                os.rmdir(temp_dir)
        except Exception as e:
            logging.error(f"Error cleaning up temporary files: {str(e)}")
# Add markdown preview route
@app.route('/markdown-preview', methods=['POST'])
def markdown_preview():
    """Convert markdown to HTML for preview"""
    try:
        data = request.get_json()
        if not data or 'markdown' not in data:
            return jsonify({'error': 'No markdown content provided'}), 400
            
        markdown_text = data['markdown']
        html_content = markdown_filter(markdown_text)
        
        return jsonify({
            'success': True,
            'html': html_content
        })
    except Exception as e:
        logging.error(f"Error in markdown preview: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/admin/test-smtp', methods=['POST'])
@login_required
@admin_required
def test_smtp():
    """Test SMTP connection"""
    try:
        success, message = test_smtp_connection()
        if success:
            flash(f'SMTP test passed: {message}', 'success')
        else:
            flash(f'SMTP test failed: {message}', 'danger')
    except Exception as e:
        logging.error(f"Error testing SMTP: {str(e)}")
        flash(f'SMTP test error: {str(e)}', 'danger')
    
    return redirect(url_for('admin_dashboard'))

@app.route('/admin/send-test-email', methods=['GET', 'POST'])
@login_required
@admin_required
def send_test_email():
    """Send test email"""
    form = EmailTestForm()
    
    if form.validate_on_submit():
        try:
            # Test email content
            test_subject = "Test Email from EUC Telemetry"
            test_html = """
            <html>
            <body>
                <h2>Test Email</h2>
                <p>This is a test email from EUC Telemetry system.</p>
                <p>If you received this email, your SMTP server is working correctly!</p>
                <p>Time sent: """ + datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC') + """</p>
            </body>
            </html>
            """
            
            # Send test email
            success = send_email(form.test_email.data, test_subject, test_html)
            
            if success:
                flash(f'Test email sent successfully to {form.test_email.data}', 'success')
            else:
                flash(f'Failed to send test email to {form.test_email.data}', 'danger')
                
        except Exception as e:
            logging.error(f"Error sending test email: {str(e)}")
            flash(f'Error sending test email: {str(e)}', 'danger')
        
        return redirect(url_for('admin_dashboard'))
    
    return render_template('admin/send_test_email.html', form=form)


@app.route('/admin/settings', methods=['GET', 'POST'])
@login_required
@admin_required
def admin_settings():
    settings_config = [
        {'key': 'upload_expiry_hours', 'label': 'Upload project expiry (hours)', 'type': 'int', 'default': 24},
        {'key': 've_expiry_hours_user', 'label': 'Video Editor expiry — regular users (hours)', 'type': 'int', 'default': 12},
        {'key': 've_expiry_hours_admin', 'label': 'Video Editor expiry — admins (hours)', 'type': 'int', 'default': 48},
    ]
    if request.method == 'POST':
        for cfg in settings_config:
            val = request.form.get(cfg['key'], '')
            if val.strip():
                SiteSetting.set(cfg['key'], val.strip(), cfg.get('label'))
        flash('Settings saved', 'success')
        return redirect(url_for('admin_settings'))
    current_values = {}
    for cfg in settings_config:
        current_values[cfg['key']] = SiteSetting.get(cfg['key'], str(cfg['default']))
    return render_template('admin/settings.html', settings_config=settings_config, current_values=current_values)


@app.route('/admin/achievements')
@admin_required
def admin_achievements():
    """Display achievements management page"""
    # Initialize default achievements if none exist
    if Achievement.query.count() == 0:
        Achievement.initialize_defaults()
    
    achievements = Achievement.query.order_by(Achievement.achievement_id).all()
    return render_template('admin/achievements.html', achievements=achievements)


@app.route('/admin/achievements/new', methods=['GET', 'POST'])
@admin_required
def admin_achievement_new():
    """Create new achievement"""
    form = AchievementForm()
    
    if form.validate_on_submit():
        try:
            # Check if achievement_id already exists
            existing = Achievement.query.filter_by(achievement_id=form.achievement_id.data).first()
            if existing:
                flash(f'Achievement with ID "{form.achievement_id.data}" already exists', 'danger')
                return render_template('admin/achievement_form.html', form=form, title='New Achievement')
            
            achievement = Achievement(
                achievement_id=form.achievement_id.data,
                title=form.title.data,
                description=form.description.data,
                icon=form.icon.data,
                formula=form.formula.data,
                is_active=form.is_active.data
            )
            
            db.session.add(achievement)
            db.session.commit()
            
            flash(f'Achievement "{form.title.data}" created successfully', 'success')
            return redirect(url_for('admin_achievements'))
            
        except Exception as e:
            logging.error(f"Error creating achievement: {str(e)}")
            flash(f'Error creating achievement: {str(e)}', 'danger')
    
    return render_template('admin/achievement_form.html', form=form, title='New Achievement')


@app.route('/admin/achievements/<int:achievement_id>/edit', methods=['GET', 'POST'])
@admin_required
def admin_achievement_edit(achievement_id):
    """Edit existing achievement"""
    achievement = Achievement.query.get_or_404(achievement_id)
    form = AchievementForm(obj=achievement)
    
    if form.validate_on_submit():
        try:
            # Check if achievement_id already exists (except for current record)
            existing = Achievement.query.filter(
                Achievement.achievement_id == form.achievement_id.data,
                Achievement.id != achievement_id
            ).first()
            if existing:
                flash(f'Achievement with ID "{form.achievement_id.data}" already exists', 'danger')
                return render_template('admin/achievement_form.html', form=form, 
                                    title=f'Edit Achievement: {achievement.title}')
            
            achievement.achievement_id = form.achievement_id.data
            achievement.title = form.title.data
            achievement.description = form.description.data
            achievement.icon = form.icon.data
            achievement.formula = form.formula.data
            achievement.is_active = form.is_active.data
            achievement.updated_at = datetime.utcnow()
            
            db.session.commit()
            
            flash(f'Achievement "{achievement.title}" updated successfully', 'success')
            return redirect(url_for('admin_achievements'))
            
        except Exception as e:
            logging.error(f"Error updating achievement: {str(e)}")
            flash(f'Error updating achievement: {str(e)}', 'danger')
    
    return render_template('admin/achievement_form.html', form=form, 
                         title=f'Edit Achievement: {achievement.title}')


@app.route('/admin/achievements/<int:achievement_id>/delete', methods=['POST'])
@admin_required
def admin_achievement_delete(achievement_id):
    """Delete achievement"""
    try:
        achievement = Achievement.query.get_or_404(achievement_id)
        title = achievement.title
        
        db.session.delete(achievement)
        db.session.commit()
        
        flash(f'Achievement "{title}" deleted successfully', 'success')
        
    except Exception as e:
        logging.error(f"Error deleting achievement: {str(e)}")
        flash(f'Error deleting achievement: {str(e)}', 'danger')
    
    return redirect(url_for('admin_achievements'))


@app.route('/admin/achievements/reset', methods=['POST'])
@admin_required
def admin_achievements_reset():
    """Reset achievements to defaults"""
    try:
        # Delete all existing achievements
        Achievement.query.delete()
        db.session.commit()
        
        # Initialize defaults
        Achievement.initialize_defaults()
        
        flash('Achievements reset to defaults successfully', 'success')
        
    except Exception as e:
        logging.error(f"Error resetting achievements: {str(e)}")
        flash(f'Error resetting achievements: {str(e)}', 'danger')
    
    return redirect(url_for('admin_achievements'))


@app.route('/admin/achievements/refresh', methods=['POST'])
@admin_required
def admin_achievements_refresh():
    """Refresh achievements - add missing defaults without deleting existing ones"""
    try:
        # Get count before refresh
        count_before = Achievement.query.count()
        
        # Initialize defaults (this will only add missing achievements)
        Achievement.initialize_defaults()
        
        # Get count after refresh
        count_after = Achievement.query.count()
        added_count = count_after - count_before
        
        if added_count > 0:
            flash(f'Added {added_count} missing achievements. Total achievements: {count_after}', 'success')
        else:
            flash(f'All achievements are up to date. Total achievements: {count_after}', 'info')
            
    except Exception as e:
        db.session.rollback()
        logging.error(f"Error refreshing achievements: {str(e)}")
        flash(f'Error refreshing achievements: {str(e)}', 'danger')

    return redirect(url_for('admin_achievements'))


# =====================================================================
# Coauthors management (admin)
# =====================================================================

# Подкаталог в static/, куда складываются загруженные фото соавторов.
COAUTHORS_UPLOAD_SUBDIR = os.path.join('uploads', 'coauthors')


def _coauthors_upload_dir():
    """Абсолютный путь к каталогу для фото соавторов; создаёт его при необходимости."""
    abs_dir = os.path.join(app.static_folder, COAUTHORS_UPLOAD_SUBDIR)
    os.makedirs(abs_dir, exist_ok=True)
    return abs_dir


def _save_coauthor_photo(file_storage):
    """
    Сохраняет загруженный файл фото соавтора.
    Возвращает путь относительно static/ (для записи в БД и url_for('static', filename=...)).
    """
    import uuid
    original = secure_filename(file_storage.filename or '')
    ext = os.path.splitext(original)[1].lower() or '.jpg'
    # Разрешённые расширения дублируем (FileAllowed уже проверила, но на всякий случай).
    if ext not in ('.jpg', '.jpeg', '.png', '.webp', '.gif'):
        ext = '.jpg'
    fname = f"{uuid.uuid4().hex}{ext}"
    abs_path = os.path.join(_coauthors_upload_dir(), fname)
    file_storage.save(abs_path)
    # Путь для БД — относительно static/, с прямыми слэшами (для url_for).
    return f"{COAUTHORS_UPLOAD_SUBDIR.replace(os.sep, '/')}/{fname}"


def _delete_coauthor_photo(rel_path):
    """Безопасно удаляет файл фото соавтора с диска (если он внутри static/uploads/coauthors)."""
    if not rel_path:
        return
    try:
        # Приводим к абсолютному пути и проверяем, что он внутри ожидаемой папки —
        # защита от path traversal, если в БД случайно окажется чужой путь.
        abs_path = os.path.realpath(os.path.join(app.static_folder, rel_path))
        upload_dir = os.path.realpath(_coauthors_upload_dir())
        if abs_path.startswith(upload_dir + os.sep) and os.path.isfile(abs_path):
            os.remove(abs_path)
    except Exception as e:
        logging.warning(f"Could not delete coauthor photo {rel_path}: {e}")


@app.route('/admin/coauthors')
@admin_required
def admin_coauthors():
    """Список соавторов с возможностью CRUD."""
    coauthors = Coauthor.query.order_by(
        Coauthor.display_order.asc(), Coauthor.name.asc()
    ).all()
    return render_template('admin/coauthors.html', coauthors=coauthors)


@app.route('/admin/coauthors/new', methods=['GET', 'POST'])
@admin_required
def admin_coauthor_new():
    """Создать нового соавтора."""
    form = CoauthorForm()
    if form.validate_on_submit():
        try:
            coauthor = Coauthor(
                name=form.name.data.strip(),
                role=form.role.data.strip(),
                description=form.description.data.strip(),
                display_order=form.display_order.data or 0,
                is_active=bool(form.is_active.data),
            )
            # Сохраняем фото, если загружено
            file = form.photo.data
            if file and getattr(file, 'filename', ''):
                coauthor.photo = _save_coauthor_photo(file)

            db.session.add(coauthor)
            db.session.commit()
            flash(_('Coauthor "%(name)s" created successfully', name=coauthor.name), 'success')
            return redirect(url_for('admin_coauthors'))
        except Exception as e:
            db.session.rollback()
            logging.error(f"Error creating coauthor: {e}")
            flash(_('Error creating coauthor: %(err)s', err=str(e)), 'danger')

    return render_template('admin/coauthor_form.html',
                           form=form, coauthor=None,
                           title=_('New Coauthor'))


@app.route('/admin/coauthors/<int:coauthor_id>/edit', methods=['GET', 'POST'])
@admin_required
def admin_coauthor_edit(coauthor_id):
    """Редактировать соавтора."""
    coauthor = Coauthor.query.get_or_404(coauthor_id)
    form = CoauthorForm(obj=coauthor)
    if form.validate_on_submit():
        try:
            coauthor.name = form.name.data.strip()
            coauthor.role = form.role.data.strip()
            coauthor.description = form.description.data.strip()
            coauthor.display_order = form.display_order.data or 0
            coauthor.is_active = bool(form.is_active.data)

            # 1) Если запросили удалить текущее фото
            if form.remove_photo.data and coauthor.photo:
                _delete_coauthor_photo(coauthor.photo)
                coauthor.photo = None

            # 2) Если загружено новое фото — заменяем старое
            file = form.photo.data
            if file and getattr(file, 'filename', ''):
                old = coauthor.photo
                coauthor.photo = _save_coauthor_photo(file)
                if old:
                    _delete_coauthor_photo(old)

            coauthor.updated_at = datetime.utcnow()
            db.session.commit()
            flash(_('Coauthor "%(name)s" updated successfully', name=coauthor.name), 'success')
            return redirect(url_for('admin_coauthors'))
        except Exception as e:
            db.session.rollback()
            logging.error(f"Error updating coauthor: {e}")
            flash(_('Error updating coauthor: %(err)s', err=str(e)), 'danger')

    return render_template('admin/coauthor_form.html',
                           form=form, coauthor=coauthor,
                           title=_('Edit Coauthor: %(name)s', name=coauthor.name))


@app.route('/admin/coauthors/<int:coauthor_id>/delete', methods=['POST'])
@admin_required
def admin_coauthor_delete(coauthor_id):
    """Удалить соавтора (вместе с файлом фото)."""
    coauthor = Coauthor.query.get_or_404(coauthor_id)
    try:
        name = coauthor.name
        photo = coauthor.photo
        db.session.delete(coauthor)
        db.session.commit()
        # Файл удаляем только после успешного коммита.
        if photo:
            _delete_coauthor_photo(photo)
        flash(_('Coauthor "%(name)s" deleted successfully', name=name), 'success')
    except Exception as e:
        db.session.rollback()
        logging.error(f"Error deleting coauthor: {e}")
        flash(_('Error deleting coauthor: %(err)s', err=str(e)), 'danger')
    return redirect(url_for('admin_coauthors'))


@app.route('/admin/coauthors/<int:coauthor_id>/move/<direction>', methods=['POST'])
@admin_required
def admin_coauthor_move(coauthor_id, direction):
    """
    Сдвинуть соавтора вверх/вниз в списке (свопает display_order с соседом).
    Удобно для быстрой перестановки без ручного ввода числа.
    """
    if direction not in ('up', 'down'):
        abort(400)
    current = Coauthor.query.get_or_404(coauthor_id)
    try:
        if direction == 'up':
            neighbor = Coauthor.query.filter(
                (Coauthor.display_order < current.display_order) |
                ((Coauthor.display_order == current.display_order) & (Coauthor.id < current.id))
            ).order_by(Coauthor.display_order.desc(), Coauthor.id.desc()).first()
        else:
            neighbor = Coauthor.query.filter(
                (Coauthor.display_order > current.display_order) |
                ((Coauthor.display_order == current.display_order) & (Coauthor.id > current.id))
            ).order_by(Coauthor.display_order.asc(), Coauthor.id.asc()).first()

        if neighbor:
            # Если у соседа такой же display_order — просто увеличиваем/уменьшаем у текущего
            # на 1 или -1, чтобы он действительно сместился. Иначе свопаем значения.
            if neighbor.display_order == current.display_order:
                if direction == 'up':
                    current.display_order = max(0, current.display_order - 1)
                else:
                    current.display_order += 1
            else:
                current.display_order, neighbor.display_order = neighbor.display_order, current.display_order
            db.session.commit()
    except Exception as e:
        db.session.rollback()
        logging.error(f"Error reordering coauthor {coauthor_id}: {e}")
        flash(_('Error reordering: %(err)s', err=str(e)), 'danger')
    return redirect(url_for('admin_coauthors'))


@app.route('/admin/test-campaign', methods=['POST'])
@login_required
@admin_required
def test_campaign():
    """Create and send a test campaign to verify background task system"""
    try:
        # Create test campaign
        test_campaign = EmailCampaign(
            subject="Test Campaign - Background Tasks",
            html_content="<h2>Test Email</h2><p>This is a test to verify that background email processing is working correctly.</p>",
            created_at=datetime.utcnow(),
            sender_id=current_user.id
        )
        
        db.session.add(test_campaign)
        db.session.commit()
        
        # Get first 3 admin users for testing
        test_users = User.query.filter_by(is_admin=True).limit(3).all()
        
        if not test_users:
            return jsonify({'error': 'No admin users found for testing'}), 400
        
        # Start background task
        from utils.background_tasks import task_manager
        task_id = task_manager.add_task('email_campaign', {
            'campaign_id': test_campaign.id,
            'subject': test_campaign.subject,
            'html_content': test_campaign.html_content,
            'user_ids': [user.id for user in test_users]
        })
        
        # Update campaign
        test_campaign.task_id = task_id
        test_campaign.is_sent = True
        test_campaign.sent_at = datetime.utcnow()
        test_campaign.recipients_count = len(test_users)
        db.session.commit()
        
        logging.info(f"Created test campaign {test_campaign.id} with task {task_id}")
        
        return jsonify({
            'success': True,
            'campaign_id': test_campaign.id,
            'task_id': task_id,
            'recipients_count': len(test_users)
        })
        
    except Exception as e:
        logging.error(f"Error creating test campaign: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/admin/check-icons', methods=['POST'])
@login_required
@admin_required
def admin_check_icons():
    """Check achievement icons availability"""
    try:
        import os
        from pathlib import Path
        
        achievements = Achievement.query.all()
        icons_dir = Path('static/icons/euc_man_pack')
        
        missing_icons = []
        total_icons = 0
        found_icons = 0
        
        for achievement in achievements:
            total_icons += 1
            icon_path = icons_dir / achievement.icon
            if not icon_path.exists():
                missing_icons.append(achievement.icon)
            else:
                found_icons += 1
        
        if missing_icons:
            flash(f'Missing {len(missing_icons)} icons: {", ".join(missing_icons)}. Check deployment and file permissions.', 'warning')
        else:
            flash(f'All {found_icons} achievement icons found successfully!')
            
        return redirect(url_for('admin_achievements'))
        
    except Exception as e:
        flash(f'Error checking icons: {str(e)}', 'error')
        return redirect(url_for('admin_achievements'))


# ===== VIDEO EDITOR ROUTES =====

@app.route('/video-editor')
@login_required
def video_editor():
    return render_template('video_editor.html')


@app.route('/video-editor/upload-video-init', methods=['POST'])
@login_required
def video_editor_upload_video_init():
    """Initialize a chunked video upload. Returns upload_id for subsequent chunks."""
    data = request.get_json()
    if not data or not data.get('filename'):
        return jsonify({'error': 'Missing filename'}), 400

    filename = secure_filename(data['filename'])
    total_size = int(data.get('totalSize', 0))
    total_chunks = int(data.get('totalChunks', 1))

    upload_dir = os.path.join('uploads', 'video_editor', str(current_user.id))
    os.makedirs(upload_dir, exist_ok=True)

    file_hash = data.get('fileHash', '')
    ext = os.path.splitext(filename)[1] or '.mp4'

    # Check if identical file already exists (by hash + size)
    hash_index_path = os.path.join(upload_dir, '_video_hashes.json')
    if file_hash and total_size > 0:
        try:
            if os.path.exists(hash_index_path):
                with open(hash_index_path, 'r') as hf:
                    hash_index = json.load(hf)
            else:
                hash_index = {}

            hash_key = f'{file_hash}_{total_size}'
            if hash_key in hash_index:
                existing_id = hash_index[hash_key]
                # Verify file still exists on disk
                existing_file = None
                for f in os.listdir(upload_dir):
                    if f.startswith(existing_id) and f.endswith(('.mp4', '.mov', '.avi', '.mkv', '.webm')):
                        existing_file = os.path.join(upload_dir, f)
                        break
                if existing_file and os.path.exists(existing_file) and os.path.getsize(existing_file) == total_size:
                    logging.info(f'Video dedup hit: {filename} matches existing {existing_id} (hash={file_hash[:16]}...)')
                    return jsonify({'existing': True, 'video_id': existing_id, 'filename': filename})
                else:
                    # Stale entry, remove it
                    del hash_index[hash_key]
                    with open(hash_index_path, 'w') as hf:
                        json.dump(hash_index, hf)
        except Exception as e:
            logging.warning(f'Hash dedup check failed: {e}')

    # Clean up old video files to prevent disk bloat
    import shutil as _shutil
    try:
        for old_file in os.listdir(upload_dir):
            old_path = os.path.join(upload_dir, old_file)
            if old_file.endswith(('.mp4', '.mov', '.avi', '.mkv', '.webm')):
                os.remove(old_path)
                logging.info(f'Cleaned up old video: {old_path}')
            elif old_file.endswith('_chunks') and os.path.isdir(old_path):
                _shutil.rmtree(old_path, ignore_errors=True)
                logging.info(f'Cleaned up old chunks: {old_path}')
            elif old_file.endswith('_meta.json'):
                os.remove(old_path)
    except Exception as e:
        logging.warning(f'Error cleaning old uploads: {e}')

    # Clear hash index since old videos were deleted
    try:
        if os.path.exists(hash_index_path):
            os.remove(hash_index_path)
    except Exception:
        pass

    upload_id = str(int(time.time() * 1000))

    # Store upload metadata in a temp JSON file
    meta = {
        'upload_id': upload_id,
        'filename': filename,
        'ext': ext,
        'total_size': total_size,
        'total_chunks': total_chunks,
        'received_chunks': [],
        'upload_dir': upload_dir,
        'final_path': os.path.join(upload_dir, upload_id + ext),
        'chunk_dir': os.path.join(upload_dir, upload_id + '_chunks'),
        'file_hash': file_hash,
    }
    os.makedirs(meta['chunk_dir'], exist_ok=True)

    meta_path = os.path.join(upload_dir, upload_id + '_meta.json')
    with open(meta_path, 'w') as mf:
        json.dump(meta, mf)

    return jsonify({'upload_id': upload_id, 'filename': filename})


@app.route('/video-editor/upload-video-chunk', methods=['POST'])
@login_required
def video_editor_upload_video_chunk():
    """Receive a single chunk of a video upload."""
    upload_id = request.form.get('upload_id')
    chunk_index = request.form.get('chunk_index')
    if not upload_id or chunk_index is None:
        return jsonify({'error': 'Missing upload_id or chunk_index'}), 400

    chunk_index = int(chunk_index)
    chunk = request.files.get('chunk')
    if not chunk:
        return jsonify({'error': 'No chunk data'}), 400

    upload_dir = os.path.join('uploads', 'video_editor', str(current_user.id))
    meta_path = os.path.join(upload_dir, upload_id + '_meta.json')

    if not os.path.exists(meta_path):
        return jsonify({'error': 'Invalid upload_id'}), 400

    with open(meta_path, 'r') as mf:
        meta = json.load(mf)

    # Save chunk (overwrites if re-sent after a pause/abort or retry)
    chunk_path = os.path.join(meta['chunk_dir'], f'chunk_{chunk_index:06d}')
    chunk.save(chunk_path)

    # Record index once — a re-sent chunk must not create a duplicate (would break
    # the exact-match check in /upload-video-complete and yield a spurious 400).
    if chunk_index not in meta['received_chunks']:
        meta['received_chunks'].append(chunk_index)
    with open(meta_path, 'w') as mf:
        json.dump(meta, mf)

    return jsonify({'ok': True, 'chunk_index': chunk_index, 'received': len(meta['received_chunks'])})


@app.route('/video-editor/upload-video-complete', methods=['POST'])
@login_required
def video_editor_upload_video_complete():
    """Finalize chunked upload: assemble chunks into final file."""
    data = request.get_json()
    upload_id = data.get('upload_id') if data else None
    if not upload_id:
        return jsonify({'error': 'Missing upload_id'}), 400

    upload_dir = os.path.join('uploads', 'video_editor', str(current_user.id))
    meta_path = os.path.join(upload_dir, upload_id + '_meta.json')

    if not os.path.exists(meta_path):
        return jsonify({'error': 'Invalid upload_id'}), 400

    with open(meta_path, 'r') as mf:
        meta = json.load(mf)

    # Verify all chunks received (set compare — tolerant of duplicate/re-sent indices)
    received = set(meta['received_chunks'])
    expected = set(range(meta['total_chunks']))
    if received != expected:
        missing = expected - received
        return jsonify({'error': f'Missing chunks: {sorted(missing)}'}), 400

    # Assemble chunks into final file
    final_path = meta['final_path']
    with open(final_path, 'wb') as out:
        for i in range(meta['total_chunks']):
            chunk_path = os.path.join(meta['chunk_dir'], f'chunk_{i:06d}')
            with open(chunk_path, 'rb') as cf:
                while True:
                    buf = cf.read(1024 * 1024)  # 1MB buffer
                    if not buf:
                        break
                    out.write(buf)

    # Cleanup chunks
    import shutil
    shutil.rmtree(meta['chunk_dir'], ignore_errors=True)
    try:
        os.remove(meta_path)
    except OSError:
        pass

    file_size = os.path.getsize(final_path)
    logging.info(f'Video upload complete: {meta["filename"]} ({file_size} bytes) -> {final_path}')

    # Save file hash to index for future dedup
    file_hash = meta.get('file_hash', '')
    if file_hash and file_size > 0:
        try:
            hash_index_path = os.path.join(upload_dir, '_video_hashes.json')
            if os.path.exists(hash_index_path):
                with open(hash_index_path, 'r') as hf:
                    hash_index = json.load(hf)
            else:
                hash_index = {}
            hash_key = f'{file_hash}_{file_size}'
            hash_index[hash_key] = upload_id
            with open(hash_index_path, 'w') as hf:
                json.dump(hash_index, hf)
            logging.info(f'Saved video hash: {hash_key[:32]}... -> {upload_id}')
        except Exception as e:
            logging.warning(f'Failed to save video hash: {e}')

    return jsonify({
        'video_id': upload_id,
        'filename': meta['filename'],
        'path': final_path,
        'size': file_size
    })


@app.route('/video-editor/upload-csv', methods=['POST'])
@login_required
def video_editor_upload_csv():
    if 'csv' not in request.files:
        return jsonify({'error': 'No CSV file'}), 400
    f = request.files['csv']
    if not f.filename:
        return jsonify({'error': 'Empty filename'}), 400
    
    filename = secure_filename(f.filename)
    upload_dir = os.path.join('uploads', 'video_editor', str(current_user.id))
    os.makedirs(upload_dir, exist_ok=True)
    
    csv_id = str(int(time.time() * 1000))
    save_path = os.path.join(upload_dir, csv_id + '.csv')
    f.save(save_path)
    
    return jsonify({'csv_id': csv_id, 'filename': filename, 'path': save_path})


@app.route('/video-editor/upload-vbo', methods=['POST'])
@login_required
def video_editor_upload_vbo():
    if 'vbo' not in request.files:
        return jsonify({'error': 'No VBO file'}), 400
    f = request.files['vbo']
    if not f.filename or not f.filename.lower().endswith('.vbo'):
        return jsonify({'error': 'Invalid file type'}), 400
    filename = secure_filename(f.filename)
    upload_dir = os.path.join('uploads', 'video_editor', str(current_user.id))
    os.makedirs(upload_dir, exist_ok=True)
    vbo_id = str(int(time.time() * 1000))
    save_path = os.path.join(upload_dir, vbo_id + '.vbo')
    f.save(save_path)
    return jsonify({'vbo_id': vbo_id, 'filename': filename, 'path': save_path})


@app.route('/video-editor/merge-audio', methods=['POST'])
@login_required
def video_editor_merge_audio():
    """Merge audio from original uploaded video into a client-rendered video-only MP4."""
    import subprocess, tempfile, os

    if 'video_file' not in request.files:
        return 'No video file', 400
    original_video_id = request.form.get('original_video_id')
    if not original_video_id:
        return 'No original_video_id', 400

    # Find original video file
    upload_dir = os.path.join(app.root_path, 'uploads')
    original_path = None
    for fname in os.listdir(upload_dir):
        if fname.startswith(str(original_video_id)):
            original_path = os.path.join(upload_dir, fname)
            break

    if not original_path or not os.path.exists(original_path):
        return 'Original video not found', 404

    # Save client-rendered video to temp file
    client_video = request.files['video_file']
    with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp_in:
        client_video.save(tmp_in)
        tmp_in_path = tmp_in.name

    # Output temp file
    tmp_out_path = tmp_in_path.replace('.mp4', '_merged.mp4')

    try:
        # FFmpeg: take video from client MP4, audio from original, copy both
        cmd = [
            'ffmpeg', '-y',
            '-i', tmp_in_path,       # client-rendered video (no audio)
            '-i', original_path,      # original video (has audio)
            '-map', '0:v:0',          # video from first input
            '-map', '1:a:0?',         # audio from second input (optional)
            '-c:v', 'copy',           # no re-encoding video
            '-c:a', 'aac',            # re-encode audio to AAC
            '-b:a', '192k',
            '-shortest',              # match shorter duration
            '-movflags', '+faststart',
            tmp_out_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        if result.returncode != 0:
            app.logger.error(f'merge-audio ffmpeg error: {result.stderr[:500]}')
            # Fallback: return video-only
            return send_file(tmp_in_path, mimetype='video/mp4', as_attachment=False)

        return send_file(tmp_out_path, mimetype='video/mp4', as_attachment=False)

    except Exception as e:
        app.logger.error(f'merge-audio error: {e}')
        # Fallback: return video-only
        return send_file(tmp_in_path, mimetype='video/mp4', as_attachment=False)

    finally:
        # Cleanup temp files (delayed to allow send_file to complete)
        import threading
        def cleanup():
            import time
            time.sleep(30)
            for p in [tmp_in_path, tmp_out_path]:
                try:
                    os.unlink(p)
                except:
                    pass
        threading.Thread(target=cleanup, daemon=True).start()


@app.route('/video-editor/export', methods=['POST'])
@login_required
def video_editor_export():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data'}), 400
    
    video_id = data.get('video_id')
    csv_id = data.get('csv_id')
    no_video_mode = data.get('no_video_mode', False)
    
    if not csv_id:
        return jsonify({'error': 'Missing csv_id'}), 400
    if not video_id and not no_video_mode:
        return jsonify({'error': 'Missing video_id'}), 400
    
    # Find video file (optional in no_video_mode)
    upload_dir = os.path.join('uploads', 'video_editor', str(current_user.id))
    video_file = None
    if video_id:
        for fname in os.listdir(upload_dir):
            if fname.startswith(video_id) and not fname.endswith(('.json', '_chunks')):
                fpath = os.path.join(upload_dir, fname)
                if os.path.isfile(fpath):
                    video_file = fpath
                    break
        if not video_file or not os.path.exists(video_file):
            return jsonify({'error': 'Video file not found'}), 404
    
    csv_file = os.path.join(upload_dir, csv_id + '.csv')
    if not os.path.exists(csv_file):
        return jsonify({'error': 'CSV file not found'}), 404
    
    # Create a project record
    from models import Project
    from datetime import datetime, timedelta
    project_name = data.get('project_name', 'Video Editor Export')
    project = Project(
        name=project_name,
        user_id=current_user.id,
        csv_file=csv_file,
        csv_type='video_editor',
        status='processing',
        progress=0,
        folder_number=Project.query.count() + 1,
        expiry_date=datetime.now() + timedelta(hours=SiteSetting.get_int("ve_expiry_hours_admin", 48) if current_user.is_admin else SiteSetting.get_int("ve_expiry_hours_user", 12)),
    )
    db.session.add(project)
    db.session.commit()
    
    # Start background processing
    export_settings = {
        'video_file': video_file,
        'csv_file': csv_file,
        'no_video_mode': no_video_mode,
        'chroma_color': data.get('chroma_color', '#0000FF'),
        'time_offset': data.get('time_offset', 0),
        'csv_trim_start': data.get('csv_trim_start', 0),
        'csv_trim_end': data.get('csv_trim_end', 0),
        'text_settings': data.get('settings', {}),
        'fps': data.get('fps', 'source'),
        'data_fps': data.get('data_fps', '14.985'),
        'codec': data.get('codec', 'h264'),
        'resolution': data.get('resolution', 'source'),
        'quality': data.get('quality', 'medium'),
        'vbo_id': data.get('vbo_id', None),
        'vbo_time_offset': data.get('vbo_time_offset', 0),
        'vbo_trim_start': data.get('vbo_trim_start', 0),
        'vbo_trim_end': data.get('vbo_trim_end', 0),
        'track_gate_lat': data.get('track_gate_lat', None),
        'track_gate_lon': data.get('track_gate_lon', None),
    }
    
    thread = threading.Thread(
        target=process_video_editor_export,
        args=(project.id, export_settings),
        daemon=True
    )
    thread.start()

    return jsonify({'project_id': project.id})


@app.route('/video-editor/track-local-export', methods=['POST'])
@login_required
def video_editor_track_local_export():
    """Beacon от браузера по завершении Local Export (WebCodecs).

    Local Export целиком в браузере и иначе не оставляет следов на сервере — этот
    маршрут пишет несгораемое UsageEvent(mode='editor_local'). Всегда отвечает 204
    и глотает любые ошибки, чтобы сбой статистики не влиял на пользователя.
    """
    try:
        data = request.get_json(silent=True) or {}

        def _f(v):
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        def _i(v):
            try:
                return int(v)
            except (TypeError, ValueError):
                return None

        def _clip(v, n):
            if v is None:
                return None
            try:
                return str(v)[:n]
            except Exception:
                return None

        UsageEvent.log(
            user_id=current_user.id,
            mode='editor_local',
            csv_source=_clip(data.get('csv_source'), 20),
            resolution=_clip(data.get('resolution'), 20),
            codec=_clip(data.get('codec'), 10),
            quality=None,
            duration_sec=_f(data.get('duration_sec')),
            frame_count=_i(data.get('frame_count')),
            has_track_map=bool(data.get('has_track_map')),
            has_laps=bool(data.get('has_laps')),
            success=bool(data.get('success', True)),
        )
    except Exception:
        pass
    return ('', 204)


@app.route('/video-editor/error-report', methods=['POST'])
@login_required
def video_editor_error_report():
    """Приём отчёта об ошибке от браузера (в основном — сбои Local Export).

    Сохраняет максимум диагностики в ErrorReport для просмотра админом. Всегда
    отвечает 200 и глотает ошибки, чтобы не плодить вторичные сбои у пользователя."""
    import json as _json
    try:
        data = request.get_json(silent=True) or {}

        def _clip(v, n):
            if v is None:
                return None
            try:
                s = v if isinstance(v, str) else _json.dumps(v, ensure_ascii=False, default=str)
            except Exception:
                s = str(v)
            return s[:n]

        ctx = data.get('context')
        if ctx is not None and not isinstance(ctx, str):
            try:
                ctx = _json.dumps(ctx, ensure_ascii=False, default=str)
            except Exception:
                ctx = str(ctx)

        rep = ErrorReport(
            user_id=current_user.id if current_user.is_authenticated else None,
            source=_clip(data.get('source', 'local_export'), 40),
            error_message=_clip(data.get('error_message'), 4000),
            error_stack=_clip(data.get('error_stack'), 8000),
            context=_clip(ctx, 60000),
            user_agent=_clip(request.headers.get('User-Agent'), 1000),
            url=_clip(data.get('url'), 500),
            user_note=_clip(data.get('user_note'), 2000),
        )
        db.session.add(rep)
        db.session.commit()
        return jsonify({'success': True, 'id': rep.id})
    except Exception as e:
        try:
            db.session.rollback()
        except Exception:
            pass
        logging.error(f"error-report save failed: {e}")
        # 200, чтобы клиент не показал юзеру вторую ошибку поверх первой
        return jsonify({'success': False})


def parse_vbo_file(filepath):
    """Parse VBO (Dragy) file and return list of {t, speed} dicts."""
    data = []
    columns = []
    in_data = False
    in_header = False
    in_column_names = False
    velocity_is_kmh = False
    first_time = None

    with open(filepath, 'r', errors='ignore') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            if line == '[header]':
                in_header = True
                in_column_names = False
                continue
            if in_header and not line.startswith('['):
                if 'velocity kmh' in line.lower() or 'velocity km' in line.lower():
                    velocity_is_kmh = True
                continue
            if line.startswith('[') and in_header:
                in_header = False

            if line.lower() in ('[column names]', '[columns]'):
                in_column_names = True
                in_data = False
                continue

            # Only parse column names right after [column names] section
            if in_column_names and not line.startswith('['):
                parts = line.split()
                if parts:
                    columns = [c.lower() for c in parts]
                    in_column_names = False
                continue

            if line == '[data]':
                in_data = True
                in_column_names = False
                continue
            if line.startswith('[') and line.endswith(']'):
                in_column_names = False
                if in_data:
                    break
                in_data = False
                continue

            if not in_data or not columns:
                continue

            parts = line.split()
            if len(parts) < len(columns):
                continue

            row = {columns[j]: parts[j] for j in range(len(columns))}

            # Parse time (HHMMSS.SS format)
            time_str = row.get('time', row.get('utc', ''))
            time_sec = 0.0
            if len(time_str) >= 6:
                try:
                    hh = int(time_str[:2])
                    mm = int(time_str[2:4])
                    ss = float(time_str[4:])
                    time_sec = hh * 3600 + mm * 60 + ss
                except (ValueError, IndexError):
                    continue

            # Parse velocity (handle European comma decimal separator)
            vel_str = row.get('velocity', row.get('speed', '0'))
            raw_vel = float(str(vel_str).replace(',', '.'))
            speed_kmh = raw_vel if velocity_is_kmh else raw_vel * 1.852

            if first_time is None:
                first_time = time_sec

            data.append({'t': time_sec - first_time, 'speed': speed_kmh})

    return data


def get_vbo_speed_at_time(vbo_data, video_time, csv_time_offset, vbo_time_offset, vbo_trim_start, vbo_trim_end):
    """Get interpolated Dragy speed at given video time."""
    if not vbo_data:
        return 0
    # Frontend: getDragySpeedAtTime(dp.t) where dp.t = videoTime - timeOffset
    #   vboT = dp.t - vboTimeOffset + timeOffset = videoTime - vboTimeOffset
    # So the correct formula is: vbo_t = video_time - vbo_time_offset
    vbo_t = video_time - vbo_time_offset
    if vbo_trim_end > 0 and (vbo_t < vbo_trim_start or vbo_t > vbo_trim_end):
        return 0

    # Binary search
    lo, hi = 0, len(vbo_data) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if vbo_data[mid]['t'] < vbo_t:
            lo = mid + 1
        else:
            hi = mid

    if lo == 0:
        return vbo_data[0]['speed']
    if lo >= len(vbo_data):
        return vbo_data[-1]['speed']

    a, b = vbo_data[lo - 1], vbo_data[lo]
    if b['t'] == a['t']:
        return a['speed']
    frac = (vbo_t - a['t']) / (b['t'] - a['t'])
    return a['speed'] + (b['speed'] - a['speed']) * frac


def process_video_editor_export(project_id, export_settings):
    """Background task: generate transparent overlay frames and composite onto source video."""
    from app import app as flask_app

    with flask_app.app_context():
        try:
            from models import Project
            from utils.csv_processor import process_csv_file
            from utils.image_generator import create_frame, find_nearest_values, calculate_max_widths_for_static_boxes
            from utils.video_creator import create_composite_video, create_video_from_frames
            import pandas as pd
            import numpy as np

            project = db.session.get(Project, project_id)
            if not project:
                return

            project.status = 'processing'
            project.processing_started_at = datetime.now()
            project.progress = 5
            db.session.commit()

            video_file = export_settings['video_file']
            csv_file = export_settings['csv_file']
            time_offset = float(export_settings.get('time_offset', 0))
            csv_trim_start = float(export_settings.get('csv_trim_start', 0))
            csv_trim_end = float(export_settings.get('csv_trim_end', 0))
            vbo_id = export_settings.get('vbo_id', None)
            vbo_time_offset = float(export_settings.get('vbo_time_offset', 0))
            vbo_trim_start = float(export_settings.get('vbo_trim_start', 0))
            vbo_trim_end = float(export_settings.get('vbo_trim_end', 0))
            track_gate_lat = export_settings.get('track_gate_lat', None)
            track_gate_lon = export_settings.get('track_gate_lon', None)
            track_overlay = None   # precomputed minimap + lap data (server-side parity with editor)
            text_settings = export_settings.get('text_settings', {})
            fps_setting = export_settings.get('fps', 'source')
            fps = None if fps_setting == 'source' else float(fps_setting)
            data_fps_setting = export_settings.get("data_fps", "14.985")
            data_fps = None if data_fps_setting == "source" else float(data_fps_setting)
            codec = export_settings.get('codec', 'h264')
            resolution_mode = export_settings.get('resolution', 'source')

            no_video_mode = export_settings.get('no_video_mode', False)
            chroma_color = export_settings.get('chroma_color', '#0000FF')

            logging.info(f'Video editor export settings: fps={fps}, codec={codec}, resolution={resolution_mode}, no_video={no_video_mode}')
            logging.info(f'Video editor text_settings: {text_settings}')
            logging.info(f'Video editor time_offset={time_offset}, trim_start={csv_trim_start}, trim_end={csv_trim_end}')

            import subprocess as sp

            if no_video_mode:
                # No source video — use defaults
                if resolution_mode == '4k':
                    src_width, src_height = 3840, 2160
                else:
                    src_width, src_height = 1920, 1080
                src_duration = 0  # will be determined from CSV
                if fps is None:
                    fps = 30.0
                logging.info(f'Video editor NO VIDEO mode: {src_width}x{src_height}, fps={fps}, chroma={chroma_color}')
                out_width, out_height = src_width, src_height
            else:
                # Step 1: Get source video info via ffprobe
                probe_cmd = [
                    '/opt/homebrew/bin/ffprobe', '-v', 'quiet', '-print_format', 'json',
                    '-show_streams', '-show_format', video_file
                ]
                probe_result = sp.run(probe_cmd, capture_output=True, text=True)
                probe_data = json.loads(probe_result.stdout)

                video_stream = None
                for s in probe_data.get('streams', []):
                    if s.get('codec_type') == 'video':
                        video_stream = s
                        break

                if not video_stream:
                    raise ValueError('No video stream found in source file')

                src_width = int(video_stream['width'])
                src_height = int(video_stream['height'])
                src_duration = float(probe_data.get('format', {}).get('duration', 0))

                # Detect actual source FPS for logging
                r_frame_rate = video_stream.get('r_frame_rate', '30/1')
                if '/' in str(r_frame_rate):
                    num, den = r_frame_rate.split('/')
                    src_fps = float(num) / float(den)
                else:
                    src_fps = float(r_frame_rate)
                if fps is None:
                    fps = src_fps

                logging.info(f'Video editor export: source={src_width}x{src_height} @ {src_fps:.2f}fps, {src_duration:.1f}s | output overlay fps={fps}')

                # Video Editor: render overlay matching source aspect ratio, max dimension 3840px
                src_aspect = src_width / src_height
                if src_width >= src_height:
                    out_width = 3840
                    out_height = int(3840 / src_aspect)
                else:
                    out_height = 3840
                    out_width = int(3840 * src_aspect)
                # FFmpeg requires even dimensions
                out_width = out_width + (out_width % 2)
                out_height = out_height + (out_height % 2)
            resolution = 'custom'
            if no_video_mode:
                logging.info(f'Video editor NO VIDEO: output {out_width}x{out_height}, chroma={chroma_color}')
            else:
                src_aspect_log = src_width / src_height
                logging.info(f'Video editor: overlay {out_width}x{out_height} (aspect={src_aspect_log:.3f}), source is {src_width}x{src_height}')

            project.progress = 10
            db.session.commit()

            # Step 2: Parse CSV
            logging.info(f'Video editor export: parsing CSV {csv_file}')
            csv_type, processed_data = process_csv_file(csv_file, project.folder_number)
            df = pd.DataFrame(processed_data)
            df = df.sort_values('timestamp')

            T_min = df['timestamp'].min()
            T_max = df['timestamp'].max()
            csv_duration = T_max - T_min

            # Step 2b: Parse VBO file if present
            vbo_data = None
            if vbo_id:
                user_id = None
                with db.session.no_autoflush:
                    proj = db.session.get(Project, project_id)
                    if proj:
                        user_id = proj.user_id
                if user_id:
                    vbo_path = os.path.join('uploads', 'video_editor', str(user_id), vbo_id + '.vbo')
                    if os.path.exists(vbo_path):
                        vbo_data = parse_vbo_file(vbo_path)
                        logging.info(f'VBO data loaded: {len(vbo_data)} points')
                        if vbo_data:
                            logging.info(f'VBO time range: {vbo_data[0]["t"]:.2f} - {vbo_data[-1]["t"]:.2f} sec')
                            logging.info(f'VBO speed range: {min(d["speed"] for d in vbo_data):.1f} - {max(d["speed"] for d in vbo_data):.1f} km/h')
                            logging.info(f'VBO params: vbo_time_offset={vbo_time_offset}, vbo_trim_start={vbo_trim_start}, vbo_trim_end={vbo_trim_end}')
                            logging.info(f'CSV time_offset={time_offset}, show_dragy_speed={text_settings.get("show_dragy_speed", False)}')
                        # Precompute the track minimap + lap board (same algorithm as the editor)
                        if text_settings.get('show_track_map') or text_settings.get('show_lap_table'):
                            try:
                                from utils.track_overlay import prepare_track_overlay
                                track_overlay = prepare_track_overlay(vbo_path, track_gate_lat, track_gate_lon, text_settings)
                                logging.info(f'Track overlay prepared: {"yes" if track_overlay else "none"}')
                            except Exception as _te:
                                logging.warning(f'Track overlay prepare failed: {_te}')
                                track_overlay = None
                    else:
                        logging.warning(f'VBO file not found: {vbo_path}')

            # Resolve data_fps: default to 14.985 if not specified
            if data_fps is None:
                data_fps = 14.985
                logging.info(f"Video editor export: using default data_fps = {data_fps}")
            data_fps = min(data_fps, fps)  # data_fps cannot exceed video fps

            # Apply trim
            trim_T_min = T_min + csv_trim_start
            trim_T_max = T_min + csv_trim_end if csv_trim_end > 0 else T_max

            project.progress = 15
            db.session.commit()

            # Step 3: Generate overlay frames
            overlay_dir = os.path.join('frames', f'project_{project.folder_number}_overlay')
            if os.path.exists(overlay_dir):
                import shutil
                shutil.rmtree(overlay_dir)
            os.makedirs(overlay_dir, exist_ok=True)

            # In no_video_mode, duration comes from trimmed CSV, not source video
            if no_video_mode:
                trimmed_csv_duration = (trim_T_max - trim_T_min)
                src_duration = trimmed_csv_duration
                logging.info(f'No-video mode: using CSV duration={src_duration:.2f}s')
            total_frames = max(1, int(src_duration * fps))
            # Calculate frame interval for data_fps optimization
            frame_interval = max(1, round(fps / data_fps)) if data_fps < fps else 1
            unique_frames = total_frames // frame_interval + (1 if total_frames % frame_interval else 0)
            logging.info(f'Video editor export: generating {total_frames} overlay frames at {fps} fps (data_fps={data_fps}, interval={frame_interval}, unique={unique_frames})')

            static_box_widths = None
            if text_settings.get('static_box_size', False):
                use_icons = text_settings.get('use_icons', False)
                static_box_widths = calculate_max_widths_for_static_boxes(df, text_settings, use_icons, 'en', resolution, custom_width=out_width, custom_height=out_height)

            from PIL import Image
            import shutil as _shutil

            last_frame_path = None
            logging.info(f'Frame gen: T_min={T_min}, T_max={T_max}, time_offset={time_offset}, trim_T_min={trim_T_min}, trim_T_max={trim_T_max}')
            for i in range(total_frames):
                output_path = os.path.join(overlay_dir, f'frame_{i:06d}.png')
                video_time = i / fps
                csv_time_abs = T_min + (video_time - time_offset)

                # Only generate a new frame at data_fps intervals
                if i % frame_interval == 0 or last_frame_path is None:
                    if csv_time_abs < trim_T_min or csv_time_abs > trim_T_max:
                        empty = Image.new('RGBA', (out_width, out_height), (0, 0, 0, 0))
                        empty.save(output_path, format='PNG')
                        if i < 5:
                            logging.info(f'Frame {i}: video_time={video_time:.3f}, csv_time_abs={csv_time_abs:.3f}, OUT OF TRIM RANGE')
                    else:
                        values = find_nearest_values(df, csv_time_abs, interpolate=True)
                        if i < 10 or (i % 300 == 0):
                            logging.info(f'Frame {i}: video_time={video_time:.3f}, csv_time_abs={csv_time_abs:.3f}, csv_rel={csv_time_abs-T_min:.3f}, speed={values.get("speed",0)}, pwm={values.get("pwm",0)}')
                        # Add Dragy speed from VBO data if available
                        if vbo_data and text_settings.get('show_dragy_speed', False):
                            dragy_speed = get_vbo_speed_at_time(
                                vbo_data, video_time, time_offset,
                                vbo_time_offset, vbo_trim_start, vbo_trim_end
                            )
                            values['dragy_speed'] = dragy_speed
                            if i < 5 or (i % 100 == 0):
                                vbo_t_dbg = video_time - vbo_time_offset
                                logging.info(f'Frame {i}: video_time={video_time:.3f}, vbo_t={vbo_t_dbg:.3f}, dragy_speed={dragy_speed:.1f}')
                        bg_mode = chroma_color if no_video_mode else 'transparent'
                        create_frame(
                            values,
                            resolution=resolution,
                            output_path=output_path,
                            text_settings=text_settings,
                            locale='en',
                            static_box_widths=static_box_widths,
                            background_mode=bg_mode,
                            custom_width=out_width,
                            custom_height=out_height
                        )
                        # Overlay the VBO track minimap + lap board onto this frame
                        if track_overlay is not None:
                            try:
                                from utils.track_overlay import draw_track_overlay
                                _timg = Image.open(output_path).convert('RGBA')
                                draw_track_overlay(_timg, out_width, out_height, text_settings, track_overlay,
                                                   video_time, vbo_time_offset, vbo_trim_start, vbo_trim_end)
                                _timg.save(output_path, format='PNG')
                            except Exception as _de:
                                if i < 3:
                                    logging.warning(f'Track overlay draw failed at frame {i}: {_de}')
                    last_frame_path = output_path
                else:
                    # Duplicate previous frame (fast copy instead of rendering)
                    _shutil.copy2(last_frame_path, output_path)

                if i % 20 == 0 or i == total_frames - 1:
                    progress = 15 + (i / max(total_frames, 1)) * 50
                    project.progress = progress
                    db.session.commit()

            project.progress = 65
            db.session.commit()

            # Step 4: Create video with FFmpeg
            quality = export_settings.get('quality', 'medium')
            bitrate_map = {'low': '4M', 'medium': '8M', 'high': '16M', 'superhigh': '50M'}
            bitrate = bitrate_map.get(quality, '8M')
            logging.info(f'Video editor export: creating video (quality={quality}, bitrate={bitrate})')
            output_file = os.path.join('videos', f'project_{project.folder_number}.mp4')
            os.makedirs('videos', exist_ok=True)

            def update_video_progress(current, total, stage):
                progress = 65 + (current / max(total, 1)) * 30
                project.progress = min(progress, 95)
                db.session.commit()

            if no_video_mode:
                # No source video — assemble frames directly into video
                create_video_from_frames(
                    frames_dir=overlay_dir,
                    output_file=output_file,
                    fps=fps,
                    codec=codec,
                    width=out_width,
                    height=out_height,
                    progress_callback=update_video_progress,
                    bitrate=bitrate
                )
            else:
                # Composite overlay onto source video
                create_composite_video(
                    source_video=video_file,
                    overlay_frames_dir=overlay_dir,
                    output_file=output_file,
                    fps=fps,
                    codec=codec,
                    progress_callback=update_video_progress,
                    source_width=src_width,
                    source_height=src_height,
                    bitrate=bitrate
                )

            # Step 5: Complete
            # Save actual output resolution (source video size), not overlay resolution
            if src_height >= 2160:
                project.resolution = '4k'
            elif src_height >= 1080:
                project.resolution = 'fullhd'
            else:
                project.resolution = f'{src_width}x{src_height}'
            project.codec = codec
            project.fps = float(round(fps, 2))
            project.video_file = os.path.basename(output_file)
            project.status = 'completed'
            project.progress = 100
            project.frame_count = total_frames
            project.video_duration = float(src_duration)
            project.processing_completed_at = datetime.now()
            db.session.commit()

            logging.info(f'Video editor export completed for project {project_id}')

            # Несгораемое событие статистики (серверный экспорт редактора)
            _ts = export_settings.get('text_settings', {}) or {}
            UsageEvent.log(
                user_id=project.user_id,
                mode='editor_server',
                csv_source=None,  # тип CSV в редакторе парсится на клиенте, серверу неизвестен
                resolution=project.resolution,
                codec=project.codec,
                quality=export_settings.get('quality'),
                duration_sec=float(src_duration) if src_duration else None,
                frame_count=total_frames,
                has_track_map=bool(_ts.get('show_track_map')),
                has_laps=bool(_ts.get('show_lap_table')),
                success=True,
            )

            # Cleanup overlay frames
            import shutil
            shutil.rmtree(overlay_dir, ignore_errors=True)

        except Exception as e:
            import traceback
            logging.error(f'Video editor export error for project {project_id}: {e}')
            logging.error(traceback.format_exc())
            try:
                project = db.session.get(Project, project_id)
                if project:
                    project.status = 'error'
                    project.error_message = str(e)
                    db.session.commit()
                    # Подчищаем overlay-кадры упавшего экспорта сразу (могут быть гигабайты),
                    # не дожидаясь истечения проекта — раньше они оставались навсегда.
                    _od = os.path.join('frames', f'project_{project.folder_number}_overlay')
                    if os.path.exists(_od):
                        shutil.rmtree(_od, ignore_errors=True)
                        logging.info(f'Cleaned overlay frames after failed export: {_od}')
            except Exception as e2:
                logging.error(f'Error updating project status: {e2}')
