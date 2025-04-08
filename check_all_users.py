from app import app, db, User

with app.app_context():
    # Получаем всех пользователей
    users = User.query.all()
    
    # Печатаем информацию о каждом
    print(f"Всего пользователей в базе: {len(users)}")
    for user in users:
        print(f"ID: {user.id}, Email: {user.email}, Активен: {user.is_active}, Email подтвержден: {user.is_email_confirmed}")
        
    # Ищем похожие email
    search_term = 'movfull.com'
    similar_emails = User.query.filter(User.email.like(f'%{search_term}%')).all()
    
    print(f"\nПользователи с похожим email (содержит '{search_term}'): {len(similar_emails)}")
    for user in similar_emails:
        print(f"ID: {user.id}, Email: {user.email}, Активен: {user.is_active}, Email подтвержден: {user.is_email_confirmed}")