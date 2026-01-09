# Deployment Files - Quick Reference

This document indexes all deployment-related files and guides you to the right resource for your deployment scenario.

---

## 📁 Files Overview

| File | Purpose | When to Use |
|------|---------|-------------|
| **docker-compose.yml** | Local development | Running locally with Docker |
| **docker-compose.prod.yml** | Full VPS production | Deploying entire stack to single VPS (Dokploy) |
| **docker-compose.workers.yml** | VPS workers only | Hybrid: Render + VPS workers |
| **render.yaml** | Current production | Existing Render deployment |
| **render.hybrid.yaml** | Hybrid Render config | Render (web) + VPS (workers) |
| **.env.local.example** | Local development env | Docker local setup |
| **.env.prod.example** | Full VPS production env | Dokploy deployment |
| **.env.workers.example** | VPS workers env | Hybrid deployment |

---

## 📚 Guides Overview

### Main Deployment Guide
**[DEPLOYMENT_OPTIONS_GUIDE.md](./DEPLOYMENT_OPTIONS_GUIDE.md)** - START HERE

Comprehensive comparison of all deployment options:
- Option 1: Current Production (AWS Services) - $85/mo
- Option 2: Full VPS (Dokploy) - $15-50/mo
- Option 3: Hybrid (Render + VPS) - $35-60/mo

Includes architecture diagrams, cost analysis, performance comparison, and decision matrix.

---

### Specific Deployment Guides

#### 1. Full VPS Deployment (Dokploy)
**[DOKPLOY_DEPLOYMENT_GUIDE.md](./DOKPLOY_DEPLOYMENT_GUIDE.md)**

**When**: Testing improvements, staging, small production, maximum cost savings

**What you get**:
- Complete stack on single VPS
- SSL with Let's Encrypt (automatic)
- Traefik reverse proxy
- All services in one network
- Cost: $15-50/month

**Time**: 45-60 minutes

**Use with**: `docker-compose.prod.yml` + `.env.prod`

---

#### 2. Hybrid Deployment (Render + VPS)
**[HYBRID_DEPLOYMENT_GUIDE.md](./HYBRID_DEPLOYMENT_GUIDE.md)**

**When**: Cost-optimized production, want managed web tier

**What you get**:
- Render: Frontend, Backend, PostgreSQL (managed)
- VPS: Redis, MinIO, Workers (self-hosted)
- Best balance of cost and convenience
- Cost: $28-60/month

**Time**: 65 minutes

**Use with**: `docker-compose.workers.yml` + `.env.workers` + `render.hybrid.yaml`

---

#### 3. Environment Variable Mapping
**[ENV_PRODUCTION_MAPPING.md](./ENV_PRODUCTION_MAPPING.md)**

Quick reference for copying variables from your existing `.env` to production configs.

Maps line-by-line what to copy from current `.env` file.

---

## 🚀 Quick Start by Scenario

### Scenario 1: "I want to test the contract improvements"

**Goal**: Deploy testing environment for users to compare with production

**Recommended**: Full VPS (Dokploy)

**Steps**:
1. Read: [DOKPLOY_DEPLOYMENT_GUIDE.md](./DOKPLOY_DEPLOYMENT_GUIDE.md)
2. Generate secrets (see guide)
3. Configure `.env.prod` using [ENV_PRODUCTION_MAPPING.md](./ENV_PRODUCTION_MAPPING.md)
4. Deploy to VPS with Dokploy
5. Use domain: `test.cooly.ai`

**Time**: 45-60 minutes

**Cost**: $15/month (Hetzner CPX31)

---

### Scenario 2: "I want to reduce production costs"

**Goal**: Keep production reliable but cut costs significantly

**Recommended**: Hybrid (Render + VPS)

**Steps**:
1. Read: [HYBRID_DEPLOYMENT_GUIDE.md](./HYBRID_DEPLOYMENT_GUIDE.md)
2. Deploy workers to VPS
3. Update Render backend config
4. Monitor for 48 hours
5. Remove Render worker service

**Time**: 65 minutes

**Cost**: $28/month (vs $85/month currently)

**Savings**: 67% reduction

---

### Scenario 3: "I want maximum control and savings"

**Goal**: Self-host everything, maximum cost reduction

**Recommended**: Full VPS (Dokploy)

**Steps**:
1. Read: [DOKPLOY_DEPLOYMENT_GUIDE.md](./DOKPLOY_DEPLOYMENT_GUIDE.md)
2. Deploy to production VPS
3. Test thoroughly on staging domain
4. Set up backups
5. Point DNS to VPS
6. Decommission Render/Vercel/Supabase

**Time**: 2-3 hours (including testing)

**Cost**: $15-50/month

**Savings**: 82% reduction

---

### Scenario 4: "I'm not sure which to choose"

**Read**: [DEPLOYMENT_OPTIONS_GUIDE.md](./DEPLOYMENT_OPTIONS_GUIDE.md)

See "Decision Matrix" section for recommendation based on:
- Budget
- Traffic levels
- Technical comfort level
- Availability requirements
- Scaling needs

---

## 🎯 Deployment Decision Tree

```
Do you need to test contract improvements?
├─ Yes → Full VPS (Dokploy) for testing
│         Domain: test.cooly.ai
│         Guide: DOKPLOY_DEPLOYMENT_GUIDE.md
│
└─ No → Is production cost a concern?
    ├─ Yes → What's your priority?
    │   ├─ Maximum savings → Full VPS (Dokploy)
    │   │                     Cost: $15-50/mo
    │   │                     Guide: DOKPLOY_DEPLOYMENT_GUIDE.md
    │   │
    │   └─ Balance savings + managed → Hybrid (Render + VPS)
    │                                   Cost: $28-60/mo
    │                                   Guide: HYBRID_DEPLOYMENT_GUIDE.md
    │
    └─ No → Keep current production (Option 1)
             No changes needed
             Cost: $85+/mo
```

---

## 📊 Comparison Matrix

| Feature | Current Prod | Full VPS | Hybrid |
|---------|-------------|----------|--------|
| **Monthly Cost** | $85-115 | $15-50 | $28-60 |
| **Setup Time** | N/A | 45-60 min | 65 min |
| **Management** | Minimal | Manual | Mixed |
| **Scaling** | Auto | Manual | Partial |
| **Single Point of Failure** | No | Yes | Partial |
| **SSL Included** | Yes | Yes | Yes |
| **Backups** | Auto | Manual | Auto (DB only) |
| **Best For** | Enterprise | Testing, Small | Cost-optimized |

---

## 🔧 Configuration Files by Deployment

### Local Development
```bash
docker-compose.yml        # All services
.env.local                # Copy from .env.local.example
```

**Start**: `docker-compose up -d --build`

---

### Full VPS (Dokploy)
```bash
docker-compose.prod.yml   # All services
.env.prod                 # Copy from .env.prod.example
```

**Deploy**: Via Dokploy dashboard (see guide)

---

### Hybrid (Render + VPS)
```bash
# VPS side:
docker-compose.workers.yml  # Workers + Redis + MinIO
.env.workers                # Copy from .env.workers.example

# Render side:
render.hybrid.yaml          # Rename to render.yaml
# Configure env vars in Render dashboard
```

**Deploy**:
1. VPS: `docker-compose -f docker-compose.workers.yml up -d --build`
2. Render: Update env vars, push to trigger deploy

---

## 📝 Environment Variables Quick Copy

### From Current `.env` → New Deployment

**Copy these as-is** (all deployments need):
```bash
# API Keys
BYTEPLUS_* (lines 6-15)
SEEDREAM4_* (lines 116-118)
SEEDANCE_* (lines 11-15)
OPENAI_API_KEY (line 152)
FAL_KEY, WAVESPEED_API_KEY (lines 166-167)
KIE_API_KEY (line 65)
GOOGLE_* (lines 92-93, 110-113)
STRIPE_* (lines 46-47) # Use LIVE keys
SMTP_* (lines 100-105)
SANITY_* (lines 171-176)
POSTHOG_* (lines 179-185)
ADMIN_* (lines 120-121)
```

**Generate new** (security):
```bash
# For production deployments
POSTGRES_PASSWORD=$(openssl rand -base64 32)
REDIS_PASSWORD=$(openssl rand -base64 32)
MINIO_ROOT_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 64)
ADMIN_SECRET_KEY=$(openssl rand -base64 64)
```

**Skip these** (specific to old stack):
```bash
# Don't copy these
PREVIEW_DATABASE_URL     # Using different DB
AWS_IAM_COOLY_*          # Using BullMQ instead of SQS
SQS_MAIN_QUEUE_URL       # Using BullMQ
B2_ENDPOINT              # Using MinIO (VPS) or Render DB
RENDER_*                 # Render-specific
```

See [ENV_PRODUCTION_MAPPING.md](./ENV_PRODUCTION_MAPPING.md) for detailed mapping.

---

## 🔐 Security Checklist

### Before Going to Production

#### Full VPS Deployment
- [ ] Generated strong passwords (32+ chars)
- [ ] SSL certificates obtained (automatic via Traefik)
- [ ] Firewall configured (UFW)
- [ ] SSH key-based auth (disable password auth)
- [ ] Database backups configured
- [ ] MinIO backups configured
- [ ] Monitoring set up (optional: Uptime Robot)

#### Hybrid Deployment
- [ ] Generated strong passwords
- [ ] VPS firewall allows only Render IPs (or use VPN)
- [ ] Redis password protected
- [ ] MinIO credentials rotated from defaults
- [ ] Render environment variables secured
- [ ] Test connectivity (Render → VPS)

---

## 📞 Getting Help

### Documentation
- **Dokploy**: https://docs.dokploy.com
- **Render**: https://render.com/docs
- **Docker Compose**: https://docs.docker.com/compose

### Community
- **Dokploy Discord**: https://discord.gg/dokploy
- **Render Community**: https://community.render.com

### Troubleshooting
- See "Troubleshooting" section in each deployment guide
- Check container logs: `docker logs <container-name>`
- Check service health: `docker ps`
- Common issues documented in guides

---

## 🎓 Learning Path

**New to self-hosting?**

1. Start with **local development** (`docker-compose.yml`)
2. Try **full VPS on staging** (`docker-compose.prod.yml`)
3. Graduate to **production** (full VPS or hybrid)

**Comfortable with Docker?**

1. Choose deployment option ([DEPLOYMENT_OPTIONS_GUIDE.md](./DEPLOYMENT_OPTIONS_GUIDE.md))
2. Follow specific guide (45-65 min)
3. Deploy and monitor

**DevOps expert?**

- Review architecture in [DEPLOYMENT_OPTIONS_GUIDE.md](./DEPLOYMENT_OPTIONS_GUIDE.md)
- Customize compose files as needed
- Deploy with your preferred tools

---

## ✅ Next Steps

1. **Read**: [DEPLOYMENT_OPTIONS_GUIDE.md](./DEPLOYMENT_OPTIONS_GUIDE.md)
2. **Choose**: Based on your needs (testing/production/hybrid)
3. **Deploy**: Follow specific guide
4. **Monitor**: Check logs and performance
5. **Optimize**: Tune based on usage

---

## 📦 All Files Included

```
deployment/
├── docker-compose.yml              # Local development
├── docker-compose.prod.yml         # Full VPS production
├── docker-compose.workers.yml      # Hybrid VPS workers
├── render.yaml                     # Current Render config
├── render.hybrid.yaml              # Hybrid Render config
├── .env.local.example              # Local env template
├── .env.prod.example               # Full VPS env template
├── .env.workers.example            # Hybrid VPS env template
├── DEPLOYMENT_OPTIONS_GUIDE.md     # Main guide (START HERE)
├── DOKPLOY_DEPLOYMENT_GUIDE.md     # Full VPS deployment
├── HYBRID_DEPLOYMENT_GUIDE.md      # Hybrid deployment
├── ENV_PRODUCTION_MAPPING.md       # Env variable mapping
└── DEPLOYMENT_FILES_README.md      # This file
```

---

**Ready to deploy?** Choose your guide and get started! 🚀
