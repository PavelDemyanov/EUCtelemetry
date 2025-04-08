from app import app, db, User
import logging

logging.basicConfig(level=logging.INFO)

with app.app_context():
    # Ищем всех пользователей с доменом movfull.com
    movfull_users = User.query.filter(User.email.like('%movfull.com%')).all()
    
    logging.info(f"Найдено пользователей с доменом movfull.com: {len(movfull_users)}")
    for user in movfull_users:
        logging.info(f"ID: {user.id}, Email: {user.email}, Активен: {user.is_active}, Email подтвержден: {user.is_email_confirmed}")
    
    # Проверяем пользователей, у которых email совпадает с mipoga3213@movfull.com без учета регистра
    target_email = 'mipoga3213@movfull.com'
    case_insensitive_users = User.query.filter(User.email.ilike(target_email)).all()
    
    logging.info(f"Найдено пользователей с email {target_email} (без учета регистра): {len(case_insensitive_users)}")
    
    # Проверяем, есть ли у нас пользователи без домена (возможно, ошибка в БД)
    invalid_emails = User.query.filter(~User.email.like('%@%')).all()
    
    logging.info(f"Найдено пользователей с невалидными email (без @): {len(invalid_emails)}")
    for user in invalid_emails:
        logging.info(f"ID: {user.id}, Email: {user.email}")