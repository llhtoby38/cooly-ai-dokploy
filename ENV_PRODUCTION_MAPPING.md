# Production Environment Variables - Quick Copy Guide

This document maps variables from your existing `.env` file to the new `.env.prod` for Dokploy deployment.

---

## Step 1: Generate New Secrets

Run these commands to generate secure production passwords:

```bash
# PostgreSQL Password
openssl rand -base64 32

# Redis Password
openssl rand -base64 32

# MinIO Root Password
openssl rand -base64 32

# JWT Secret (64 chars)
openssl rand -base64 64

# Admin Secret Key (64 chars)
openssl rand -base64 64

# Exchange JWT Secret (64 chars)
openssl rand -base64 64
```

Save these outputs - you'll use them in Step 2.

---

## Step 2: Copy and Configure `.env.prod`

```bash
# Start with the template
cp .env.prod.example .env.prod
```

Now edit `.env.prod` with the following values:

### 🌐 Domain Configuration (CHANGE THESE)

```bash
# Replace test.cooly.ai with your actual domain
DOMAIN=test.cooly.ai
API_DOMAIN=api.test.cooly.ai
MINIO_DOMAIN=minio.test.cooly.ai
MINIO_CONSOLE_DOMAIN=minio-console.test.cooly.ai
```

---

### 🔒 Infrastructure Secrets (USE GENERATED VALUES)

```bash
# Database (use generated password from Step 1)
POSTGRES_USER=cooly
POSTGRES_PASSWORD=<paste-generated-password-1>
POSTGRES_DB=cooly_prod
DATABASE_URL=postgresql://cooly:<paste-same-password-1>@postgres:5432/cooly_prod

# Redis (use generated password from Step 1)
REDIS_PASSWORD=<paste-generated-password-2>
REDIS_URL=redis://:<paste-same-password-2>@redis:6379

# MinIO (use generated password from Step 1)
MINIO_ROOT_USER=cooly_admin
MINIO_ROOT_PASSWORD=<paste-generated-password-3>
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_URL=https://minio.test.cooly.ai  # Match MINIO_DOMAIN
S3_FORCE_PATH_STYLE=true
S3_BUCKET_NAME=cooly-prod
S3_ACCESS_KEY_ID=cooly_admin  # Same as MINIO_ROOT_USER
S3_SECRET_ACCESS_KEY=<paste-same-password-3>  # Same as MINIO_ROOT_PASSWORD
S3_REGION=us-east-1

# B2 vars (code fallback - use same MinIO credentials)
B2_BUCKET_NAME=cooly-prod
B2_REGION=us-east-1
B2_ACCESS_KEY_ID=cooly_admin
B2_SECRET_ACCESS_KEY=<paste-same-password-3>
```

---

### 🔐 JWT & Security (USE GENERATED VALUES)

```bash
# From Step 1
JWT_SECRET=<paste-generated-secret-1>
ADMIN_SECRET_KEY=<paste-generated-secret-2>
EXCHANGE_JWT_SECRET=<paste-generated-secret-3>
```

---

### 📋 Copy from `.env` (Line-by-Line)

#### Byteplus (Lines 6-15 from .env)

```bash
BYTEPLUS_APP_ID=5223964487
BYTEPLUS_ACCESS_TOKEN=D6CzYRTSTy4ggHcaxwy9nOZYqfTl665H
BYTEPLUS_SECRET_KEY=gtbxKTVMgNVoGawfDCPYchCkJPSBo-5L
BYTEPLUS_ARK_API_KEY=23277266-f23c-421a-a50c-6fdddfb17c3a

SEEDANCE_API_BASE=https://ark.ap-southeast.bytepluses.com
SEEDANCE_CREATE_PATHS=/api/v3/contents/generations/tasks
SEEDANCE_TASK_PATHS=/api/v3/contents/generations/tasks/{taskId}
SEEDANCE_API_KEY=23277266-f23c-421a-a50c-6fdddfb17c3a
SEEDANCE_ENDPOINT_ID=ep-m-20250913202654-vhz2w
```

#### Seedream 4.0 (Lines 116-118 from .env)

```bash
SEEDREAM4_API_KEY=23277266-f23c-421a-a50c-6fdddfb17c3a
SEEDREAM4_MODEL_ID=seedream-4-0-250828
SEEDREAM4_API_BASE=https://ark.ap-southeast.bytepluses.com
```

#### Stripe - USE LIVE KEYS (Lines 46-47 from .env)

```bash
# ⚠️ PRODUCTION USES LIVE KEYS, NOT SANDBOX
STRIPE_SECRET_KEY=<your-stripe-LIVE-secret-key>
STRIPE_PUBLISHABLE_KEY=<your-stripe-LIVE-publishable-key>
STRIPE_WEBHOOK_SECRET=<your-stripe-webhook-secret>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<your-stripe-LIVE-publishable-key>
```

#### Google OAuth (Lines 92-97 from .env)

```bash
GOOGLE_CLIENT_ID=1043279689901-m605vmss4qcb8ld88si648t8nit1rir8.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
APP_BASE_URL=https://api.test.cooly.ai  # ⚠️ CHANGE to your API domain
GOOGLE_REDIRECT_URI=https://api.test.cooly.ai/api/auth/google/callback  # ⚠️ CHANGE
FRONTEND_BASE_URL=https://test.cooly.ai  # ⚠️ CHANGE to your domain
```

#### SMTP Email (Lines 100-105 from .env)

```bash
SMTP_HOST=smtppro.zoho.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=support@cooly.ai
SMTP_PASS=CoolyA!1126
EMAIL_FROM=support@cooly.ai
```

#### Google Cloud / Veo 3.1 (Lines 108-113 from .env)

```bash
VIDEO_PROVIDER=google
GOOGLE_PROJECT_ID=cooly-ai
GOOGLE_CLOUD_PROJECT=cooly-ai
GOOGLE_LOCATION=us-central1
# ⚠️ You'll need to mount the GCP service account JSON in Docker
# GOOGLE_APPLICATION_CREDENTIALS=/app/credentials/gcp-service-account.json
```

**Note**: For GOOGLE_APPLICATION_CREDENTIALS, you'll need to:
1. Copy `cooly-ai-e581f81319e3.json` to your VM
2. Mount it in docker-compose (or include in .env.prod as base64-encoded JSON)

#### kie.ai Veo Provider (Lines 65-67 from .env)

```bash
KIE_API_KEY=fa568d847df5816f414eaf3e3b2cc644
KIE_API_BASE=https://api.kie.ai
KIE_ENABLE_FALLBACK=true
```

#### OpenAI / Sora 2 (Lines 152-167 from .env)

```bash
OPENAI_API_KEY=<your-openai-api-key>
# ⚠️ Change API base to standard OpenAI endpoint
OPENAI_API_BASE=https://api.openai.com/v1

SORA_PROVIDER=wavespeed
FAL_SORA_MODEL=fal-ai/sora-2/text-to-video
FAL_SORA_MODEL_PRO=fal-ai/sora-2/text-to-video/pro
FAL_KEY=<your-fal-api-key>
WAVESPEED_API_KEY=<your-wavespeed-api-key>
```

#### Sanity CMS (Lines 171-176 from .env)

```bash
NEXT_PUBLIC_SANITY_PROJECT_ID=zlcfuo6a
NEXT_PUBLIC_SANITY_DATASET=production
NEXT_PUBLIC_SANITY_API_VERSION=2025-01-01
SANITY_READ_TOKEN=yourReadToken
REVALIDATE_SECRET=yourWebhookSecret
```

#### PostHog Analytics (Lines 179-185 from .env)

```bash
NEXT_PUBLIC_POSTHOG_KEY=phc_d5cO7hyefe24Jtp19VkECPjhNF3Q7xq77uGVSZ7wmIP
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
POSTHOG_KEY=phc_d5cO7hyefe24Jtp19VkECPjhNF3Q7xq77uGVSZ7wmIP
POSTHOG_HOST=https://app.posthog.com
POSTHOG_IP_SALT=c905a6455a281acbf8d00dbd07cd78e31eb41ce5ec60913867b6779099bf86c1
```

#### Admin Access (Lines 120-121 from .env)

```bash
ADMIN_EMAIL=admin@cooly.ai
ADMIN_PASSWORD=Mmt.of.ahaaa1126
```

---

### ⚙️ Production Configuration (Keep as-is)

```bash
NODE_ENV=production
PORT=5000
LOG_LEVEL=info  # Change from 'debug' to 'info' for production
DEFAULT_FREE_CREDITS=10

# Workers
START_GEN_WORKER=true
START_OUTBOX_RELAY=true
GEN_WORKER_CONCURRENCY=5
ENABLE_CAPTURE_WORKER=true
ENABLE_SESSION_SWEEPER=true
ENABLE_ENQUEUE_FIRST=true
ENABLE_OUTBOX=true
FORCE_OUTBOX_ONLY=true

# Database retry
PG_RETRY_ATTEMPTS=5
PG_RETRY_BASE_MS=250
PG_RETRY_JITTER_MS=250

# CORS (update with your domain)
FRONTEND_URL=https://test.cooly.ai
ALLOWED_ORIGINS=https://test.cooly.ai,https://www.test.cooly.ai
COOKIE_DOMAIN=test.cooly.ai

# Mock mode (keep false for production)
MOCK_API=false
MOCK_VIDEO=false
MOCK_SEEDREAM4=false
MOCK_SEEDREAM3=false
MOCK_SORA=false

# Frontend public vars (update with your domain)
NEXT_PUBLIC_API_BASE=https://api.test.cooly.ai
NEXT_PUBLIC_MOCK_API=false
NEXT_PUBLIC_DEBUG_LOGS=false
NEXT_PUBLIC_SORA2_HIDE_PRO=true
```

---

## Variables NOT Needed in `.env.prod`

These are specific to your current production stack and NOT needed for Dokploy:

❌ **Skip these from .env**:
- `PREVIEW_DATABASE_URL` (Supabase - using local PostgreSQL instead)
- `PRODUCTION_URL` (Supabase - using local PostgreSQL instead)
- `RENDER_*` (Render-specific - using Dokploy instead)
- `AWS_IAM_COOLY_*` (AWS SQS - using BullMQ+Redis instead)
- `SQS_MAIN_QUEUE_URL` (AWS SQS - using BullMQ+Redis instead)
- `SQS_DLQ_QUEUE_URL` (AWS SQS - using BullMQ+Redis instead)
- `B2_ACCESS_KEY_ID` (Backblaze B2 - using MinIO instead)
- `B2_SECRET_ACCESS_KEY` (Backblaze B2 - using MinIO instead)
- `B2_ENDPOINT` (Backblaze B2 - using MinIO instead)

---

## Quick Checklist

Before deploying, verify you have:

- [ ] All 3 generated passwords saved (PostgreSQL, Redis, MinIO)
- [ ] All 3 generated secrets saved (JWT, Admin, Exchange)
- [ ] Domain names updated (4 places: DOMAIN, API_DOMAIN, MINIO_DOMAIN, MINIO_CONSOLE_DOMAIN)
- [ ] All Byteplus keys copied
- [ ] Stripe LIVE keys (not sandbox)
- [ ] Google OAuth credentials updated with new redirect URI
- [ ] SMTP credentials copied
- [ ] OpenAI API key copied
- [ ] Sanity CMS credentials copied
- [ ] Admin email/password set

---

## Final `.env.prod` File Size

Your complete `.env.prod` should have approximately **80-90 lines** after filling in all values.

---

## Next Steps

1. ✅ Generate all secrets (Step 1)
2. ✅ Fill in `.env.prod` using this guide
3. ✅ Update Google OAuth redirect URI in Google Cloud Console:
   - Old: `https://api.cooly.ai/api/auth/google/callback`
   - New: `https://api.test.cooly.ai/api/auth/google/callback`
4. ✅ Commit deployment files to Git:
   ```bash
   git add docker-compose.prod.yml .env.prod.example DOKPLOY_DEPLOYMENT_GUIDE.md ENV_PRODUCTION_MAPPING.md
   git commit -m "Add production deployment configuration for Dokploy"
   git push origin feat/contract-completion
   ```
5. ✅ Follow [DOKPLOY_DEPLOYMENT_GUIDE.md](./DOKPLOY_DEPLOYMENT_GUIDE.md)

---

## Quick Copy Commands

```bash
# Generate all secrets at once
echo "=== PostgreSQL Password ===" && openssl rand -base64 32 && \
echo "=== Redis Password ===" && openssl rand -base64 32 && \
echo "=== MinIO Password ===" && openssl rand -base64 32 && \
echo "=== JWT Secret ===" && openssl rand -base64 64 && \
echo "=== Admin Secret ===" && openssl rand -base64 64 && \
echo "=== Exchange JWT Secret ===" && openssl rand -base64 64
```

Save the output of this command - you'll paste these into `.env.prod`.
