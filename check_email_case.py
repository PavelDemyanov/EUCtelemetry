from app import app, db, User
import logging

logging.basicConfig(level=logging.INFO)

test_email = 'mipoga3213@movfull.com'

# Варианты с разным регистром
variants = [
    'mipoga3213@movfull.com',
    'MIPOGA3213@MOVFULL.COM',
    'MiPoGa3213@MovFull.com',
    'mipoga3213@MOVFULL.com',
    'Mipoga3213@movfull.com'
]

with app.app_context():
    for variant in variants:
        existing_user = User.query.filter_by(email=variant).first()
        logging.info(f"Пользователь с email '{variant}' существует: {existing_user is not None}")
        
        # Попробуем поиск без учета регистра
        existing_user_case_insensitive = User.query.filter(User.email.ilike(variant)).first()
        logging.info(f"Пользователь с email '{variant}' (без учета регистра) существует: {existing_user_case_insensitive is not None}")
    
    # Попробуем поиск с помощью LIKE для мипога
    similar_users = User.query.filter(User.email.like('%мипога%')).all()
    logging.info(f"Пользователи с email, содержащим 'мипога': {len(similar_users)}")
    for user in similar_users:
        logging.info(f"ID: {user.id}, Email: {user.email}")
    
    # Может быть, это кириллица vs латиница?
    cyrillic_users = User.query.filter(User.email.like('%мипога%')).all()
    logging.info(f"Пользователи с кириллицей в email: {len(cyrillic_users)}")
    
    # Поиск по всем колонкам для символов "мипога"
    from sqlalchemy import or_
    all_columns_search = User.query.filter(
        or_(
            User.name.like('%мипога%'),
            User.email.like('%мипога%')
        )
    ).all()
    logging.info(f"Пользователи с 'мипога' в любой колонке: {len(all_columns_search)}")