# Hybrid Deployment Guide - Render + VPS

**Architecture**: Render handles web services (Frontend, Backend, Database), VPS handles workers and storage (Redis, MinIO, Workers)

**Cost**: ~$35-60/month (vs $85+ for full managed)

**Best For**: Cost-optimized production with managed web tier

---

## Quick Architecture Overview

```
RENDER (Managed - $25-35/mo)
├─ Frontend (Next.js)
├─ Backend API (Express)
└─ PostgreSQL Database
         │
         │ Network (Public Internet)
         │
VPS (Self-Hosted - $7-15/mo)
├─ Redis (Queue)
├─ MinIO (Storage)
└─ Workers
   ├─ Gen Worker
   ├─ Outbox Relay
   ├─ Capture Worker
   └─ Session Sweeper
```

---

## Prerequisites

- Existing Render account with backend + frontend deployed
- VPS with 2+ CPU, 4GB+ RAM (Hetzner CPX21 recommended: €7/mo)
- Domain/subdomain for VPS (optional, can use IP)
- API keys from production `.env`

---

## Part 1: Setup VPS Workers (30 minutes)

### Step 1: Provision VPS

**Recommended Providers**:
- **Hetzner CPX21**: €7/month (2 vCPU, 4GB RAM, 80GB SSD) ⭐ Best value
- **DigitalOcean Droplet**: $12/month (2 CPU, 2GB RAM, 50GB SSD)
- **Linode Nanode**: $12/month (2 CPU, 4GB RAM, 80GB SSD)

**OS**: Ubuntu 22.04 LTS

### Step 2: Initial Server Setup

```bash
# SSH into VPS
ssh root@<VPS_IP>

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install -y docker-compose

# Configure firewall
ufw allow 22/tcp    # SSH
ufw allow 6379/tcp  # Redis
ufw allow 9000/tcp  # MinIO API
ufw allow 9001/tcp  # MinIO Console
ufw enable
```

### Step 3: Clone Repository

```bash
# Clone your repo
git clone https://github.com/your-org/cooly-ai.git
cd cooly-ai

# Checkout branch with improvements
git checkout feat/contract-completion
```

### Step 4: Configure Environment

```bash
# Copy template
cp .env.workers.example .env.workers

# Edit environment file
nano .env.workers
```

**Required values**:

```bash
# Database (from Render PostgreSQL)
DATABASE_URL=postgresql://user:password@region.render.com:5432/dbname

# Generate strong passwords
REDIS_PASSWORD=$(openssl rand -base64 32)
MINIO_ROOT_USER=cooly_admin
MINIO_ROOT_PASSWORD=$(openssl rand -base64 32)

# Public URLs (use VPS IP or domain)
S3_PUBLIC_URL=http://<VPS_IP>:9000

# JWT (copy from Render backend)
JWT_SECRET=<same-as-render>

# API Keys (copy from production .env)
BYTEPLUS_APP_ID=<from-production>
BYTEPLUS_ACCESS_TOKEN=<from-production>
# ... (copy all API keys)
```

**Get Render Database URL**:
1. Go to Render Dashboard → Your Database
2. Copy "External Database URL"
3. Paste as `DATABASE_URL` in `.env.workers`

### Step 5: Start Workers

```bash
# Build and start all services
docker-compose -f docker-compose.workers.yml up -d --build

# Check status (all should be "healthy")
docker ps

# View logs
docker logs -f cooly-gen-worker
docker logs -f cooly-outbox-relay
```

### Step 6: Verify Services

```bash
# Test Redis
docker exec cooly-redis-workers redis-cli -a "$REDIS_PASSWORD" ping
# Expected: PONG

# Test MinIO
curl http://localhost:9000/minio/health/live
# Expected: HTTP 200

# Test worker connection to database
docker logs cooly-gen-worker | grep -i "connected"
# Expected: "Connected to database"
```

**Save your passwords**:
```bash
# Display for copying
echo "REDIS_PASSWORD: $(grep REDIS_PASSWORD .env.workers | cut -d= -f2)"
echo "MINIO_ROOT_PASSWORD: $(grep MINIO_ROOT_PASSWORD .env.workers | cut -d= -f2)"
```

---

## Part 2: Configure Render (15 minutes)

### Step 1: Update Backend Environment

1. Go to Render Dashboard → Your Backend Service
2. Click **"Environment"** tab
3. Add/update these variables:

```bash
# Queue Configuration (VPS Redis)
REDIS_URL=redis://:<YOUR_REDIS_PASSWORD>@<VPS_IP>:6379
USE_BULLMQ=true

# Storage Configuration (VPS MinIO)
S3_ENDPOINT=http://<VPS_IP>:9000
S3_PUBLIC_URL=http://<VPS_IP>:9000
S3_FORCE_PATH_STYLE=true
B2_BUCKET_NAME=cooly-prod
B2_ACCESS_KEY_ID=cooly_admin
B2_SECRET_ACCESS_KEY=<YOUR_MINIO_ROOT_PASSWORD>

# Disable Workers on Render (run on VPS instead)
START_GEN_WORKER=false
START_OUTBOX_RELAY=false
ENABLE_CAPTURE_WORKER=false
ENABLE_SESSION_SWEEPER=false

# Keep Outbox Enabled (API writes to outbox table)
ENABLE_ENQUEUE_FIRST=true
ENABLE_OUTBOX=true
FORCE_OUTBOX_ONLY=true
```

4. Click **"Save Changes"** → Render redeploys backend

### Step 2: Remove Render Worker (Optional)

If you have a separate worker service on Render:

1. Go to Render Dashboard → Your Worker Service
2. Click **"Settings"** → **"Delete Service"**
3. This saves ~$25/month

### Step 3: Test Connectivity

```bash
# From Render backend, test Redis connection
# Go to Render Dashboard → Backend → Shell
node -e "
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);
redis.ping().then(() => console.log('Redis OK')).catch(e => console.error(e));
"

# Test MinIO connection
node -e "
const http = require('http');
const url = process.env.S3_ENDPOINT + '/minio/health/live';
http.get(url, res => console.log('MinIO OK:', res.statusCode)).on('error', e => console.error(e));
"
```

---

## Part 3: Verification (10 minutes)

### Test End-to-End Flow

1. **Visit your Render frontend**: `https://your-app.onrender.com`
2. **Login** with test account
3. **Generate an image**:
   - Prompt: "A serene mountain landscape"
   - Click "Generate"
4. **Verify flow**:
   - ✅ Backend API responds instantly (202 Accepted)
   - ✅ Check VPS logs: `docker logs -f cooly-gen-worker`
   - ✅ Should see: "Processing job gen.seedream4"
   - ✅ Image appears in ~30 seconds
   - ✅ Image URL points to VPS MinIO

### Monitor Workers

```bash
# SSH into VPS
ssh root@<VPS_IP>

# View all logs
docker-compose -f cooly-ai/docker-compose.workers.yml logs -f

# View specific worker
docker logs -f cooly-gen-worker

# Check queue status
docker exec cooly-redis-workers redis-cli -a "$REDIS_PASSWORD" info stats
```

### Check MinIO Storage

1. Visit MinIO Console: `http://<VPS_IP>:9001`
2. Login:
   - Username: `cooly_admin`
   - Password: `<YOUR_MINIO_ROOT_PASSWORD>`
3. Browse `cooly-prod` bucket
4. Generated images should appear here

---

## Part 4: Security Hardening (10 minutes)

### Option A: IP Whitelist (Recommended)

Restrict Redis/MinIO access to Render's IPs only.

```bash
# Get Render's outbound IPs
# https://render.com/docs/outbound-static-ips
# Example IPs (check docs for latest):
# - 44.235.20.0/24
# - 44.226.236.0/24

# Update firewall
ufw delete allow 6379/tcp
ufw delete allow 9000/tcp

# Allow only Render IPs
ufw allow from 44.235.20.0/24 to any port 6379
ufw allow from 44.235.20.0/24 to any port 9000
ufw allow from 44.226.236.0/24 to any port 6379
ufw allow from 44.226.236.0/24 to any port 9000

ufw reload
```

### Option B: VPN Tunnel (Most Secure)

Use Tailscale to create private network between Render and VPS.

```bash
# Install Tailscale on VPS
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Get Tailscale IP
tailscale ip

# Update Render backend REDIS_URL
REDIS_URL=redis://:<password>@<TAILSCALE_IP>:6379
S3_ENDPOINT=http://<TAILSCALE_IP>:9000
```

### Option C: Strong Passwords (Minimum)

If exposing publicly, ensure strong credentials:

```bash
# Redis password (already set in .env.workers)
# Should be 32+ characters

# MinIO credentials (already set in .env.workers)
# Change default password after first login

# Monitor for suspicious activity
docker logs cooly-redis-workers | grep -i "auth"
```

---

## Troubleshooting

### Issue: Backend can't connect to Redis

**Symptoms**: Render backend logs show "ECONNREFUSED" or "Redis connection failed"

**Fix**:
```bash
# 1. Check Redis is running on VPS
docker ps | grep redis
docker logs cooly-redis-workers

# 2. Test Redis from VPS
docker exec cooly-redis-workers redis-cli -a "$REDIS_PASSWORD" ping

# 3. Check firewall
ufw status | grep 6379

# 4. Test connection from Render
# In Render Shell:
telnet <VPS_IP> 6379
```

### Issue: Images not loading

**Symptoms**: Images generate but show broken image icon

**Fix**:
```bash
# 1. Check S3_PUBLIC_URL is correct
echo $S3_PUBLIC_URL
# Should be: http://<VPS_IP>:9000

# 2. Check MinIO is accessible
curl http://<VPS_IP>:9000/minio/health/live

# 3. Check bucket exists
docker exec cooly-minio-workers mc ls local/
# Should show: cooly-prod

# 4. Check firewall
ufw status | grep 9000
```

### Issue: Workers not processing jobs

**Symptoms**: Jobs stuck in "processing" forever

**Fix**:
```bash
# 1. Check worker logs
docker logs cooly-gen-worker

# 2. Check Redis queue
docker exec cooly-redis-workers redis-cli -a "$REDIS_PASSWORD" LLEN "bull:generation:wait"
# If >0, jobs are queued but not processing

# 3. Restart worker
docker restart cooly-gen-worker

# 4. Check database connectivity
docker logs cooly-gen-worker | grep -i "database"
```

### Issue: High latency

**Symptoms**: Image generation takes >40 seconds (normally ~30s)

**Cause**: Network latency between Render and VPS

**Fix**:
```bash
# 1. Check Render region vs VPS location
# Ideally same continent

# 2. Measure latency from Render to VPS
# In Render Shell:
ping <VPS_IP> -c 10

# 3. Consider moving VPS closer to Render region
# Or use Render's region: Oregon, Ohio, Frankfurt, Singapore

# 4. Monitor network
docker stats  # Check network I/O
```

---

## Monitoring & Maintenance

### Daily Checks

```bash
# SSH into VPS
ssh root@<VPS_IP>

# Check all containers healthy
docker ps

# Check disk space
df -h

# Check memory
free -h

# View recent logs
docker-compose -f cooly-ai/docker-compose.workers.yml logs --tail 100
```

### Weekly Tasks

```bash
# Update containers
cd cooly-ai
git pull origin feat/contract-completion
docker-compose -f docker-compose.workers.yml up -d --build

# Clean up old images
docker system prune -af

# Restart Redis (flushes memory)
docker restart cooly-redis-workers
```

### Backup Strategy

**Database**: Handled by Render (automatic backups)

**MinIO (Generated Media)**:
```bash
# Backup bucket to tarball
docker exec cooly-minio-workers mc mirror local/cooly-prod /tmp/backup
docker cp cooly-minio-workers:/tmp/backup ./minio-backup-$(date +%Y%m%d).tar

# Restore
docker cp ./minio-backup-20250109.tar cooly-minio-workers:/tmp/restore
docker exec cooly-minio-workers mc mirror /tmp/restore local/cooly-prod
```

---

## Cost Breakdown

### Monthly Costs

**Render Services**:
- Frontend: $7/month (Starter plan)
- Backend: $7/month (Starter plan)
- PostgreSQL: $7/month (Starter plan)
- **Render Total**: $21/month

**VPS (Hetzner CPX21)**:
- 2 vCPU, 4GB RAM, 80GB SSD
- Redis + MinIO + Workers
- **VPS Total**: €7/month (~$7)

**Grand Total**: ~$28/month

**vs Current Production**: $85/month

**Savings**: ~$57/month (67% reduction)

---

## Performance Expectations

### Response Times

| Operation | Full Managed | Hybrid | Notes |
|-----------|-------------|--------|-------|
| API Response | 50-100ms | 30-80ms | Slight improvement (fewer hops) |
| DB Query | 10-30ms | 10-25ms | Same (Render DB in both) |
| Queue Write | 20-50ms | 30-70ms | +10-20ms (network to VPS) |
| Worker Pickup | 100-500ms | 200-800ms | +100-300ms (polling latency) |
| Image Gen | 30-35s | 30-35s | Same (provider API dominates) |

**Net Impact**: +1-2 seconds on end-to-end generation (not noticeable to users)

### Throughput

- **Concurrent Users**: 200-500 (limited by VPS workers)
- **Worker Concurrency**: 5 (configurable via `GEN_WORKER_CONCURRENCY`)
- **Scaling**: Manual (upgrade VPS or add more VPS nodes)

---

## Scaling Strategy

### Vertical Scaling (Upgrade VPS)

```bash
# Current: CPX21 (2 vCPU, 4GB RAM) - $7/mo
# Upgrade to: CPX31 (4 vCPU, 8GB RAM) - $14/mo

# Benefits:
# - More worker concurrency (10+ concurrent jobs)
# - Faster Redis/MinIO performance
# - Headroom for traffic growth
```

### Horizontal Scaling (Add VPS)

```bash
# Deploy second VPS with workers
# Both connect to same Render database + Redis

# Load balance:
# - VPS 1: Gen Worker + Outbox Relay
# - VPS 2: Gen Worker + Session Sweeper

# Redis: Keep on VPS 1 (single queue)
# MinIO: Keep on VPS 1 (single storage)
```

---

## Rollback Plan

If hybrid deployment has issues, quickly revert to Render-only:

```bash
# 1. Re-enable workers on Render Backend
START_GEN_WORKER=true
START_OUTBOX_RELAY=true
ENABLE_CAPTURE_WORKER=true
ENABLE_SESSION_SWEEPER=true

# 2. Point back to Upstash Redis
REDIS_URL=<your-upstash-redis-url>

# 3. Point back to Backblaze B2
B2_ACCESS_KEY_ID=<your-b2-key>
B2_SECRET_ACCESS_KEY=<your-b2-secret>
# Remove S3_ENDPOINT

# 4. Redeploy on Render
# Takes ~5 minutes

# 5. Shut down VPS workers
ssh root@<VPS_IP>
cd cooly-ai
docker-compose -f docker-compose.workers.yml down
```

---

## Next Steps

After successful hybrid deployment:

1. **Monitor for 48 hours**:
   - Check worker logs daily
   - Monitor error rates
   - Verify image generation success

2. **Collect Performance Data**:
   - Compare generation times with full managed
   - Track any latency increases
   - Monitor VPS resource usage

3. **Optimize if Needed**:
   - Adjust worker concurrency
   - Tune Redis/MinIO settings
   - Consider VPS upgrade

4. **Consider Full VPS**:
   - If hybrid works well, evaluate migrating frontend/backend too
   - Potential total cost: $15-30/month (full VPS)
   - See: [DEPLOYMENT_OPTIONS_GUIDE.md](./DEPLOYMENT_OPTIONS_GUIDE.md)

---

## Summary

✅ **Cost**: ~$28/month (67% savings vs $85/month)

✅ **Setup Time**: ~65 minutes

✅ **Performance**: Similar to full managed (+1-2s on generation, not noticeable)

✅ **Maintenance**: Weekly updates + daily health checks

✅ **Scaling**: Manual (vertical: upgrade VPS, horizontal: add VPS)

✅ **Best For**: Cost-optimized production with moderate traffic

---

**Questions?** Open an issue or see [DEPLOYMENT_OPTIONS_GUIDE.md](./DEPLOYMENT_OPTIONS_GUIDE.md) for other deployment options.
