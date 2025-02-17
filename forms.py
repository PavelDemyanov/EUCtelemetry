from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, SubmitField
from wtforms.validators import DataRequired, Email, Length, EqualTo
from flask_babel import lazy_gettext as _l

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
    submit = SubmitField(_l('Register'))

class ProfileForm(FlaskForm):
    name = StringField(_l('Name'), validators=[DataRequired(), Length(min=2, max=64)])
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