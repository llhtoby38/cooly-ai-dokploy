# Cooly AI - Complete Deployment Options Guide

This guide compares all deployment architectures for Cooly AI and provides step-by-step instructions for each.

---

## Table of Contents

1. [Deployment Architecture Comparison](#deployment-architecture-comparison)
2. [Option 1: Production (Current - AWS Services)](#option-1-production-current---aws-services)
3. [Option 2: Full VPS (Dokploy - All Self-Hosted)](#option-2-full-vps-dokploy---all-self-hosted)
4. [Option 3: Hybrid (Render + VPS)](#option-3-hybrid-render--vps)
5. [Cost Comparison](#cost-comparison)
6. [Performance Comparison](#performance-comparison)
7. [Decision Matrix](#decision-matrix)

---

## Deployment Architecture Comparison

### Option 1: Production (Current - AWS Services)

```
┌─────────────────────────────────────────────────────────────┐
│                     PRODUCTION STACK                         │
├─────────────────────────────────────────────────────────────┤
│  Frontend:    Vercel (Next.js)                              │
│  Backend:     Render Web Service + Worker                   │
│  Database:    Supabase (PostgreSQL)                         │
│  Queue:       AWS SQS + Upstash Redis                       │
│  Storage:     Backblaze B2                                  │
│  Cache:       Upstash Redis                                 │
└─────────────────────────────────────────────────────────────┘
```

**Characteristics**:
- ✅ Managed services (minimal ops)
- ✅ Auto-scaling
- ✅ High availability
- ❌ Expensive ($85/month+)
- ❌ Multiple billing accounts
- ❌ Complex inter-service networking

---

### Option 2: Full VPS (Dokploy - All Self-Hosted)

```
┌─────────────────────────────────────────────────────────────┐
│                   SINGLE VPS (Dokploy)                       │
├─────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────┐    │
│  │  Traefik (SSL + Reverse Proxy)                     │    │
│  ├────────────────────────────────────────────────────┤    │
│  │  Frontend:   Next.js Container                      │    │
│  │  Backend:    Express Container                      │    │
│  │  Database:   PostgreSQL Container                   │    │
│  │  Queue:      Redis Container (BullMQ)              │    │
│  │  Storage:    MinIO Container                        │    │
│  │  Workers:    Gen Worker + Sweepers                  │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Characteristics**:
- ✅ Low cost ($15-50/month)
- ✅ Full control
- ✅ Simple networking (all in one network)
- ✅ Single billing source
- ❌ Manual scaling
- ❌ Single point of failure
- ❌ You manage backups

**Best For**: Testing, staging, small deployments, budget-conscious

---

### Option 3: Hybrid (Render + VPS)

```
┌─────────────────────────────────────────────────────────────┐
│                    RENDER SERVICES                           │
├─────────────────────────────────────────────────────────────┤
│  Frontend:    Render Web Service (Next.js)                  │
│  Backend:     Render Web Service (Express API)              │
│  Database:    Render PostgreSQL                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Network Connection
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      VPS (Docker)                            │
├─────────────────────────────────────────────────────────────┤
│  Redis:       BullMQ Queue (exposed port)                   │
│  MinIO:       S3-compatible Storage (exposed port)          │
│  Workers:     Gen Worker + Outbox Relay + Sweepers          │
└─────────────────────────────────────────────────────────────┘
```

**Characteristics**:
- ✅ Managed web hosting (Render)
- ✅ Cost-effective workers (VPS)
- ✅ Auto-scaling frontend/backend
- ✅ Best of both worlds
- ⚠️ Network latency between Render and VPS
- ⚠️ Two systems to manage
- ⚠️ VPS must expose Redis/MinIO publicly (security concern)

**Best For**: Production with cost optimization, separating web tier from workers

---

## Option 1: Production (Current - AWS Services)

### Architecture

```
                    ┌──────────────┐
                    │   Vercel     │
                    │  (Frontend)  │
                    └──────┬───────┘
                           │
                           │ HTTPS
                           │
                    ┌──────▼───────┐
                    │    Render    │
                    │ (Backend API)│
                    └──┬────────┬──┘
                       │        │
         ┌─────────────┘        └─────────────┐
         │                                      │
    ┌────▼─────┐                         ┌────▼─────┐
    │ Supabase │                         │ AWS SQS  │
    │   (DB)   │                         │ (Queue)  │
    └──────────┘                         └────┬─────┘
                                              │
                                         ┌────▼─────┐
                                         │  Render  │
                                         │ (Worker) │
                                         └────┬─────┘
                                              │
                                         ┌────▼─────┐
                                         │    B2    │
                                         │(Storage) │
                                         └──────────┘
```

### Components

| Component | Service | Purpose |
|-----------|---------|---------|
| Frontend | Vercel | Next.js hosting with edge functions |
| Backend | Render Web | Express API server |
| Worker | Render Worker | Background job processing |
| Database | Supabase | Managed PostgreSQL |
| Queue | AWS SQS | Message queue for jobs |
| Cache | Upstash Redis | Session cache, rate limiting |
| Storage | Backblaze B2 | Generated media files |

### Setup Instructions

**1. Already Configured** - This is your current production setup.

**2. Environment Variables**:
- See your existing `.env` file (lines 1-213)
- Supabase: `PRODUCTION_URL` (line 33)
- AWS SQS: `SQS_MAIN_QUEUE_URL`, `SQS_DLQ_QUEUE_URL` (lines 207-208)
- Backblaze B2: `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY` (lines 73-74)

**3. Deploy Updates**:
```bash
# Backend (Render)
git push origin main  # Triggers auto-deploy

# Frontend (Vercel)
npx vercel --prod
```

### Pros & Cons

**Pros**:
- ✅ Fully managed (minimal DevOps)
- ✅ Auto-scaling (handles traffic spikes)
- ✅ High availability (99.9% uptime)
- ✅ Global CDN (Vercel Edge)
- ✅ Managed backups (Supabase)
- ✅ DDoS protection included

**Cons**:
- ❌ **Expensive**: $85+/month
  - Render: $50/month (web + worker)
  - Supabase: $25/month
  - Upstash: $10/month
  - Vercel: $20/month (hobby free, but scales)
  - AWS SQS: $5-10/month
  - Backblaze B2: $5/month
- ❌ Vendor lock-in (multiple services)
- ❌ Complex pricing (hard to predict)
- ❌ Inter-service latency (SQS in us-west-2, DB in Singapore)

**When to Use**:
- High traffic production (>1000 daily users)
- Enterprise SLA requirements
- Team doesn't have DevOps expertise
- Budget is not a constraint

---

## Option 2: Full VPS (Dokploy - All Self-Hosted)

### Architecture

```
                ┌──────────────────────────────┐
                │    VPS (Single Server)       │
                ├──────────────────────────────┤
                │  ┌────────────────────────┐ │
                │  │  Traefik (Port 80/443) │ │
                │  └────────┬───────────────┘ │
                │           │                  │
   ┌────────────┼───────────┼──────────────┐  │
   │            │           │              │  │
┌──▼──┐    ┌───▼──┐    ┌──▼───┐    ┌────▼─┐ │
│Next │    │Express│    │Postgres│  │MinIO │ │
│(3000)│   │(5000) │    │(5432)  │  │(9000)│ │
└──────┘    └───┬──┘    └────────┘  └──────┘ │
                │                              │
           ┌────▼─────┐                        │
           │  Redis   │                        │
           │  (6379)  │                        │
           └────┬─────┘                        │
                │                              │
           ┌────▼─────┐                        │
           │ Workers  │                        │
           └──────────┘                        │
                │                              │
                └──────────────────────────────┘
```

### Components

All running in Docker containers on a single VPS:

| Container | Port | Purpose |
|-----------|------|---------|
| traefik | 80, 443 | SSL termination, reverse proxy |
| frontend | 3000 | Next.js application |
| backend | 5000 | Express API |
| postgres | 5432 | PostgreSQL database |
| redis | 6379 | BullMQ queue |
| minio | 9000, 9001 | S3-compatible storage |
| gen-worker | - | Background job processor |

### Setup Instructions

**Full guide**: See [DOKPLOY_DEPLOYMENT_GUIDE.md](./DOKPLOY_DEPLOYMENT_GUIDE.md)

**Quick Start**:

```bash
# 1. Provision VPS (Hetzner recommended)
# - 4 vCPU, 8GB RAM, 80GB SSD
# - Ubuntu 22.04
# - €14/month (~$15)

# 2. Install Dokploy
ssh root@<VPS_IP>
curl -sSL https://dokploy.com/install.sh | sh

# 3. Configure DNS
# Point domain to VPS IP:
#   test.cooly.ai -> VPS_IP
#   api.test.cooly.ai -> VPS_IP
#   minio.test.cooly.ai -> VPS_IP
#   minio-console.test.cooly.ai -> VPS_IP

# 4. Configure environment
cp .env.prod.example .env.prod
# Edit .env.prod (see ENV_PRODUCTION_MAPPING.md)

# 5. Deploy via Dokploy dashboard
# - Create project
# - Connect Git repo (feat/contract-completion branch)
# - Upload .env.prod
# - Deploy (auto-builds + SSL)

# 6. Seed database
docker exec cooly-backend-prod sh -c "cd /app/script && ./seed-db.sh"
```

### Pros & Cons

**Pros**:
- ✅ **Low cost**: $15-50/month (one VPS)
- ✅ Full control over infrastructure
- ✅ Simple architecture (one network)
- ✅ No vendor lock-in
- ✅ Easy local development (same stack)
- ✅ SSL included (Let's Encrypt)
- ✅ Single point of management

**Cons**:
- ❌ Single point of failure
- ❌ Manual scaling (vertical only)
- ❌ You manage backups
- ❌ You handle security updates
- ❌ Limited to one region
- ❌ No auto-scaling

**When to Use**:
- Testing/staging environments
- Small to medium traffic (<500 daily users)
- Budget-conscious deployments
- Want full infrastructure control
- Learning/experimentation

### Recommended VPS Providers

| Provider | Plan | Price | Region |
|----------|------|-------|--------|
| **Hetzner** ⭐ | CPX31 | €14/month | EU (Germany) |
| DigitalOcean | 4 CPU, 8GB | $48/month | Global (8 regions) |
| Linode | 4 CPU, 8GB | $36/month | Global (11 regions) |
| Vultr | 4 vCPU, 8GB | $24/month | Global (25 regions) |

**Recommendation**: Hetzner CPX31 (best value)

---

## Option 3: Hybrid (Render + VPS)

### Architecture

```
        ┌─────────────────────────────────────┐
        │         RENDER.COM                  │
        ├─────────────────────────────────────┤
        │  ┌────────────┐    ┌─────────────┐ │
        │  │  Frontend  │    │  Backend    │ │
        │  │  (Next.js) │    │  (Express)  │ │
        │  └────────────┘    └──────┬──────┘ │
        │         │                 │         │
        │  ┌──────▼─────────────────▼──────┐ │
        │  │    PostgreSQL (Managed)       │ │
        │  └───────────────────────────────┘ │
        └──────────────┬──────────────────────┘
                       │
                       │ Public Internet
                       │ (Redis + MinIO exposed)
                       │
        ┌──────────────▼──────────────────────┐
        │         VPS (Docker)                │
        ├─────────────────────────────────────┤
        │  ┌────────────┐    ┌─────────────┐ │
        │  │   Redis    │    │    MinIO    │ │
        │  │ (Port 6379)│    │ (Port 9000) │ │
        │  └──────┬─────┘    └──────┬──────┘ │
        │         │                 │         │
        │  ┌──────▼─────────────────▼──────┐ │
        │  │         Workers                │ │
        │  │  - Gen Worker                  │ │
        │  │  - Outbox Relay                │ │
        │  │  - Capture Worker              │ │
        │  │  - Session Sweeper             │ │
        │  └────────────────────────────────┘ │
        └─────────────────────────────────────┘
```

### Components

**Render (Managed)**:
- Frontend (Next.js)
- Backend API (Express)
- PostgreSQL Database

**VPS (Self-Hosted)**:
- Redis (BullMQ queue)
- MinIO (S3 storage)
- Workers (background processing)

### Setup Instructions

#### Part 1: Setup VPS Workers

```bash
# 1. Provision VPS
# Smaller VPS is fine (2 CPU, 4GB RAM, 40GB SSD)
# Cost: €7/month (Hetzner) or $12/month (DigitalOcean)

# 2. Install Docker
ssh root@<VPS_IP>
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# 3. Clone repository
git clone https://github.com/your-org/cooly-ai.git
cd cooly-ai
git checkout feat/contract-completion

# 4. Configure environment
cp .env.workers.example .env.workers
nano .env.workers

# Set these values:
# - REDIS_PASSWORD: <generate-strong-password>
# - MINIO_ROOT_USER: cooly_admin
# - MINIO_ROOT_PASSWORD: <generate-strong-password>
# - S3_PUBLIC_URL: http://<VPS_IP>:9000
# - Copy all API keys from production

# 5. Start workers
docker-compose -f docker-compose.workers.yml up -d --build

# 6. Verify services
docker ps  # All containers should be "healthy"
docker logs cooly-gen-worker  # Check for errors
```

#### Part 2: Configure Render

```bash
# 1. Prepare render.yaml
cp render.hybrid.yaml render.yaml

# 2. Update environment variables in Render dashboard
# Go to: https://dashboard.render.com/

# Key variables to set:
REDIS_URL=redis://:YOUR_REDIS_PASSWORD@YOUR_VPS_IP:6379
S3_ENDPOINT=http://YOUR_VPS_IP:9000
S3_PUBLIC_URL=http://YOUR_VPS_IP:9000
B2_ACCESS_KEY_ID=cooly_admin
B2_SECRET_ACCESS_KEY=<your-minio-password>

# Disable workers on Render:
START_GEN_WORKER=false
START_OUTBOX_RELAY=false
ENABLE_CAPTURE_WORKER=false
ENABLE_SESSION_SWEEPER=false

# 3. Deploy to Render
git add render.yaml
git commit -m "Configure hybrid deployment"
git push origin main
# Render auto-deploys
```

#### Part 3: Network Configuration

**Important**: VPS must expose Redis and MinIO to Render.

**Option A: Expose ports directly** (Simpler, less secure):
```bash
# Firewall rules (UFW)
ufw allow 6379/tcp  # Redis
ufw allow 9000/tcp  # MinIO API
ufw allow 9001/tcp  # MinIO Console
```

**Option B: VPN tunnel** (More secure):
```bash
# Use Tailscale or WireGuard to create private network
# Render → VPN → VPS
# Redis/MinIO not exposed to public internet
```

**Option C: IP whitelist** (Best security):
```bash
# Get Render's outbound IPs:
# https://render.com/docs/outbound-static-ips

# Allow only Render IPs
ufw allow from <RENDER_IP_1> to any port 6379
ufw allow from <RENDER_IP_2> to any port 6379
ufw allow from <RENDER_IP_1> to any port 9000
ufw allow from <RENDER_IP_2> to any port 9000
```

### Pros & Cons

**Pros**:
- ✅ **Balanced cost**: $40-60/month
  - Render: $25-35/month (no workers)
  - VPS: $7-15/month (workers only)
- ✅ Managed web tier (Render)
- ✅ Cost-effective workers (VPS)
- ✅ Frontend/backend auto-scaling
- ✅ Render manages database backups
- ✅ Best of both worlds

**Cons**:
- ⚠️ Network latency (Render ↔ VPS)
- ⚠️ VPS must expose Redis/MinIO publicly
- ⚠️ Two systems to manage
- ⚠️ More complex architecture
- ⚠️ Potential security concerns (exposed Redis)

**When to Use**:
- Cost optimization for production
- Want managed web tier + cheap workers
- Traffic is moderate (100-500 daily users)
- Comfortable with hybrid management

### Security Hardening

**Redis**:
```bash
# In .env.workers:
REDIS_PASSWORD=<very-strong-password>

# In docker-compose.workers.yml:
# Redis already configured with password + bind 0.0.0.0
```

**MinIO**:
```bash
# Use strong credentials
MINIO_ROOT_USER=cooly_admin_$(openssl rand -hex 4)
MINIO_ROOT_PASSWORD=$(openssl rand -base64 32)

# Enable bucket policies (read-only public access)
mc anonymous set download local/cooly-prod
```

**Firewall**:
```bash
# Recommended: Whitelist Render IPs only
ufw default deny incoming
ufw allow 22/tcp  # SSH
ufw allow from <RENDER_IP> to any port 6379
ufw allow from <RENDER_IP> to any port 9000
ufw enable
```

---

## Cost Comparison

| Component | Option 1 (Production) | Option 2 (Full VPS) | Option 3 (Hybrid) |
|-----------|----------------------|---------------------|-------------------|
| **Frontend** | Vercel: $20/mo | Included | Render: $7/mo |
| **Backend** | Render: $25/mo | Included | Render: $7/mo |
| **Database** | Supabase: $25/mo | Included | Render: $7/mo |
| **Queue** | SQS+Upstash: $15/mo | Included | VPS: $7/mo |
| **Storage** | B2: $5/mo | Included | VPS: $7/mo |
| **Workers** | Render: $25/mo | Included | VPS: $7/mo |
| **VPS** | - | Hetzner: $15/mo | Hetzner: $7/mo |
| **TOTAL** | **$85-115/mo** | **$15-50/mo** | **$35-60/mo** |
| **Savings** | Baseline | **82-85% cheaper** | **48-60% cheaper** |

### Cost Breakdown by Traffic

| Daily Users | Option 1 | Option 2 | Option 3 | Recommendation |
|-------------|----------|----------|----------|----------------|
| 0-100 | $85/mo | $15/mo ✅ | $35/mo | **Option 2** (overkill to pay more) |
| 100-500 | $95/mo | $30/mo | $45/mo ✅ | **Option 3** (balanced) |
| 500-2000 | $115/mo | $50/mo ✅ | $60/mo | **Option 2** or **3** |
| 2000+ | $150/mo ✅ | $100+/mo | $80/mo | **Option 1** (need auto-scale) |

---

## Performance Comparison

### Response Time (API)

| Metric | Option 1 | Option 2 | Option 3 |
|--------|----------|----------|----------|
| **Backend API** | 50-100ms | 20-50ms ✅ | 30-80ms |
| **Database Query** | 10-30ms | 5-15ms ✅ | 10-25ms |
| **Image Generation** | 30-35s | 30-32s ✅ | 30-35s |
| **Static Assets** | 50ms (CDN) ✅ | 100-200ms | 80ms |

**Notes**:
- Option 2 has lowest latency (all in one network)
- Option 1 best for static assets (Vercel Edge CDN)
- Option 3 has Redis/MinIO network overhead

### Throughput

| Metric | Option 1 | Option 2 | Option 3 |
|--------|----------|----------|----------|
| **Concurrent Users** | 1000+ ✅ | 100-500 | 200-800 |
| **Worker Concurrency** | 10+ ✅ | 5-10 | 5-10 |
| **Auto-Scaling** | Yes ✅ | No | Partial |

---

## Decision Matrix

### Choose Option 1 (Production - AWS Services) if:

- ✅ Budget is not a primary concern ($85-150/month OK)
- ✅ Need high availability (99.9% uptime SLA)
- ✅ Traffic is high or unpredictable (>500 daily users)
- ✅ Need global CDN (users worldwide)
- ✅ Want fully managed (minimal DevOps)
- ✅ Enterprise/commercial production
- ❌ Don't mind vendor lock-in

**Best For**: High-traffic production, enterprise, hands-off management

---

### Choose Option 2 (Full VPS - Dokploy) if:

- ✅ Budget-conscious ($15-50/month)
- ✅ Traffic is predictable and moderate (<500 daily users)
- ✅ Want full infrastructure control
- ✅ Comfortable with Docker/DevOps
- ✅ Need staging/testing environment
- ✅ Want to avoid vendor lock-in
- ✅ Same stack as local development
- ❌ OK with manual scaling
- ❌ Can handle single point of failure

**Best For**: Testing, staging, small production, learning, budget deployments

---

### Choose Option 3 (Hybrid - Render + VPS) if:

- ✅ Want balanced cost ($35-60/month)
- ✅ Traffic is moderate (100-800 daily users)
- ✅ Want managed web tier + cheap workers
- ✅ Need auto-scaling frontend/backend
- ✅ Comfortable managing two systems
- ✅ Want cost optimization for production
- ⚠️ Can accept minor network latency
- ⚠️ OK with VPS exposing Redis/MinIO

**Best For**: Cost-optimized production, growing startups, hybrid management

---

## Migration Path

### Current → Testing (Full VPS)

**Purpose**: Test contract improvements before production

```bash
# 1. Deploy to VPS with Dokploy (DOKPLOY_DEPLOYMENT_GUIDE.md)
# 2. Use domain: test.cooly.ai
# 3. Seed with test user
# 4. Have users compare with production
# 5. Collect performance data
```

### Current → Hybrid (Cost Optimization)

**Purpose**: Reduce costs while keeping Render frontend/backend

```bash
# 1. Deploy workers to VPS (docker-compose.workers.yml)
# 2. Update Render environment (render.hybrid.yaml)
# 3. Test Redis/MinIO connectivity
# 4. Gradual cutover (monitor for 48 hours)
# 5. Decommission AWS SQS + Upstash + B2
```

### Current → Full VPS (Maximum Savings)

**Purpose**: Maximum cost reduction, full control

```bash
# 1. Deploy to VPS with Dokploy (full stack)
# 2. Test thoroughly on staging domain
# 3. Set up database backups
# 4. Point DNS to VPS
# 5. Monitor for 1 week
# 6. Decommission Render + Vercel + Supabase
```

---

## Quick Start Commands

### Option 1 (Production - Current)
```bash
# Already deployed - no changes needed
# Update code:
git push origin main  # Auto-deploys to Render
npx vercel --prod     # Deploy to Vercel
```

### Option 2 (Full VPS - Dokploy)
```bash
# See: DOKPLOY_DEPLOYMENT_GUIDE.md
curl -sSL https://dokploy.com/install.sh | sh
# Configure via dashboard at http://<VPS_IP>:3000
```

### Option 3 (Hybrid - Render + VPS)
```bash
# VPS side:
docker-compose -f docker-compose.workers.yml up -d --build

# Render side:
# Update environment variables in dashboard
# Push render.hybrid.yaml to trigger redeploy
```

---

## Support & Troubleshooting

### Option 1 (Production)
- Render Docs: https://render.com/docs
- Supabase Docs: https://supabase.com/docs
- Vercel Docs: https://vercel.com/docs

### Option 2 (Full VPS)
- Dokploy Docs: https://docs.dokploy.com
- Dokploy Discord: https://discord.gg/dokploy
- See: DOKPLOY_DEPLOYMENT_GUIDE.md (troubleshooting section)

### Option 3 (Hybrid)
- Render + VPS combination
- Check connectivity: `telnet <VPS_IP> 6379`
- Monitor logs: `docker logs -f cooly-gen-worker`

---

## Recommended Strategy

**For Your Use Case** (testing contract improvements):

1. **Phase 1: Deploy to Full VPS** (Option 2)
   - Use domain: `test.cooly.ai`
   - Users compare production vs testing
   - Collect performance data
   - **Timeline**: This week

2. **Phase 2: Evaluate Results**
   - If improvements confirmed → Plan production migration
   - If cost reduction desired → Consider hybrid (Option 3)
   - **Timeline**: 1-2 weeks

3. **Phase 3: Production Decision**
   - Keep current (Option 1): If traffic/scale requires managed
   - Migrate to hybrid (Option 3): If cost optimization needed
   - Migrate to VPS (Option 2): If full control + max savings
   - **Timeline**: After user testing complete

---

**Next Steps**:

1. ✅ Review this guide
2. ✅ Decide on deployment option for testing
3. ✅ Follow respective deployment guide:
   - Option 2: [DOKPLOY_DEPLOYMENT_GUIDE.md](./DOKPLOY_DEPLOYMENT_GUIDE.md)
   - Option 3: See "Setup Instructions" in Option 3 section above
4. ✅ Deploy and test
5. ✅ Collect feedback
6. ✅ Make production migration decision

---

**Questions?** Open an issue or consult the respective deployment guide.
