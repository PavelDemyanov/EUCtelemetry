import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

def generate_secret_key():
    """Generate a secure secret key"""
    return secrets.token_hex(24)

def setup_env_variables():
    """Setup environment variables with default values if not present"""
    env_path = Path('.env')
    
    # Create .env if it doesn't exist
    if not env_path.exists():
        env_path.touch()
    
    # Load existing variables
    load_dotenv()
    
    # Read current content
    current_env = env_path.read_text() if env_path.exists() else ""
    
    # Default PostgreSQL values
    defaults = {
        'FLASK_SECRET_KEY': generate_secret_key(),
        'DATABASE_URL': 'postgresql://postgres:postgres@localhost:5432/euc_telemetry',
        'PGDATABASE': 'euc_telemetry',
        'PGHOST': 'localhost',
        'PGPORT': '5432',
        'PGUSER': 'postgres',
        'PGPASSWORD': 'postgres'
    }
    
    # Add missing variables
    new_vars = []
    for key, default_value in defaults.items():
        if not os.getenv(key):
            new_vars.append(f'{key}="{default_value}"')
    
    # Append new variables if any
    if new_vars:
        with env_path.open('a') as f:
            if current_env and not current_env.endswith('\n'):
                f.write('\n')
            f.write('\n'.join(new_vars))
            f.write('\n')
        
        # Reload environment variables
        load_dotenv()
