from app import app, db
from models import User
import logging
from sqlalchemy import text

logging.basicConfig(level=logging.INFO)

test_email = "mipoga3213@movfull.com"
case_variations = [
    "mipoga3213@movfull.com",
    "MIPOGA3213@MOVFULL.COM",
    "MiPoGa3213@MovFull.com",
    "Mipoga3213@movfull.com",
    "mipoga3213@MOVFULL.COM"
]

with app.app_context():
    logging.info("Проверка различных вариантов регистра для email:")
    
    # Проверяем, существует ли пользователь с email mipoga3213@movfull.com (точное совпадение)
    user = User.query.filter_by(email=test_email).first()
    logging.info(f"Точное совпадение '{test_email}': {user is not None}")
    
    # Проверка с использованием ilike для игнорирования регистра
    user_case_insensitive = User.query.filter(User.email.ilike(test_email)).first()
    logging.info(f"Поиск без учета регистра '{test_email}': {user_case_insensitive is not None}")
    
    # Проверяем все варианты написания email
    for variation in case_variations:
        # Точное совпадение (с учетом регистра)
        user_exact = User.query.filter_by(email=variation).first()
        
        # Без учета регистра
        user_ilike = User.query.filter(User.email.ilike(variation)).first()
        
        logging.info(f"Вариант '{variation}':")
        logging.info(f"  - Точное совпадение: {user_exact is not None}")
        logging.info(f"  - Без учета регистра: {user_ilike is not None}")
    
    # Проверяем, есть ли какие-либо email с похожим доменом
    similar_domain_users = User.query.filter(User.email.ilike('%movfull.com')).all()
    logging.info(f"Всего пользователей с доменом movfull.com (без учета регистра): {len(similar_domain_users)}")
    for user in similar_domain_users:
        logging.info(f"  - ID: {user.id}, Email: {user.email}")
    
    # Проверяем прямым SQL-запросом (для уверенности)
    result = db.session.execute(text("SELECT id, email FROM \"user\" WHERE email ILIKE '%movfull.com'"))
    sql_users = result.fetchall()
    logging.info(f"SQL-запрос без учета регистра: найдено {len(sql_users)} записей")
    for user in sql_users:
        logging.info(f"  - ID: {user.id}, Email: {user.email}")