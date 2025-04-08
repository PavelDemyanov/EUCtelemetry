from email_validator import validate_email, EmailNotValidError
import logging

logging.basicConfig(level=logging.INFO)

test_email = 'mipoga3213@movfull.com'

try:
    # Проверим, валидный ли email с точки зрения синтаксиса
    validation = validate_email(test_email)
    
    normalized_email = validation.email
    logging.info(f"Email {test_email} валиден")
    logging.info(f"Нормализованный email: {normalized_email}")
    
    # Проверим MX-записи (реальность домена)
    validation = validate_email(test_email, check_deliverability=True)
    logging.info(f"Email {test_email} имеет действительный MX-запись (домен существует)")
    
except EmailNotValidError as e:
    logging.error(f"Email {test_email} невалиден: {str(e)}")

# Проверим все примеры email из тестового скрипта
variants = [
    'mipoga3213@movfull.com',
    'MIPOGA3213@MOVFULL.COM',
    'MiPoGa3213@MovFull.com',
    'mipoga3213@MOVFULL.com',
    'Mipoga3213@movfull.com'
]

for email in variants:
    try:
        validation = validate_email(email)
        normalized = validation.email
        logging.info(f"Email {email} валиден и нормализован как {normalized}")
    except EmailNotValidError as e:
        logging.error(f"Email {email} невалиден: {str(e)}")