from app import app, db
import logging
from sqlalchemy import text

logging.basicConfig(level=logging.INFO)

with app.app_context():
    # Делаем прямой SQL-запрос для вывода всех пользователей без фильтрации модели
    result = db.session.execute(text("SELECT id, email, is_active, is_email_confirmed FROM \"user\" ORDER BY id"))
    users = result.fetchall()
    
    logging.info(f"Всего записей в таблице 'user': {len(users)}")
    for user in users:
        logging.info(f"ID: {user.id}, Email: {user.email}, Активен: {user.is_active}, Email подтвержден: {user.is_email_confirmed}")