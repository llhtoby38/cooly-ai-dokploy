# Cooly.AI Monorepo

## Overview

Cooly AI is an AI-powered media generation platform with image generation (Seedream 3/4), video generation (Seedance, Sora 2, Veo 3.1), and text-to-speech capabilities.

```
backend/       -> Express server & REST APIs (Node.js)
frontend/      -> Next.js 15 / React 19 client
studio/        -> Sanity CMS for content management
script/        -> Helper scripts, migrations, tests
database/      -> SQL migration files (77 migrations)
docs/          -> Architecture documentation
```

## Local Development (Docker - Recommended)

The entire platform can be run locally using Docker Compose with fully local services (PostgreSQL, Redis, MinIO).

### Prerequisites
- Docker & Docker Compose
- API keys for providers (Byteplus, OpenAI, Stripe, etc.)

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/hellothatsmoa/cooly-ai.git
cd cooly-ai

# 2. Copy environment template and add your API keys
cp .env.local.example .env.local
# Edit .env.local with your API keys

# 3. Start all services
docker-compose up -d --build

# 4. Wait for services to be healthy, then seed test data
./script/seed-db.sh

# 5. Access the application
# Frontend: http://localhost:3000
# Backend:  http://localhost:5001
# MinIO:    http://localhost:9001
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
- **Email:** `test@example.com`
- **Password:** `testpassword123`
- **Credits:** 1000

### Docker Commands

```bash
# View logs
docker-compose logs -f backend

# Stop all services
docker-compose down

# Full reset (including data)
docker-compose down -v

# Rebuild after code changes
docker-compose up -d --build
```

### Troubleshooting

If you encounter "column does not exist" database errors after starting Docker:

```bash
# Run the schema fix script
./script/fix-docker-schema.sh
```

This fixes migration ordering issues that can occur on fresh Docker setups.

## Local Development (Without Docker)

### Prerequisites
- Node.js 20+
- PostgreSQL database (e.g., Supabase)
- Redis (for BullMQ queue)

### Setup

```bash
# 1. Install dependencies
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# 2. Configure environment
# Create .env file in repo root with database credentials, API keys, etc.

# 3. Start services in separate terminals
cd backend && npm run dev     # nodemon on :5000
cd frontend && npm run dev    # next dev on :3000
```

## Architecture

### Enqueue-First Generation Pipeline

1. API validates request, reserves credits, inserts `outbox` row, returns 202
2. Outbox Relay polls `outbox` (FOR UPDATE SKIP LOCKED), sends to queue
3. Worker (`backend/src/queue/genWorker.js`) processes jobs, routes to handlers
4. Handlers call providers, stream media to storage, update DB, capture credits
5. NOTIFY triggers push SSE events to connected clients

### Queue System

The platform supports two queue backends:
- **BullMQ + Redis** (local/Docker): Auto-enabled when `USE_BULLMQ=true` or `SQS_MAIN_QUEUE_URL` is missing
- **AWS SQS** (production): Default when SQS URLs are configured

### Storage System

- **MinIO** (local/Docker): Enabled when `S3_ENDPOINT` is set
- **Backblaze B2** (production): Default cloud storage

## Environment Variables

Key environment variables (see `.env.local.example` for full list):

```bash
# Database
DATABASE_URL=postgresql://...
DB_SSL=false  # Set false for local

# Queue
USE_BULLMQ=true       # Use BullMQ instead of SQS
REDIS_URL=redis://...

# Storage
S3_ENDPOINT=http://minio:9000  # Custom S3 endpoint for MinIO
S3_BUCKET_NAME=cooly-local

# API Keys (required for real generation)
BYTEPLUS_APP_ID=...
OPENAI_API_KEY=...

# Mock Mode (for testing without API keys)
MOCK_API=true
MOCK_SEEDREAM4=true
```

## Testing

```bash
# Backend integration tests
cd backend && npm run test:integration

# Queue diagnostics
cd backend && npm run diag:queue
```

## Deployment

### Preview (PR-based)
- **Render**: Auto-deploys backend + gen-worker via `render.yaml`
- **Vercel**: GitHub Action deploys preview frontend

### Production
- Manual promotion from main branch
- Render dashboard for backend
- Vercel dashboard for frontend

## License

Proprietary - All Rights Reserved
