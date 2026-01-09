#!/bin/bash
# Initialize MinIO bucket for local development
# This script can be run after docker-compose up

set -e

echo "=========================================="
echo "  Cooly AI - MinIO Initialization"
echo "=========================================="

# MinIO configuration
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
MINIO_ACCESS_KEY="${MINIO_ROOT_USER:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_ROOT_PASSWORD:-minioadmin}"
BUCKET_NAME="${S3_BUCKET_NAME:-cooly-local}"

echo "[INFO] MinIO Endpoint: $MINIO_ENDPOINT"
echo "[INFO] Bucket Name: $BUCKET_NAME"

# Check if mc (MinIO Client) is available
if command -v mc &> /dev/null; then
  echo "[INFO] Using mc (MinIO Client) for initialization"

  # Configure mc alias
  mc alias set local "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" 2>/dev/null || true

  # Create bucket if not exists
  if ! mc ls local/"$BUCKET_NAME" &> /dev/null; then
    echo "[INFO] Creating bucket: $BUCKET_NAME"
    mc mb local/"$BUCKET_NAME"
  else
    echo "[INFO] Bucket already exists: $BUCKET_NAME"
  fi

  # Set bucket policy to public (for generated content access)
  echo "[INFO] Setting public read policy..."
  mc anonymous set download local/"$BUCKET_NAME"

  # Create folder structure
  echo "[INFO] Creating folder structure..."
  mc mb --ignore-existing local/"$BUCKET_NAME"/generated-content/byteplus-seedream-4
  mc mb --ignore-existing local/"$BUCKET_NAME"/generated-content/seedance-1-0
  mc mb --ignore-existing local/"$BUCKET_NAME"/generated-content/sora-2
  mc mb --ignore-existing local/"$BUCKET_NAME"/generated-content/google-veo31
  mc mb --ignore-existing local/"$BUCKET_NAME"/generated-content/general

else
  echo "[INFO] mc not found, using curl for basic setup..."

  # Wait for MinIO to be ready
  MAX_RETRIES=30
  RETRY_COUNT=0
  while ! curl -s "$MINIO_ENDPOINT/minio/health/live" > /dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
      echo "[ERROR] MinIO not ready after $MAX_RETRIES attempts"
      exit 1
    fi
    echo "[INFO] Waiting for MinIO... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
  done

  echo "[INFO] MinIO is ready!"
  echo "[WARN] For full initialization, install mc (MinIO Client):"
  echo "       brew install minio/stable/mc  # macOS"
  echo "       or download from https://min.io/download"
  echo ""
  echo "[INFO] Alternatively, access MinIO Console at http://localhost:9001"
  echo "       Login: $MINIO_ACCESS_KEY / $MINIO_SECRET_KEY"
  echo "       Create bucket: $BUCKET_NAME"
  echo "       Set Access Policy: public"
fi

echo "=========================================="
echo "  MinIO initialization complete!"
echo ""
echo "  Console: http://localhost:9001"
echo "  API:     $MINIO_ENDPOINT"
echo "  Bucket:  $BUCKET_NAME"
echo "=========================================="
