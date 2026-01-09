# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Copy package files
COPY frontend/package.json frontend/package-lock.json ./

# Install dependencies with verbose output
RUN npm ci --verbose && ls -la /app/node_modules

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Build arguments for environment injection
ARG NEXT_PUBLIC_API_BASE=http://localhost:5000
ARG NEXT_PUBLIC_MOCK_API=false
ARG NEXT_PUBLIC_DEBUG_LOGS=false

# Set environment variables for build
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_MOCK_API=$NEXT_PUBLIC_MOCK_API
ENV NEXT_PUBLIC_DEBUG_LOGS=$NEXT_PUBLIC_DEBUG_LOGS
ENV NEXT_TELEMETRY_DISABLED=1

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy frontend source
COPY frontend/ ./

# Build the application
# Remove prebuild script since NEXT_PUBLIC_API_BASE is set via build args
# The inject-api-base.js script isn't available in Docker context
RUN npm pkg delete scripts.prebuild 2>/dev/null || true
RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

# Environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy public assets
COPY --from=builder /app/public ./public

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check - use 127.0.0.1 instead of localhost to avoid IPv6 issues
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/ || exit 1

# Start the application
CMD ["node", "server.js"]
