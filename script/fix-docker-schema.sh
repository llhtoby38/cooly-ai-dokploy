#!/bin/bash
# Fix missing database columns for Docker local development
# Run this if you encounter "column does not exist" errors
# Usage: ./script/fix-docker-schema.sh

set -e

echo "=========================================="
echo "  Cooly AI - Schema Fix for Docker"
echo "=========================================="

# Database connection - use Docker service name or localhost
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${POSTGRES_USER:-cooly}"
DB_PASS="${POSTGRES_PASSWORD:-cooly_local_dev}"
DB_NAME="${POSTGRES_DB:-cooly_dev}"

export PGPASSWORD="$DB_PASS"

# Wait for database to be ready
echo "[INFO] Connecting to database at $DB_HOST:$DB_PORT..."
MAX_RETRIES=10
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

echo "[INFO] Database is ready! Applying schema fixes..."

# Apply fixes for columns that may be missing due to migration ordering issues
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" << 'EOSQL'

-- Fix credit_transactions table (migration 016 tries to alter before 019 creates it)
ALTER TABLE IF EXISTS credit_transactions
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES credit_lots(id),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reservation_id UUID NULL;

-- Create index and FK for reservation_id if not exists
CREATE INDEX IF NOT EXISTS idx_credit_transactions_reservation_id
  ON credit_transactions (reservation_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_credit_transactions_reservation'
  ) THEN
    ALTER TABLE credit_transactions
      ADD CONSTRAINT fk_credit_transactions_reservation
      FOREIGN KEY (reservation_id)
      REFERENCES credit_reservations(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Fix generation_sessions table (columns used by API but not in migrations)
ALTER TABLE IF EXISTS generation_sessions
  ADD COLUMN IF NOT EXISTS guidance_scale NUMERIC(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS negative_prompt TEXT DEFAULT NULL;

-- Ensure credit_lots unique constraint exists for subscription idempotency
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'credit_lots_user_source_cycle_start_key'
  ) THEN
    ALTER TABLE credit_lots
      ADD CONSTRAINT credit_lots_user_source_cycle_start_key
      UNIQUE (user_id, source, cycle_start);
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

SELECT 'Schema fixes applied successfully!' AS result;

EOSQL

echo "=========================================="
echo "  Schema fixes complete!"
echo "=========================================="
