from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, SubmitField, TextAreaField, BooleanField, HiddenField, IntegerField
from wtforms.validators import DataRequired, Email, Length, EqualTo, ValidationError
from flask_babel import lazy_gettext as _l
import requests
import os
import random
from flask import session

def validate_recaptcha(form, field):
    """Validate Google reCAPTCHA response"""
    if not field.data:
        raise ValidationError(_l('Please complete the CAPTCHA verification'))
    
    secret_key = os.environ.get('RECAPTCHA_SECRET_KEY')
    if not secret_key:
        # If no CAPTCHA configured, skip validation in development
        return
    
    response = requests.post('https://www.google.com/recaptcha/api/siteverify', {
        'secret': secret_key,
        'response': field.data
    })
    
    result = response.json()
    if not result.get('success'):
        raise ValidationError(_l('CAPTCHA verification failed. Please try again.'))

def validate_math_captcha(form, field):
    """Validate simple math CAPTCHA"""
    if not field.data:
        raise ValidationError(_l('Please solve the math problem'))
    
    expected_answer = session.get('captcha_answer')
    if expected_answer is None:
        raise ValidationError(_l('CAPTCHA session expired. Please refresh the page.'))
    
    try:
        user_answer = int(field.data)
        if user_answer != expected_answer:
            raise ValidationError(_l('Incorrect answer. Please try again.'))
        # Clear captcha after successful validation to prevent reuse
        session.pop('captcha_answer', None)
        session.pop('captcha_question', None)
    except (ValueError, TypeError):
        raise ValidationError(_l('Please enter a valid number'))

def generate_math_captcha():
    """Generate simple math problem and store answer in session"""
    num1 = random.randint(1, 10)
    num2 = random.randint(1, 10)
    operation = random.choice(['+', '-'])
    
    if operation == '+':
        answer = num1 + num2
        question = f"{num1} + {num2} = ?"
    else:
        # Ensure positive result for subtraction
        if num1 < num2:
            num1, num2 = num2, num1
        answer = num1 - num2
        question = f"{num1} - {num2} = ?"
    
    session['captcha_answer'] = answer
    session['captcha_question'] = question
    return question

class LoginForm(FlaskForm):
    email = StringField(_l('Email'), validators=[DataRequired(), Email()])
    password = PasswordField(_l('Password'), validators=[DataRequired()])
    submit = SubmitField(_l('Sign In'))

class RegistrationForm(FlaskForm):
    email = StringField(_l('Email'), validators=[DataRequired(), Email()])
    name = StringField(_l('Name'), validators=[DataRequired(), Length(min=2, max=64)])
    password = PasswordField(_l('Password'), validators=[DataRequired(), Length(min=6)])
    password2 = PasswordField(_l('Confirm Password'), 
                            validators=[DataRequired(), EqualTo('password', message=_l('Passwords must match'))])
    math_captcha = IntegerField(_l('Math CAPTCHA'), validators=[DataRequired(), validate_math_captcha])
    recaptcha = HiddenField()  # Временно отключено до настройки домена
    submit = SubmitField(_l('Register'))

class ProfileForm(FlaskForm):
    name = StringField(_l('Name'), validators=[DataRequired(), Length(min=2, max=64)])
    subscribed_to_emails = BooleanField(_l('Receive email notifications'))
    submit = SubmitField(_l('Save Changes'))

class ChangePasswordForm(FlaskForm):
    current_password = PasswordField(_l('Current Password'), validators=[DataRequired()])
    new_password = PasswordField(_l('New Password'), validators=[
        DataRequired(),
        Length(min=6, message=_l('Password must be at least 6 characters long'))
    ])
    confirm_password = PasswordField(_l('Confirm New Password'), validators=[
        DataRequired(),
        EqualTo('new_password', message=_l('Passwords must match'))
    ])
    submit = SubmitField(_l('Change Password'))

class DeleteAccountForm(FlaskForm):
    password = PasswordField(_l('Current Password'), validators=[DataRequired()])
    submit = SubmitField(_l('Delete Account'))

class ForgotPasswordForm(FlaskForm):
    email = StringField(_l('Email'), validators=[DataRequired(), Email()])
    submit = SubmitField(_l('Send Reset Link'))
    
class ResendConfirmationForm(FlaskForm):
    email = StringField(_l('Email'), validators=[DataRequired(), Email()])
    submit = SubmitField(_l('Resend Confirmation Email'))

class ResetPasswordForm(FlaskForm):
    password = PasswordField(_l('New Password'), validators=[
        DataRequired(),
        Length(min=6, message=_l('Password must be at least 6 characters long'))
    ])
    password2 = PasswordField(_l('Confirm New Password'), validators=[
        DataRequired(),
        EqualTo('password', message=_l('Passwords must match'))
    ])
    submit = SubmitField(_l('Reset Password'))

class EmailCampaignForm(FlaskForm):
    subject = StringField(_l('Subject'), validators=[
        DataRequired(), 
        Length(max=200, message=_l('Subject must be less than 200 characters'))
    ])
    html_content = TextAreaField(_l('Message Content'), validators=[DataRequired()])
    submit = SubmitField(_l('Send Campaign'))

class NewsForm(FlaskForm):
    title = StringField(_l('Title'), validators=[
        DataRequired(), 
        Length(min=1, max=200, message=_l('Title must be between 1 and 200 characters'))
    ])
    content = TextAreaField(_l('Content'), validators=[DataRequired()])
    submit = SubmitField(_l('Save News'))

class EmailTestForm(FlaskForm):
    test_email = StringField(_l('Test Email Address'), validators=[DataRequired(), Email()])
    submit = SubmitField(_l('Send Test Email'))


class AchievementForm(FlaskForm):
    achievement_id = StringField('Achievement ID', validators=[
        DataRequired(), 
        Length(min=1, max=50, message='Achievement ID must be between 1 and 50 characters')
    ])
    title = StringField('Title', validators=[
        DataRequired(), 
        Length(min=1, max=100, message='Title must be between 1 and 100 characters')
    ])
    description = TextAreaField('Description', validators=[DataRequired()])
    icon = StringField('Icon File', validators=[
        DataRequired(),
        Length(min=1, max=100, message='Icon file must be between 1 and 100 characters')
    ])
    formula = TextAreaField('Formula', validators=[DataRequired()], 
                           render_kw={'rows': 5, 'placeholder': 'Enter Python expression (e.g., max_speed >= 130)'})
    is_active = BooleanField('Active')
    submit = SubmitField('Save Achievement')