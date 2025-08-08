#!/usr/bin/env python3
"""
Migration script to add background task fields to EmailCampaign model
"""

from app import app, db
from models import EmailCampaign
import logging

def run_migration():
    """Add new fields to EmailCampaign table"""
    with app.app_context():
        try:
            # Check if we need to add the new columns
            from sqlalchemy import text
            
            # Check if task_id column exists
            result = db.session.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='email_campaign' AND column_name='task_id'
            """)).fetchone()
            
            if not result:
                print("Adding new fields to EmailCampaign table...")
                
                # Add new columns
                db.session.execute(text("""
                    ALTER TABLE email_campaign 
                    ADD COLUMN task_id VARCHAR(100),
                    ADD COLUMN is_completed BOOLEAN DEFAULT FALSE,
                    ADD COLUMN sent_count INTEGER DEFAULT 0,
                    ADD COLUMN failed_count INTEGER DEFAULT 0,
                    ADD COLUMN started_at TIMESTAMP,
                    ADD COLUMN completed_at TIMESTAMP
                """))
                
                db.session.commit()
                print("Successfully added background task fields to EmailCampaign")
            else:
                print("EmailCampaign table already has the new fields")
                
        except Exception as e:
            db.session.rollback()
            print(f"Error during migration: {str(e)}")
            logging.error(f"Migration error: {str(e)}")
            raise

if __name__ == "__main__":
    run_migration()