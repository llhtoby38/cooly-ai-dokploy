-- Add storage_status column to video_generation_sessions
ALTER TABLE video_generation_sessions 
ADD COLUMN storage_status VARCHAR(50) DEFAULT 'pending';

-- Update existing records to have appropriate storage_status
UPDATE video_generation_sessions 
SET storage_status = CASE 
    WHEN status = 'completed' AND EXISTS (SELECT 1 FROM videos WHERE session_id = video_generation_sessions.id) THEN 'completed'
    WHEN status = 'failed' THEN 'failed'
    WHEN status = 'processing' THEN 'pending'
    ELSE 'pending'
END;

-- Add index for better query performance
CREATE INDEX idx_video_sessions_storage_status ON video_generation_sessions(storage_status);
