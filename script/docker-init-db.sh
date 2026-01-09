#!/bin/bash
# Docker PostgreSQL initialization script
# This runs all migrations in order when the container starts for the first time

# Don't exit on error - some migrations may fail if they depend on later migrations
# (e.g., 003_billing creates INTEGER FK, 004_billing_uuid_fix changes to UUID)
set +e

echo "=========================================="
echo "  Cooly AI - Database Initialization"
echo "=========================================="

MIGRATIONS_DIR="/docker-entrypoint-initdb.d/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "[WARN] Migrations directory not found: $MIGRATIONS_DIR"
  echo "[WARN] Skipping migrations..."
  exit 0
fi

# Count migrations
MIGRATION_COUNT=$(find "$MIGRATIONS_DIR" -name "*.sql" -type f | wc -l | tr -d ' ')
echo "[INFO] Found $MIGRATION_COUNT migration files"

if [ "$MIGRATION_COUNT" -eq 0 ]; then
  echo "[INFO] No migrations to run"
  exit 0
fi

# Run migrations in sorted order (important for files like 006_a.sql, 006_b.sql)
echo "[INFO] Running migrations..."
COUNTER=0
for migration in $(find "$MIGRATIONS_DIR" -name "*.sql" -type f | sort); do
  COUNTER=$((COUNTER + 1))
  FILENAME=$(basename "$migration")
  echo "  [$COUNTER/$MIGRATION_COUNT] $FILENAME"

  # Run the migration using psql
  # Don't use ON_ERROR_STOP - some migrations have idempotent statements that may "fail"
  # (e.g., CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS)
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$migration" 2>&1 | grep -v "NOTICE:" || true
done

echo "=========================================="
echo "  All $COUNTER migrations completed!"
echo "=========================================="
