
import smtplib
import logging
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def validate_smtp_settings():
    """Validate SMTP settings are properly configured"""
    required_settings = {
        "SMTP_SERVER": os.environ.get("SMTP_SERVER"),
        "SMTP_PORT": os.environ.get("SMTP_PORT"),
        "SMTP_LOGIN": os.environ.get("SMTP_LOGIN"),
        "SMTP_PASSWORD": os.environ.get("SMTP_PASSWORD")
    }

    missing = [key for key, value in required_settings.items() if not value]
    if missing:
        raise ValueError(f"Missing required SMTP settings: {', '.join(missing)}")

    return required_settings

def test_smtp_connection() -> tuple[bool, str]:
    """
    Test SMTP connection and authentication
    Returns tuple of (success: bool, message: str)
    """
    try:
        # Validate SMTP settings first
        settings = validate_smtp_settings()
        
        logging.info(f"Testing SMTP connection to: {settings['SMTP_SERVER']}:{settings['SMTP_PORT']}")
        
        # Ensure settings are strings and port is integer
        smtp_server = str(settings["SMTP_SERVER"])
        smtp_port = int(settings["SMTP_PORT"])
        smtp_login = str(settings["SMTP_LOGIN"])
        smtp_password = str(settings["SMTP_PASSWORD"])
        
        try:
            # Create secure SSL/TLS connection
            server = smtplib.SMTP_SSL(smtp_server, smtp_port)
            logging.debug("SMTP SSL connection established")
        except Exception as e:
            error_msg = f"Failed to establish SSL connection: {str(e)}"
            logging.error(error_msg)
            return False, error_msg
        
        try:
            # Test login
            server.login(smtp_login, smtp_password)
            logging.debug("SMTP login successful")
            server.quit()
            return True, "SMTP connection and authentication successful"
        except smtplib.SMTPAuthenticationError as e:
            error_msg = f"SMTP Authentication failed: {str(e)}"
            logging.error(error_msg)
            return False, error_msg
        except Exception as e:
            error_msg = f"SMTP connection error: {str(e)}"
            logging.error(error_msg)
            return False, error_msg
            
    except ValueError as ve:
        error_msg = f"SMTP Configuration Error: {str(ve)}"
        logging.error(error_msg)
        return False, error_msg
    except Exception as e:
        error_msg = f"Unexpected error testing SMTP: {str(e)}"
        logging.error(error_msg)
        return False, error_msg

def send_email(to_email: str, subject: str, html_content: str) -> bool:
    """
    Send email using SMTP server
    Returns True if email was sent successfully, False otherwise
    """
    try:
        # Validate SMTP settings first
        settings = validate_smtp_settings()

        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = settings["SMTP_LOGIN"]
        msg['To'] = to_email

        # Add HTML content
        html_part = MIMEText(html_content, 'html')
        msg.attach(html_part)

        logging.info(f"Attempting to connect to SMTP server: {settings['SMTP_SERVER']}:{settings['SMTP_PORT']}")

        # Ensure settings are strings and port is integer
        smtp_server = str(settings["SMTP_SERVER"])
        smtp_port = int(settings["SMTP_PORT"])
        smtp_login = str(settings["SMTP_LOGIN"])
        smtp_password = str(settings["SMTP_PASSWORD"])

        try:
            # Create secure SSL/TLS connection
            server = smtplib.SMTP_SSL(smtp_server, smtp_port)
            logging.debug("SMTP SSL connection established")
        except Exception as e:
            logging.error(f"Failed to establish SSL connection: {str(e)}")
            return False

        try:
            # Login
            server.login(smtp_login, smtp_password)
            logging.debug("SMTP login successful")
        except smtplib.SMTPAuthenticationError as e:
            logging.error(f"SMTP Authentication failed: {str(e)}")
            return False

        try:
            # Send email
            server.send_message(msg)
            logging.info(f"Email sent successfully to {to_email}")
        except Exception as e:
            logging.error(f"Failed to send email: {str(e)}")
            return False
        finally:
            # Properly close the connection
            server.quit()

        return True

    except ValueError as ve:
        logging.error(f"SMTP Configuration Error: {str(ve)}")
        return False
    except Exception as e:
        logging.error(f"Unexpected error sending email to {to_email}: {str(e)}")
        return False

def send_email_batch(emails: list) -> list:
    """
    Send multiple emails using a single SMTP connection for better performance
    Returns list of results for each email
    """
    try:
        # Validate SMTP settings first
        settings = validate_smtp_settings()
        
        # Ensure settings are strings and port is integer
        smtp_server = str(settings["SMTP_SERVER"])
        smtp_port = int(settings["SMTP_PORT"])
        smtp_login = str(settings["SMTP_LOGIN"])
        smtp_password = str(settings["SMTP_PASSWORD"])
        
        results = []
        server = None
        
        try:
            # Create single connection for the entire batch
            server = smtplib.SMTP_SSL(smtp_server, smtp_port)
            logging.debug("SMTP SSL connection established for batch")
            
            # Login once
            server.login(smtp_login, smtp_password)
            logging.debug("SMTP login successful for batch")
            
            # Send all emails using the same connection
            for email_data in emails:
                try:
                    to_email = email_data['to_email']
                    subject = email_data['subject']
                    html_content = email_data['html_content']
                    
                    # Create message
                    msg = MIMEMultipart('alternative')
                    msg['Subject'] = subject
                    msg['From'] = smtp_login
                    msg['To'] = to_email
                    
                    # Add HTML content
                    html_part = MIMEText(html_content, 'html')
                    msg.attach(html_part)
                    
                    # Send email
                    server.send_message(msg)
                    
                    results.append({
                        'email': to_email,
                        'success': True,
                        'error': None
                    })
                    logging.info(f"Email sent successfully to {to_email}")
                    
                except Exception as e:
                    results.append({
                        'email': email_data.get('to_email', 'unknown'),
                        'success': False,
                        'error': str(e)
                    })
                    logging.error(f"Failed to send email to {email_data.get('to_email', 'unknown')}: {str(e)}")
            
        finally:
            # Always close the connection
            if server:
                server.quit()
                logging.debug("SMTP connection closed")
        
        return results
        
    except ValueError as ve:
        # If SMTP is not configured, mark all emails as failed
        return [{
            'email': email_data.get('to_email', 'unknown'),
            'success': False,
            'error': f"SMTP Configuration Error: {str(ve)}"
        } for email_data in emails]
        
    except Exception as e:
        # If connection fails, mark all emails as failed
        logging.error(f"Unexpected error in batch email sending: {str(e)}")
        return [{
            'email': email_data.get('to_email', 'unknown'),
            'success': False,
            'error': str(e)
        } for email_data in emails]
