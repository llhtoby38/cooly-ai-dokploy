# Dokploy Deployment Guide - Cooly AI Testing Environment

**Purpose**: Deploy a separate testing version of Cooly AI with contract improvements for users to compare with production.

**Branch**: `feat/contract-completion` (contains all performance improvements)

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [VM Setup](#vm-setup)
3. [Dokploy Installation](#dokploy-installation)
4. [DNS Configuration](#dns-configuration)
5. [Environment Configuration](#environment-configuration)
6. [Dokploy Project Setup](#dokploy-project-setup)
7. [Deployment](#deployment)
8. [Verification](#verification)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Resources
- **VM Specifications** (recommended minimum):
  - 4 CPU cores
  - 8GB RAM
  - 80GB SSD storage
  - Ubuntu 22.04 LTS or higher

- **Domain/Subdomain**:
  - Example: `test.cooly.ai`
  - You'll need 4 subdomains:
    - `test.cooly.ai` - Frontend
    - `api.test.cooly.ai` - Backend API
    - `minio.test.cooly.ai` - MinIO S3 API
    - `minio-console.test.cooly.ai` - MinIO Admin Console

- **API Keys**: Same keys as production (Byteplus, OpenAI, Stripe, etc.)

---

## VM Setup

### 1. Provision a VM

Choose a provider:
- **DigitalOcean**: $48/month (4 CPU, 8GB RAM, 160GB SSD)
- **AWS EC2**: t3.large ($70/month)
- **Hetzner**: €14/month (4 vCPU, 8GB RAM, 80GB SSD) - Best value
- **Linode**: $36/month (4 CPU, 8GB RAM, 160GB SSD)

### 2. Initial Server Setup

SSH into your VM:
```bash
ssh root@<VM_IP_ADDRESS>
```

Update system packages:
```bash
apt update && apt upgrade -y
```

Install required packages:
```bash
apt install -y curl git ufw
```

### 3. Configure Firewall

```bash
# Allow SSH
ufw allow 22/tcp

# Allow HTTP/HTTPS (for Dokploy/Traefik)
ufw allow 80/tcp
ufw allow 443/tcp

# Allow Dokploy Dashboard
ufw allow 3000/tcp

# Enable firewall
ufw enable
```

### 4. Create Swap (if VM has <8GB RAM)

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
```

---

## Dokploy Installation

Dokploy is a self-hosted PaaS alternative to Vercel/Render with built-in Traefik for SSL.

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
```

### 2. Install Dokploy

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

This will:
- Install Dokploy
- Set up Traefik reverse proxy
- Configure Let's Encrypt SSL
- Start the dashboard on port 3000

### 3. Access Dokploy Dashboard

Visit: `http://<VM_IP_ADDRESS>:3000`

Create admin account:
- Email: your-admin@email.com
- Password: (strong password)

---

## DNS Configuration

Configure your DNS provider to point subdomains to your VM IP.

### Required DNS Records (Type A)

| Subdomain | Type | Value | TTL |
|-----------|------|-------|-----|
| test.cooly.ai | A | `<VM_IP>` | 300 |
| api.test.cooly.ai | A | `<VM_IP>` | 300 |
| minio.test.cooly.ai | A | `<VM_IP>` | 300 |
| minio-console.test.cooly.ai | A | `<VM_IP>` | 300 |

**Example (Cloudflare)**:
```
Type: A
Name: test
Content: 123.45.67.89
Proxy: Off (DNS only)
TTL: Auto

Type: A
Name: api.test
Content: 123.45.67.89
Proxy: Off (DNS only)
TTL: Auto

(repeat for minio and minio-console subdomains)
```

**Wait 5-10 minutes for DNS propagation**, then verify:
```bash
nslookup test.cooly.ai
nslookup api.test.cooly.ai
```

---

## Environment Configuration

### 1. Clone Repository on Your Local Machine

```bash
git clone https://github.com/your-org/cooly-ai.git
cd cooly-ai
git checkout feat/contract-completion
```

### 2. Create Production Environment File

```bash
cp .env.prod.example .env.prod
```

### 3. Configure `.env.prod`

Edit `.env.prod` with production-ready values:

```bash
# Generate strong passwords
openssl rand -base64 32  # For POSTGRES_PASSWORD
openssl rand -base64 32  # For REDIS_PASSWORD
openssl rand -base64 32  # For MINIO_ROOT_PASSWORD
openssl rand -base64 64  # For JWT_SECRET
openssl rand -base64 64  # For ADMIN_SECRET_KEY
```

**Critical values to set**:

```bash
# Domain Configuration
DOMAIN=test.cooly.ai
API_DOMAIN=api.test.cooly.ai
MINIO_DOMAIN=minio.test.cooly.ai
MINIO_CONSOLE_DOMAIN=minio-console.test.cooly.ai

# Database
POSTGRES_PASSWORD=<generated-password-1>

# Redis
REDIS_PASSWORD=<generated-password-2>

# MinIO
MINIO_ROOT_USER=cooly_admin
MINIO_ROOT_PASSWORD=<generated-password-3>

# JWT & Security
JWT_SECRET=<generated-secret-1>
ADMIN_SECRET_KEY=<generated-secret-2>
EXCHANGE_JWT_SECRET=<generated-secret-3>

# Copy all API keys from your production .env
BYTEPLUS_APP_ID=<from-production>
BYTEPLUS_ACCESS_TOKEN=<from-production>
SEEDREAM4_API_KEY=<from-production>
SEEDANCE_API_KEY=<from-production>
OPENAI_API_KEY=<from-production>
STRIPE_SECRET_KEY=<from-production>
# ... (copy all other API keys)
```

### 4. Prepare Git Repository for Deployment

Commit the production compose file:
```bash
git add docker-compose.prod.yml .env.prod.example DOKPLOY_DEPLOYMENT_GUIDE.md
git commit -m "Add production deployment configuration"
git push origin feat/contract-completion
```

**IMPORTANT**: Do NOT commit `.env.prod` to Git (it's already in .gitignore).

---

## Dokploy Project Setup

### 1. Create New Project in Dokploy

1. Login to Dokploy dashboard: `http://<VM_IP>:3000`
2. Click **"Create Project"**
3. Name: `cooly-testing`
4. Description: `Contract improvements testing environment`
5. Click **"Create"**

### 2. Add Compose Application

1. Inside project, click **"Add Service"** → **"Docker Compose"**
2. Configuration:
   - **Name**: `cooly-app`
   - **Repository URL**: `https://github.com/your-org/cooly-ai.git`
   - **Branch**: `feat/contract-completion`
   - **Compose File**: `docker-compose.prod.yml`
   - **Build Path**: `/` (root)

### 3. Configure Environment Variables

In the **Environment Variables** section of Dokploy:

**Option A: Upload .env.prod file**
1. Click **"Upload .env file"**
2. Select your `.env.prod` file

**Option B: Manual entry**
1. Click **"Add Variable"** for each required variable
2. Copy from `.env.prod` one by one

**Critical variables to set**:
```
DOMAIN=test.cooly.ai
API_DOMAIN=api.test.cooly.ai
MINIO_DOMAIN=minio.test.cooly.ai
MINIO_CONSOLE_DOMAIN=minio-console.test.cooly.ai
POSTGRES_PASSWORD=<your-generated-password>
REDIS_PASSWORD=<your-generated-password>
MINIO_ROOT_USER=cooly_admin
MINIO_ROOT_PASSWORD=<your-generated-password>
JWT_SECRET=<your-generated-secret>
... (all other API keys)
```

### 4. Configure Traefik (SSL/Domains)

Dokploy uses Traefik labels from `docker-compose.prod.yml` automatically.

**Verify Traefik Configuration**:
1. In Dokploy dashboard → **"Settings"** → **"Traefik"**
2. Enable **Let's Encrypt**
3. Set email for SSL certificates: `your-email@example.com`
4. Set **ACME Challenge**: HTTP (for wildcard, use DNS if supported)

### 5. Advanced Settings (Optional)

**Health Check**:
- Enabled: Yes
- Backend health endpoint: `/healthz`

**Restart Policy**:
- Policy: `unless-stopped`

---

## Deployment

### 1. Deploy Application

1. In Dokploy dashboard → `cooly-testing` project → `cooly-app`
2. Click **"Deploy"** button (top right)
3. Dokploy will:
   - Clone repository
   - Build Docker images
   - Start all services
   - Configure Traefik routes
   - Request SSL certificates

**Deployment takes 5-10 minutes** (first build).

### 2. Monitor Deployment

**View Build Logs**:
- Click **"Logs"** tab in Dokploy
- Watch for build progress
- Look for errors (red lines)

**Expected log flow**:
```
✓ Cloning repository...
✓ Building backend image...
✓ Building frontend image...
✓ Starting postgres...
✓ Starting redis...
✓ Starting minio...
✓ Starting backend...
✓ Starting frontend...
✓ Requesting SSL certificates...
✓ Deployment successful!
```

### 3. Initialize Database

After first deployment, seed the test database:

**Option A: Via Dokploy Terminal**
1. In Dokploy → `cooly-app` → **"Terminal"** tab
2. Select container: `cooly-backend-prod`
3. Run:
   ```bash
   cd /app/script
   ./seed-db.sh
   ```

**Option B: Via SSH**
```bash
ssh root@<VM_IP>

# Find backend container
docker ps | grep cooly-backend

# Execute seed script
docker exec -it cooly-backend-prod sh -c "cd /app/script && ./seed-db.sh"
```

### 4. Verify SSL Certificates

Visit each domain in browser (should auto-redirect to HTTPS):
- https://test.cooly.ai
- https://api.test.cooly.ai/healthz
- https://minio.test.cooly.ai (should show MinIO XML)
- https://minio-console.test.cooly.ai (should show MinIO login)

**If SSL fails**, check Traefik logs:
```bash
docker logs traefik
```

---

## Verification

### 1. Health Checks

**Backend API**:
```bash
curl https://api.test.cooly.ai/healthz
# Expected: {"status":"ok","timestamp":"..."}
```

**Database Connection**:
```bash
docker exec cooly-backend-prod node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT NOW()').then(r => console.log('DB OK:', r.rows[0])).catch(e => console.error('DB Error:', e));
"
```

**Redis Connection**:
```bash
docker exec cooly-redis-prod redis-cli -a "$REDIS_PASSWORD" ping
# Expected: PONG
```

**MinIO Connection**:
```bash
docker exec cooly-minio-init-prod mc ls local/
# Expected: cooly-prod bucket listed
```

### 2. Test User Access

1. Visit: https://test.cooly.ai
2. Login with test user:
   - Email: `test@example.com`
   - Password: `testpassword123`
   - Credits: 1000 (from seed script)

### 3. Test Image Generation

1. Navigate to Image Generation
2. Enter prompt: "A serene mountain landscape at sunset"
3. Click **"Generate"**
4. Verify:
   - ✅ Instant response (26ms API call)
   - ✅ Image appears in ~30 seconds
   - ✅ Credits deducted correctly
   - ✅ Image stored in MinIO

### 4. Performance Comparison

Test the same prompt on:
- **Production**: (your live site)
- **Testing**: https://test.cooly.ai

**Compare**:
- Response time (should be instant on testing)
- Credit deduction speed (should be <25ms on testing)
- Overall user experience (testing should feel snappier)

---

## Troubleshooting

### Issue: SSL Certificate Not Issued

**Symptoms**: Browser shows "Not Secure" or certificate error

**Cause**: Let's Encrypt failed to verify domain ownership

**Fix**:
1. Verify DNS is correct: `nslookup test.cooly.ai` → should return VM IP
2. Check Traefik logs: `docker logs traefik | grep -i error`
3. Ensure ports 80/443 are open: `ufw status`
4. Restart Traefik: `docker restart traefik`
5. Redeploy in Dokploy

### Issue: 502 Bad Gateway

**Symptoms**: Nginx/Traefik error page

**Cause**: Backend container not healthy or not responding

**Fix**:
1. Check backend health: `docker ps` (look for "unhealthy")
2. View backend logs: `docker logs cooly-backend-prod`
3. Check database connection:
   ```bash
   docker exec cooly-backend-prod env | grep DATABASE_URL
   docker exec cooly-postgres-prod pg_isready
   ```
4. Restart backend: `docker restart cooly-backend-prod`

### Issue: Database Connection Failed

**Symptoms**: Backend logs show "ECONNREFUSED" or "password authentication failed"

**Cause**: Wrong DATABASE_URL or password mismatch

**Fix**:
1. Verify environment variables in Dokploy match `.env.prod`
2. Check password in Dokploy env vars:
   ```
   POSTGRES_PASSWORD=<correct-password>
   DATABASE_URL=postgresql://cooly:<same-password>@postgres:5432/cooly_prod
   ```
3. Restart services in order:
   ```bash
   docker restart cooly-postgres-prod
   docker restart cooly-backend-prod
   ```

### Issue: Redis Connection Failed

**Symptoms**: "WRONGPASS invalid username-password pair" or "NOAUTH"

**Cause**: Redis password mismatch

**Fix**:
1. Check environment variables:
   ```
   REDIS_PASSWORD=<password>
   REDIS_URL=redis://:<same-password>@redis:6379
   ```
2. Restart Redis: `docker restart cooly-redis-prod`

### Issue: Images Not Loading

**Symptoms**: Generated images show broken image icon

**Cause**: MinIO not accessible or wrong S3_PUBLIC_URL

**Fix**:
1. Check MinIO is running: `docker ps | grep minio`
2. Test MinIO API: `curl https://minio.test.cooly.ai`
3. Verify environment variable:
   ```
   S3_PUBLIC_URL=https://minio.test.cooly.ai
   ```
4. Check MinIO bucket exists:
   ```bash
   docker exec cooly-minio-init-prod mc ls local/
   ```

### Issue: Worker Not Processing Jobs

**Symptoms**: Jobs stuck in "processing" status forever

**Cause**: Worker not started or BullMQ connection issue

**Fix**:
1. Check backend logs for worker startup:
   ```bash
   docker logs cooly-backend-prod | grep -i worker
   ```
2. Verify environment variables:
   ```
   START_GEN_WORKER=true
   USE_BULLMQ=true
   ```
3. Check Redis connection from backend:
   ```bash
   docker exec cooly-backend-prod node -e "
   const Redis = require('ioredis');
   const redis = new Redis(process.env.REDIS_URL);
   redis.ping().then(() => console.log('Redis OK')).catch(e => console.error('Redis Error:', e));
   "
   ```

### Issue: High Memory Usage

**Symptoms**: VM running out of memory, services crashing

**Cause**: Too many concurrent workers or insufficient RAM

**Fix**:
1. Reduce worker concurrency in Dokploy env vars:
   ```
   GEN_WORKER_CONCURRENCY=2
   ```
2. Monitor memory: `docker stats`
3. Add more swap (see VM Setup section)
4. Consider upgrading VM to 16GB RAM

---

## Maintenance

### View Logs

**All services**:
```bash
docker-compose -f docker-compose.prod.yml logs -f
```

**Specific service**:
```bash
docker logs -f cooly-backend-prod
docker logs -f cooly-frontend-prod
docker logs -f cooly-postgres-prod
```

### Restart Services

**All services**:
```bash
docker-compose -f docker-compose.prod.yml restart
```

**Specific service**:
```bash
docker restart cooly-backend-prod
```

### Update Deployment

1. Push changes to `feat/contract-completion` branch
2. In Dokploy dashboard → Click **"Redeploy"**
3. Dokploy will pull latest code and rebuild

### Backup Database

```bash
docker exec cooly-postgres-prod pg_dump -U cooly cooly_prod > backup-$(date +%Y%m%d).sql
```

### Restore Database

```bash
cat backup-20250109.sql | docker exec -i cooly-postgres-prod psql -U cooly cooly_prod
```

---

## Cost Comparison

### Dokploy VM (Self-Hosted)
- **Hetzner**: €14/month (~$15)
- **DigitalOcean**: $48/month
- **Linode**: $36/month

**Total**: $15-50/month for ALL services

### vs. Current Production Stack
- Render backend: $25/month
- Vercel frontend: $20/month
- Supabase: $25/month
- Upstash Redis: $10/month
- Backblaze B2: $5/month

**Total**: $85/month

**Savings**: $35-70/month (41-82% reduction)

---

## Next Steps After Deployment

1. **Share Testing URL**: Send https://test.cooly.ai to users
2. **Monitor Performance**: Check backend logs for timing metrics
3. **Compare with Production**: Have users test both environments
4. **Collect Feedback**: Document any issues or improvements noticed
5. **Plan Production Merge**: Once testing confirms improvements, merge to main

---

## Quick Reference Commands

```bash
# SSH into VM
ssh root@<VM_IP>

# View all containers
docker ps -a

# View logs (last 100 lines)
docker logs --tail 100 cooly-backend-prod

# Restart backend
docker restart cooly-backend-prod

# Execute command in container
docker exec -it cooly-backend-prod sh

# Check database
docker exec cooly-postgres-prod psql -U cooly cooly_prod -c "SELECT COUNT(*) FROM users;"

# Check Redis
docker exec cooly-redis-prod redis-cli -a "$REDIS_PASSWORD" info

# Check disk space
df -h

# Check memory
free -h

# Monitor resources
docker stats

# Update code and redeploy
git pull origin feat/contract-completion
docker-compose -f docker-compose.prod.yml up -d --build
```

---

## Support

If you encounter issues not covered in this guide:

1. **Check Dokploy Logs**: Dashboard → Logs tab
2. **Check Service Logs**: `docker logs <container-name>`
3. **Dokploy Discord**: https://discord.gg/dokploy
4. **GitHub Issues**: Open issue with logs attached

---

**Deployment Checklist**:
- [ ] VM provisioned with 4 CPU, 8GB RAM
- [ ] DNS records configured for all 4 subdomains
- [ ] Dokploy installed and dashboard accessible
- [ ] `.env.prod` configured with all API keys
- [ ] Git repository pushed with production files
- [ ] Dokploy project created and configured
- [ ] Application deployed successfully
- [ ] SSL certificates issued (HTTPS working)
- [ ] Database seeded with test user
- [ ] Test image generation working
- [ ] All services healthy (docker ps shows "healthy")
- [ ] Testing URL shared with users

---

**Estimated Setup Time**: 45-60 minutes (excluding DNS propagation)
