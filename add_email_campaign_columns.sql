-- Add new columns to email_campaign table for background task support
-- Run this SQL script on your production database before starting the application

-- Add task_id column for tracking background tasks
ALTER TABLE email_campaign ADD COLUMN IF NOT EXISTS task_id VARCHAR;

-- Add completion status column
ALTER TABLE email_campaign ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT FALSE;

-- Add sent count column
ALTER TABLE email_campaign ADD COLUMN IF NOT EXISTS sent_count INTEGER DEFAULT 0;

-- Add failed count column  
ALTER TABLE email_campaign ADD COLUMN IF NOT EXISTS failed_count INTEGER DEFAULT 0;

-- Add started timestamp column
ALTER TABLE email_campaign ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;

-- Add completed timestamp column
ALTER TABLE email_campaign ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

-- Update existing campaigns to mark them as completed (since they're old)
UPDATE email_campaign 
SET is_completed = TRUE, completed_at = created_at 
WHERE is_completed IS NULL OR is_completed = FALSE;

-- Show updated table structure
\d email_campaign;