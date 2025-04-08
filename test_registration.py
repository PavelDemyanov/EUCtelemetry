from app import app, db, User
import logging

# Настраиваем логирование для отслеживания процесса
logging.basicConfig(level=logging.INFO)

test_email = 'mipoga3213@movfull.com'

with app.app_context():
    # 1. Проверим, существует ли этот email в базе (должно быть False)
    existing_user = User.query.filter_by(email=test_email).first()
    
    logging.info(f"1. Пользователь с email {test_email} существует: {existing_user is not None}")
    if existing_user:
        logging.info(f"   ID: {existing_user.id}, Активен: {existing_user.is_active}")
    
    # 2. Проверим, существует ли этот email с учетом регистра
    lowercase_email = test_email.lower()
    existing_user_lowercase = User.query.filter(User.email.ilike(lowercase_email)).first()
    
    logging.info(f"2. Пользователь с email (без учета регистра) {lowercase_email} существует: {existing_user_lowercase is not None}")
    if existing_user_lowercase:
        logging.info(f"   ID: {existing_user_lowercase.id}, Активен: {existing_user_lowercase.is_active}")
    
    # 3. Проверим, есть ли неактивные пользователи с таким email
    inactive_user = User.query.filter_by(email=test_email, is_active=False).first()
    
    logging.info(f"3. Неактивный пользователь с email {test_email} существует: {inactive_user is not None}")
    if inactive_user:
        logging.info(f"   ID: {inactive_user.id}")
    
    # 4. Попробуем выполнить проверку, как в функции регистрации
    # Проверяем, существует ли активный пользователь с таким email
    check_existing_user = User.query.filter_by(email=test_email).first()
    registration_would_fail = check_existing_user and check_existing_user.is_active
    
    logging.info(f"4. Регистрация с email {test_email} была бы отклонена: {registration_would_fail}")
    
    # 5. Проверим, все ли записи соответствуют шаблону в базе данных
    all_users = User.query.all()
    logging.info(f"5. Все пользователи в базе:")
    for user in all_users:
        logging.info(f"   ID: {user.id}, Email: {user.email}, Активен: {user.is_active}, Email подтвержден: {user.is_email_confirmed}")