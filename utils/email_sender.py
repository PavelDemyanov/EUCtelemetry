import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SMTP_SERVER = "smtp.mail.ru"
SMTP_PORT = 465
SMTP_LOGIN = "noreply@euctelemetry.app"
SMTP_PASSWORD = "Bp3uqvhwaNBqJwqbhw8b"

def send_email(to_email: str, subject: str, html_content: str) -> bool:
    """
    Send email using Mail.ru SMTP server
    Returns True if email was sent successfully, False otherwise
    """
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = SMTP_LOGIN
        msg['To'] = to_email

        # Add HTML content
        html_part = MIMEText(html_content, 'html')
        msg.attach(html_part)

        # Create secure SSL/TLS connection
        server = smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT)
        server.login(SMTP_LOGIN, SMTP_PASSWORD)
        
        # Send email
        server.send_message(msg)
        server.quit()
        
        logging.info(f"Email sent successfully to {to_email}")
        return True
        
    except Exception as e:
        logging.error(f"Failed to send email to {to_email}: {str(e)}")
        return False
