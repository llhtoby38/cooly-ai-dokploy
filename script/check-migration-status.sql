-- Check if migration 029 (client_key in generation_sessions) has been applied
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name='generation_sessions' AND column_name='client_key'
    ) THEN '✅ client_key column EXISTS in generation_sessions'
    ELSE '❌ client_key column MISSING in generation_sessions'
  END as migration_029_status;

-- Check if migration 030 (client_key, created_at, completed_at in images) has been applied
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name='images' AND column_name='client_key'
    ) THEN '✅ client_key column EXISTS in images'
    ELSE '❌ client_key column MISSING in images'
  END as client_key_status,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name='images' AND column_name='created_at'
    ) THEN '✅ created_at column EXISTS in images'
    ELSE '❌ created_at column MISSING in images'
  END as created_at_status,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name='images' AND column_name='completed_at'
    ) THEN '✅ completed_at column EXISTS in images'
    ELSE '❌ completed_at column MISSING in images'
  END as completed_at_status;

-- Show all columns in generation_sessions table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name='generation_sessions' 
ORDER BY ordinal_position;

-- Show all columns in images table  
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name='images' 
ORDER BY ordinal_position;

-- Check if there are any existing records with client_key values
SELECT 
  'generation_sessions' as table_name,
  COUNT(*) as total_records,
  COUNT(client_key) as records_with_client_key,
  COUNT(*) - COUNT(client_key) as records_without_client_key
FROM generation_sessions
UNION ALL
SELECT 
  'images' as table_name,
  COUNT(*) as total_records,
  COUNT(client_key) as records_with_client_key,
  COUNT(*) - COUNT(client_key) as records_without_client_key
FROM images;
