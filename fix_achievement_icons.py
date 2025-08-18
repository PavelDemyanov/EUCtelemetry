#!/usr/bin/env python3
"""
Скрипт для исправления имен иконок в базе данных achievements
"""

from app import app, db
from models import Achievement

# Маппинг неправильных имен на правильные
ICON_MAPPING = {
    'fast.svg': 'speed.svg',
    'superfast.svg': 'superspeed.svg', 
    'suicidalmadman.svg': 'skeleton.svg'
}

def fix_achievement_icons():
    """Исправляет неправильные имена иконок в базе данных"""
    
    with app.app_context():
        print("Проверяем иконки в базе данных...")
        
        updated_count = 0
        
        for old_icon, new_icon in ICON_MAPPING.items():
            # Находим достижения с неправильным именем иконки
            achievements = Achievement.query.filter_by(icon=old_icon).all()
            
            for achievement in achievements:
                print(f"Исправляем {achievement.achievement_id}: {old_icon} -> {new_icon}")
                achievement.icon = new_icon
                updated_count += 1
        
        if updated_count > 0:
            db.session.commit()
            print(f"✅ Обновлено {updated_count} записей в базе данных")
        else:
            print("ℹ️ Нет записей для обновления")
        
        # Проверяем результат
        print("\nПроверка после исправления:")
        all_achievements = Achievement.query.all()
        for achievement in all_achievements:
            print(f"{achievement.achievement_id}: {achievement.icon}")

if __name__ == "__main__":
    fix_achievement_icons()