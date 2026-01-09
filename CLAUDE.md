# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cooly AI is an AI-powered media generation platform with image generation (Seedream 3/4), video generation (Seedance, Sora 2, Veo 3.1), and text-to-speech capabilities. The architecture follows an enqueue-first pattern with queue-based job processing (BullMQ for local, AWS SQS for production).

## Repository Structure

```
backend/       → Express server & REST APIs (Node.js)
frontend/      → Next.js 15 / React 19 client
studio/        → Sanity CMS for content management
script/        → Helper scripts, migrations, tests
database/      → SQL migration files (77 migrations)
docs/          → Architecture documentation
```

## Local Development (Docker - Recommended)

The entire platform can be run locally using Docker Compose with fully local services.

### Quick Start
```bash
# Copy environment template
cp .env.local.example .env.local
# Edit .env.local with your API keys (Byteplus, OpenAI, Stripe, etc.)

# Start all services
docker-compose up -d --build

# Wait for services to be healthy, then seed test data
./script/seed-db.sh

# Access the application
# Frontend: http://localhost:3000
# Backend:  http://localhost:5001
# MinIO:    http://localhost:9001

# View logs
docker-compose logs -f backend

# Stop all services
docker-compose down

# Full reset (including data)
docker-compose down -v
```

### Docker Services
| Service | Port | Purpose |
|---------|------|---------|
| postgres | 5432 | PostgreSQL 16 database |
| redis | 6379 | Redis 7 for BullMQ queue |
| minio | 9000/9001 | S3-compatible storage |
| backend | 5001 | Express API + Workers |
| frontend | 3000 | Next.js UI |

### Test User (after seeding)
- Email: `test@example.com`
- Password: `testpassword123`
- Credits: 1000

## Development Commands (Without Docker)

### Backend (Express API on :5000)
```bash
cd backend && npm install
npm run dev          # nodemon with watch
npm start            # production
npm run diag:queue   # queue diagnostics
npm run test:integration  # integration tests
```

### Frontend (Next.js on :3000)
```bash
cd frontend && npm install
npm run dev          # next dev
npm run build        # prebuild injects API base, then next build
npm run lint         # next lint
npm run setup-mock   # configure mock API mode
```

### Studio (Sanity CMS)
```bash
cd studio && npm install
npm run dev          # sanity dev --host
npm run build        # sanity build
```

## Architecture

### Enqueue-First Generation Pipeline
1. API validates request, reserves credits, inserts `outbox` row, returns 202
2. Outbox Relay polls `outbox` (FOR UPDATE SKIP LOCKED), sends to queue
3. Worker (`backend/src/queue/genWorker.js`) processes jobs, routes to handlers
4. Handlers call providers, stream media to storage, update DB, capture credits
5. NOTIFY triggers push SSE events to connected clients

### Queue Adapter Pattern
The queue system supports both local (BullMQ) and cloud (SQS) backends:
- `src/queue/queueAdapter.js` - Unified interface, auto-detects environment
- `src/queue/bullmqAdapter.js` - BullMQ/Redis implementation (local dev)
- `src/queue/sqsAdapter.js` - AWS SQS wrapper (production)

Environment detection:
- `USE_BULLMQ=true` OR missing `SQS_MAIN_QUEUE_URL` → Uses BullMQ
- Otherwise → Uses AWS SQS

### Storage Adapter
Storage supports both local (MinIO) and cloud (Backblaze B2):
- `S3_ENDPOINT` set → Uses custom S3-compatible endpoint (MinIO)
- Otherwise → Uses Backblaze B2

### Key Backend Components
- `src/app.js` - Express app, routes, middleware, worker startup
- `src/db.js` - PostgreSQL connection pool (auto-disables SSL for local)
- `src/api/` - Route handlers (seedream4, seedance, sora2, veo31, billing, auth)
- `src/queue/` - Queue adapters, worker, job handlers
- `src/workers/` - Background workers (captureWorker, sessionSweeper, outboxRelay)
- `src/utils/` - Shared utilities (logger, storage, credits, appSettings)

### Key Frontend Components
- `src/app/page.jsx` - Main generation interface
- `src/app/components/` - React components
- `src/app/image/`, `src/app/video/` - Tool-specific pages
- `src/app/billing/` - Stripe integration
- `src/app/services/` - API client helpers

### Job Handlers
Handlers in `backend/src/queue/jobs/` auto-register via `jobNames` export:
- `gen.seedream4` - Image generation
- `gen.seedance` - Video generation
- `gen.sora`, `gen.veo31` - Additional video models

### Database
PostgreSQL (Supabase for cloud, local PostgreSQL for Docker).
Migrations in `database/migrations/` (77 numbered SQL files, auto-run on Docker startup).
Key tables: `users`, `generation_sessions`, `images`, `videos`, `credit_lots`, `credit_reservations`, `credit_transactions`, `outbox`

## Environment Configuration

Backend reads `.env` (production) and `.env.local` (local overrides) from repo root.

### Core Variables
- `DATABASE_URL` - PostgreSQL connection (auto-disables SSL for localhost)
- `JWT_SECRET` - Auth token signing
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` - Billing

### Queue Configuration
- `USE_BULLMQ=true` - Force BullMQ mode (default for local)
- `REDIS_URL` - Redis connection for BullMQ
- `SQS_MAIN_QUEUE_URL`, `SQS_DLQ_QUEUE_URL` - AWS SQS (production)
- `START_GEN_WORKER=true` - Start worker in-process

### Storage Configuration
- `S3_ENDPOINT` - Custom S3 endpoint (MinIO for local)
- `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` - S3 credentials
- `B2_*` - Backblaze B2 storage (production fallback)

### Provider API Keys
- `BYTEPLUS_*`, `SEEDREAM4_*`, `SEEDANCE_*` - Byteplus APIs
- `OPENAI_API_KEY`, `WAVESPEED_API_KEY`, `FAL_KEY` - Sora providers
- `GOOGLE_*`, `KIE_API_KEY` - Veo providers

### Mock/Test Modes
- `MOCK_API`, `MOCK_SEEDREAM4`, `MOCK_SEEDANCE`, `MOCK_SORA` - Skip real API calls

## Deployment

### Preview (PR-based)
- Render: Auto-deploys `cooly-ai-pr-<PR#>` backend + gen-worker via `render.yaml`
- Vercel: GitHub Action deploys preview frontend, injects matching API base
- `script/inject-api-base.js` sets `NEXT_PUBLIC_API_BASE` at build time

### Production
- Manual promotion from main branch
- Render dashboard for backend
- Vercel dashboard or `npx vercel --prod` for frontend

## CORS
Configured in `backend/src/app.js`. Allows:
- `localhost:3000`
- `*.vercel.app`
- `*--cooly-ai-api.onrender.com`

## Credits System
- `credit_lots` - Purchased/granted credit batches with expiration
- `credit_reservations` - Temporary holds during generation
- `credit_transactions` - Audit trail with `reservation_id`
- Workers call `captureReservation` on success, `releaseReservation` on failure

## Testing Modes
Mock flags skip real provider calls and use placeholder URLs:
```bash
MOCK_API=true          # All tools
MOCK_SEEDREAM4=true    # Image generation only
MOCK_SEEDANCE=true     # Video generation only
```
Admin can toggle via `app_settings` table without redeploy.

## SSE & Real-time Updates
- Backend: `NOTIFY session_created/session_completed` PostgreSQL channels
- API routes listen with `pg.connect()` and broadcast to SSE connections
- Frontend polls history and receives push updates for completion
