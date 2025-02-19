import os
import logging
import random
import re
import shutil
import threading
import time
from datetime import datetime, timedelta
from collections import defaultdict
from functools import wraps

import psutil
from dotenv import load_dotenv
from flask import (Flask, render_template, request, jsonify, send_file, 
                  url_for, send_from_directory, flash, redirect, abort)
from flask_migrate import Migrate
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.utils import secure_filename
from flask_babel import Babel, gettext as _, get_locale
from extensions import db
from utils.csv_processor import process_csv_file
from utils.image_generator import generate_frames, create_preview_frame
from utils.video_creator import create_video
from utils.background_processor import process_project
from utils.env_setup import setup_env_variables
from utils.email_sender import send_email
from forms import (LoginForm, RegistrationForm, ProfileForm, 
                  ChangePasswordForm, ForgotPasswordForm, ResetPasswordForm, DeleteAccountForm,
                  EmailCampaignForm)
from models import User, Project, EmailCampaign

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables from .env file immediately
logger.info("Loading environment variables from .env file...")
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', os.urandom(32))
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL')
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_recycle': 300,
    'pool_pre_ping': True,
}
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['WTF_CSRF_ENABLED'] = True
app.config['BABEL_DEFAULT_LOCALE'] = 'en'

# Initialize Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Please log in to access this page.'

@login_manager.user_loader
def load_user(id):
    return User.query.get(int(id))

# Admin required decorator
def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            abort(403)
        return f(*args, **kwargs)
    return decorated_function

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
    # Default to English
    return 'en'

# Configure Babel with locale selector
babel.init_app(app, locale_selector=get_locale)

# Make get_locale available in templates
app.jinja_env.globals['get_locale'] = get_locale

@app.route('/home')
def home():
    return redirect(url_for('index'))

@app.route('/')
def index():
    if not current_user.is_authenticated:
        return redirect(url_for('login'))
    return render_template('index.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user is None or not user.check_password(form.password.data):
            flash(_('Invalid email or password'))
            return redirect(url_for('login'))
        if not user.is_email_confirmed:
            flash(_('Please confirm your email address before logging in.'))
            return redirect(url_for('login'))
        login_user(user)
        return redirect(url_for('index'))
    return render_template('login.html', form=form)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/admin/email-campaigns', methods=['GET', 'POST'])
@login_required
@admin_required
def email_campaigns():
    form = EmailCampaignForm()
    if form.validate_on_submit():
        try:
            # Create new campaign
            campaign = EmailCampaign(
                subject=form.subject.data,
                html_content=form.html_content.data,
                sender_id=current_user.id
            )

            # Get all confirmed users
            confirmed_users = User.query.filter_by(is_email_confirmed=True).all()
            recipients_count = 0

            # Send emails
            for user in confirmed_users:
                if send_email(user.email, campaign.subject, campaign.html_content):
                    recipients_count += 1
                    logging.info(f"Email sent to {user.email}")
                else:
                    logging.error(f"Failed to send email to {user.email}")

            campaign.recipients_count = recipients_count
            db.session.add(campaign)
            db.session.commit()

            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return jsonify({'success': True})

            flash(_('Campaign sent successfully to {} recipients').format(recipients_count))
            return redirect(url_for('email_campaigns'))

        except Exception as e:
            logging.error(f"Error sending campaign: {str(e)}")
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return jsonify({'success': False, 'error': str(e)})
            flash(_('Error sending campaign: {}').format(str(e)))

    campaigns = EmailCampaign.query.order_by(EmailCampaign.created_at.desc()).all()
    return render_template('admin/email_campaigns.html', form=form, campaigns=campaigns)

@app.route('/admin/campaign/<int:campaign_id>')
@login_required
@admin_required
def get_campaign(campaign_id):
    campaign = EmailCampaign.query.get_or_404(campaign_id)
    return jsonify({
        'subject': campaign.subject,
        'html_content': campaign.html_content,
        'created_at': campaign.created_at.strftime('%Y-%m-%d %H:%M'),
        'recipients_count': campaign.recipients_count
    })

# Initialize the database
db.init_app(app)
migrate = Migrate(app, db)

# Create required directories
for directory in ['uploads', 'frames', 'videos', 'processed_data', 'previews']:
    os.makedirs(directory, exist_ok=True)

with app.app_context():
    db.create_all()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)