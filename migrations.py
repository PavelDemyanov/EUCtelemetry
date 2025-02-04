from flask_migrate import Migrate
from app import app, db

migrate = Migrate(app, db)

if __name__ == '__main__':
    with app.app_context():
        from models import Project
        migrate.init_app(app, db)
