#!/bin/bash
# Seed the database with test data for local development
# Run this after docker-compose up when the database is ready

set -e

echo "=========================================="
echo "  Cooly AI - Database Seeding"
echo "=========================================="

# Database connection - use Docker service name or localhost
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${POSTGRES_USER:-cooly}"
DB_PASS="${POSTGRES_PASSWORD:-cooly_local_dev}"
DB_NAME="${POSTGRES_DB:-cooly_dev}"

# Check if we can connect
echo "[INFO] Connecting to database at $DB_HOST:$DB_PORT..."

export PGPASSWORD="$DB_PASS"

# Wait for database to be ready
MAX_RETRIES=30
RETRY_COUNT=0
while ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" > /dev/null 2>&1; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "[ERROR] Database not ready after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "[INFO] Waiting for database... ($RETRY_COUNT/$MAX_RETRIES)"
  sleep 2
done

echo "[INFO] Database is ready!"

# Create test user
# Password: testpassword123 (bcrypt hash generated with cost factor 10)
# You can generate a new hash using: node -e "require('bcrypt').hash('testpassword123', 10).then(console.log)"
TEST_USER_EMAIL="test@example.com"
TEST_USER_PASSWORD_HASH='$2b$12$aOBTYPdoUdrbI0VwJi9pI.tJJ9PtbpQ4EpJUDhgEofm8zAJdAtMiS'

echo "[INFO] Creating test user: $TEST_USER_EMAIL"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" << EOSQL
-- Create test user if not exists
DO \$\$
DECLARE
  test_user_id UUID;
BEGIN
  -- Check if user exists
  SELECT id INTO test_user_id FROM users WHERE email = '$TEST_USER_EMAIL';

  IF test_user_id IS NULL THEN
    -- Create user
    INSERT INTO users (email, password_hash)
    VALUES ('$TEST_USER_EMAIL', '$TEST_USER_PASSWORD_HASH')
    RETURNING id INTO test_user_id;
    RAISE NOTICE 'Created new user with id: %', test_user_id;
  ELSE
    -- Update password
    UPDATE users SET password_hash = '$TEST_USER_PASSWORD_HASH' WHERE id = test_user_id;
    RAISE NOTICE 'Updated existing user with id: %', test_user_id;
  END IF;

  -- Create credit lot if none exists
  IF NOT EXISTS (SELECT 1 FROM credit_lots WHERE user_id = test_user_id AND remaining > 0 AND expires_at > NOW()) THEN
    INSERT INTO credit_lots (user_id, source, amount, remaining, expires_at)
    VALUES (test_user_id, 'adjustment', 1000, 1000, NOW() + INTERVAL '365 days');
    RAISE NOTICE 'Created credit lot for user';
  ELSE
    RAISE NOTICE 'User already has active credit lot';
  END IF;

  -- IMPORTANT: Update the users.credits cache column (frontend reads from this)
  UPDATE users SET credits = (
    SELECT COALESCE(SUM(remaining), 0)
    FROM credit_lots
    WHERE user_id = test_user_id
      AND remaining > 0
      AND (expires_at > NOW() OR source = 'one_off')
      AND closed_at IS NULL
  ) WHERE id = test_user_id;
  RAISE NOTICE 'Updated users.credits cache for user';
END \$\$;

-- Set up app settings for local development
INSERT INTO app_settings (key, value)
VALUES
  ('free_signup_credits_enabled', 'true'),
  ('mock_seedream4', 'false'),
  ('mock_seedance', 'false'),
  ('mock_sora', 'false'),
  ('mock_veo', 'false'),
  ('gen_worker_concurrency', '5')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- Display created user
SELECT id, email, created_at FROM users WHERE email = '$TEST_USER_EMAIL';

-- Display credit balance
SELECT u.email, SUM(cl.remaining) as total_credits
FROM users u
JOIN credit_lots cl ON cl.user_id = u.id
WHERE u.email = '$TEST_USER_EMAIL'
  AND cl.expires_at > NOW()
  AND cl.closed_at IS NULL
GROUP BY u.email;
EOSQL

echo "=========================================="
echo "  Seeding complete!"
echo ""
echo "  Test User:"
echo "    Email: $TEST_USER_EMAIL"
echo "    Password: testpassword123"
echo "    Credits: 1000"
echo "=========================================="
