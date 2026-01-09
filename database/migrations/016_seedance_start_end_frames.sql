-- Add start and end frame URL columns for Seedance I2V
-- These columns will store the URLs of the start and end frames used for I2V generation

-- Check if columns don't exist before adding them
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='video_generation_sessions' AND column_name='start_frame_url'
    ) THEN
        ALTER TABLE video_generation_sessions ADD COLUMN start_frame_url TEXT NULL;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='video_generation_sessions' AND column_name='end_frame_url'
    ) THEN
        ALTER TABLE video_generation_sessions ADD COLUMN end_frame_url TEXT NULL;
    END IF;
END $$;

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_video_sessions_start_frame_url ON video_generation_sessions(start_frame_url);
CREATE INDEX IF NOT EXISTS idx_video_sessions_end_frame_url ON video_generation_sessions(end_frame_url);
