# Changelog

All notable changes to the Cooly AI platform are documented here.

## [Unreleased]

### Added - Docker Containerization (2024-12-30)

#### Docker Infrastructure
- **`docker-compose.yml`**: Full orchestration of 5 services (PostgreSQL, Redis, MinIO, Backend, Frontend)
- **`backend/Dockerfile`**: Multi-stage build for Express API with worker support
- **`frontend/Dockerfile`**: Multi-stage build with standalone Next.js output
- **`.env.local.example`**: Environment template for local development

#### Queue System Adapter Layer
- **`backend/src/queue/queueAdapter.js`**: Unified queue interface supporting both BullMQ (local) and SQS (production)
- **`backend/src/queue/bullmqAdapter.js`**: BullMQ implementation with SQS-compatible interface
- **`backend/src/queue/sqsAdapter.js`**: Thin wrapper around existing SQS client
- Auto-detection: `USE_BULLMQ=true` OR missing `SQS_MAIN_QUEUE_URL` -> BullMQ mode

#### Storage Adapter
- Modified `backend/src/utils/storage.js` to support custom S3 endpoints (MinIO)
- Added `getPublicUrl()` helper for both MinIO and Backblaze B2
- Environment-based switching via `S3_ENDPOINT`

#### Database Enhancements
- Modified `backend/src/db.js` with auto SSL toggle for local connections
- Added local database detection (localhost, 127.0.0.1, postgres:5432)

#### Scripts
- **`script/docker-init-db.sh`**: Auto-run migrations on PostgreSQL container startup
- **`script/seed-db.sh`**: Create test user with 1000 credits
- **`script/fix-docker-schema.sh`**: Fix missing columns from migration ordering issues

### Changed

#### Frontend Configuration
- Updated `frontend/next.config.js` with `output: 'standalone'` for Docker builds
- Added `.env.local` loading support

#### Worker Integration
- Modified `backend/src/queue/genWorker.js`:
  - Added `startBullMQWorker()` function
  - Unified `startWorker()` that auto-detects queue type
  - Support for `.env.local` configuration

#### Outbox Relay
- Updated `backend/src/workers/outboxRelay.js` to use queue adapter instead of direct SQS client

### Fixed
- Port conflict resolution (backend uses 5001 instead of 5000 for macOS AirPlay compatibility)
- Migration ordering issues with `credit_transactions.lot_id` column
- Credits display issue (now properly syncs `users.credits` cache from `credit_lots`)

### Documentation
- Updated `CLAUDE.md` with Docker development instructions
- Updated `README.md` with comprehensive local development guide
- Added architecture documentation for queue and storage adapters

---

## Environment Auto-Detection

| Condition | Result |
|-----------|--------|
| `USE_BULLMQ=true` OR no `SQS_MAIN_QUEUE_URL` | Use BullMQ + Redis |
| `S3_ENDPOINT` is set | Use MinIO/custom S3 |
| DB URL contains localhost/postgres:5432 | Disable SSL |

---

## Migration Notes

### From Cloud-Only to Docker Local Dev

1. Copy `.env.local.example` to `.env.local`
2. Add your API keys (Byteplus, OpenAI, Stripe)
3. Run `docker-compose up -d --build`
4. Run `./script/seed-db.sh` to create test user
5. If you encounter schema errors, run `./script/fix-docker-schema.sh`

### Test Credentials
- Email: `test@example.com`
- Password: `testpassword123`
- Credits: 1000

### Service URLs
- Frontend: http://localhost:3000
- Backend API: http://localhost:5001
- MinIO Console: http://localhost:9001 (cooly_minio / cooly_minio_secret)
