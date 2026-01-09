-- Add credit_cost column to video_generation_sessions
ALTER TABLE video_generation_sessions 
ADD COLUMN credit_cost INTEGER DEFAULT 5;

-- Add credit_cost column to generation_sessions (for images)
ALTER TABLE generation_sessions 
ADD COLUMN credit_cost INTEGER DEFAULT 1;

-- Update existing records with default costs
UPDATE video_generation_sessions 
SET credit_cost = 5 
WHERE credit_cost IS NULL;

UPDATE generation_sessions 
SET credit_cost = 1 
WHERE credit_cost IS NULL;
