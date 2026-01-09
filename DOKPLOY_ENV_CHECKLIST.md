# Dokploy Environment Variables Checklist

**IMPORTANT:** Make sure your `.env` file on Dokploy has these EXACT values for the domains:

## Critical Settings (Must Be Exact)

```bash
# ✅ CORRECT - Use these values
DOMAIN=cooly.thetasai.cloud
API_DOMAIN=api.thetasai.cloud
MINIO_DOMAIN=minio.thetasai.cloud
MINIO_CONSOLE_DOMAIN=console.thetasai.cloud

# CORS & URLs
FRONTEND_URL=https://cooly.thetasai.cloud
ALLOWED_ORIGINS=https://cooly.thetasai.cloud,https://www.cooly.thetasai.cloud
COOKIE_DOMAIN=thetasai.cloud                    # ⚠️ NO SUBDOMAIN! This is critical for auth
APP_BASE_URL=https://api.thetasai.cloud
FRONTEND_BASE_URL=https://cooly.thetasai.cloud

# Frontend Public Variables
NEXT_PUBLIC_API_BASE=https://api.thetasai.cloud
```

## ❌ WRONG Values (Do NOT Use)

```bash
# These will cause 404 errors:
DOMAIN=app.thetasai.cloud                       # Wrong! Old domain
COOKIE_DOMAIN=cooly.thetasai.cloud              # Wrong! Should be thetasai.cloud
NEXT_PUBLIC_API_BASE=http://localhost:5000      # Wrong! Local dev only
FRONTEND_URL=http://localhost:3000              # Wrong! Local dev only
```

## How to Verify on Dokploy

1. SSH into your Dokploy server
2. Navigate to your project directory
3. Check the `.env` file:
   ```bash
   grep -E "^DOMAIN=|^COOKIE_DOMAIN=|^NEXT_PUBLIC_API_BASE=" .env
   ```
4. Should see:
   ```
   DOMAIN=cooly.thetasai.cloud
   COOKIE_DOMAIN=thetasai.cloud
   NEXT_PUBLIC_API_BASE=https://api.thetasai.cloud
   ```

## If You Need to Copy the Entire .env File

The safe `.env` file is already on your Dokploy server at the project root. Do NOT copy from:
- ❌ `/Users/tobylee/Documents/GitHub/cooly-ai/.env.local` (local dev settings)
- ❌ `/Users/tobylee/Documents/GitHub/cooly-ai/.env.prod` (might have old domains)

Instead:
- ✅ Use the existing `.env` in `/Users/tobylee/Documents/GitHub/cooly-ai-dokploy/.env`
- ✅ Or copy from your running Dokploy server if it's working
