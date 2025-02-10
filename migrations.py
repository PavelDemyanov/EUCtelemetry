from flask_migrate import Migrate
from app import app, db

migrate = Migrate(app, db)
