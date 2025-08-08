#!/usr/bin/env python3
"""
Migration script to add new columns to email_campaign table
Run this before starting the main application on production server
"""

import os
import psycopg2
from urllib.parse import urlparse

def migrate_database():
    # Get database URL from environment
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        print("Error: DATABASE_URL environment variable not set")
        return False
    
    try:
        # Parse database URL
        parsed = urlparse(database_url)
        
        # Connect to database
        conn = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path[1:],  # Remove leading slash
            user=parsed.username,
            password=parsed.password
        )
        
        cursor = conn.cursor()
        
        # Execute migration SQL
        migration_sql = """
        -- Add new columns to email_campaign table
        ALTER TABLE email_campaign ADD COLUMN IF NOT EXISTS task_id VARCHAR;
        ALTER TABLE email_campaign ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT FALSE;
        ALTER TABLE email_campaign ADD COLUMN IF NOT EXISTS sent_count INTEGER DEFAULT 0;
        ALTER TABLE email_campaign ADD COLUMN IF NOT EXISTS failed_count INTEGER DEFAULT 0;
        ALTER TABLE email_campaign ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
        ALTER TABLE email_campaign ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
        
        -- Update existing campaigns
        UPDATE email_campaign 
        SET is_completed = TRUE, completed_at = created_at 
        WHERE is_completed IS NULL OR is_completed = FALSE;
        """
        
        cursor.execute(migration_sql)
        conn.commit()
        
        print("✓ Migration completed successfully!")
        print("✓ Added 6 new columns to email_campaign table")
        print("✓ Updated existing campaigns as completed")
        
        # Show table structure
        cursor.execute("""
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'email_campaign' 
        ORDER BY ordinal_position;
        """)
        
        columns = cursor.fetchall()
        print("\nUpdated table structure:")
        for col in columns:
            print(f"  {col[0]} ({col[1]}) - {'NULL' if col[2] == 'YES' else 'NOT NULL'}")
        
        cursor.close()
        conn.close()
        return True
        
    except Exception as e:
        print(f"Error during migration: {e}")
        return False

if __name__ == "__main__":
    print("Starting email_campaign table migration...")
    success = migrate_database()
    if success:
        print("\n✓ Migration completed! You can now start the application.")
    else:
        print("\n✗ Migration failed! Please check the error above.")