from app import app, db, User

with app.app_context():
    user = User.query.filter_by(email='mipoga3213@movfull.com').first()
    print(f'Пользователь существует: {user is not None}')
    if user:
        print(f'Активен: {user.is_active}')
        print(f'Email подтвержден: {user.is_email_confirmed}')
        print(f'ID пользователя: {user.id}')