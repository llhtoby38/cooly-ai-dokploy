const { Pool } = require('pg');

// Choose DB URL based on environment
// Priority for preview detection:
// 1) VERCEL_ENV === 'preview'
// 2) Render PR preview: RENDER_EXTERNAL_URL/RENDER_EXTERNAL_HOSTNAME contains '-pr-'
// 3) RENDER_GIT_BRANCH exists and !== 'main'
// 4) Explicit ENV_NAME === 'preview'
const envName = (process.env.ENV_NAME || '').toLowerCase();
const vercelPreview = (process.env.VERCEL_ENV || '').toLowerCase() === 'preview';
const renderUrl = (process.env.RENDER_EXTERNAL_URL || '').toLowerCase();
const renderHost = (process.env.RENDER_EXTERNAL_HOSTNAME || '').toLowerCase();
const renderBranch = (process.env.RENDER_GIT_BRANCH || '').toLowerCase();

const isRenderPr = renderUrl.includes('-pr-') || renderHost.includes('-pr-');
const isRenderNonMain = !!renderBranch && renderBranch !== 'main';

const isPreviewEnv = vercelPreview || isRenderPr || isRenderNonMain || envName === 'preview';

const connectionString = (isPreviewEnv && process.env.PREVIEW_DATABASE_URL)
  ? process.env.PREVIEW_DATABASE_URL
  : process.env.DATABASE_URL;

if (!connectionString) {
  // Fail early with a clear error
  // eslint-disable-next-line no-console
  console.error('❌ No database connection string found. Expected DATABASE_URL or PREVIEW_DATABASE_URL with ENV_NAME=preview');
  throw new Error('Missing database connection string');
}

// Detect local database connections (Docker, localhost) to disable SSL
const isLocalDb = connectionString && (
  connectionString.includes('localhost') ||
  connectionString.includes('127.0.0.1') ||
  connectionString.includes('postgres:5432') || // Docker service name
  connectionString.includes('host.docker.internal') ||
  process.env.DB_SSL === 'false'
);

if (isLocalDb) {
  // eslint-disable-next-line no-console
  console.log('🔌 Local database detected - SSL disabled');
}

const pool = new Pool({
  connectionString,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
  // Pool sizing: Account for LISTEN connections (3) + worker concurrency (5) + API headroom
  // Default 20 provides room for: 3 LISTEN + 5 workers + 12 API/misc
  max: Number(process.env.PGPOOL_MAX || 20),
  // Longer idle timeout to prevent connection churn (30s default)
  idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS || 30000),
  // Connection timeout with retry (15s gives more time for busy pools)
  connectionTimeoutMillis: Number(process.env.PGPOOL_CONNECT_TIMEOUT_MS || 15000),
  // Help survive NAT/load balancers
  keepAlive: true,
  // Allow time for connections to become available (wait instead of fail)
  allowExitOnIdle: false
});

// Pool metrics for diagnostics
let poolStats = { acquired: 0, released: 0, errors: 0 };

pool.on('acquire', () => { poolStats.acquired++; });
pool.on('release', () => { poolStats.released++; });

// Log pool status periodically in debug mode
if (process.env.DEBUG_DB_POOL === 'true') {
  setInterval(() => {
    console.log('[db][pool] stats:', {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      acquired: poolStats.acquired,
      released: poolStats.released,
      errors: poolStats.errors
    });
  }, 30000).unref();
}

// Prevent unhandled errors (e.g. Supabase pooler restarts) from crashing the process
pool.on('error', (err) => {
  poolStats.errors++;
  try {
    // eslint-disable-next-line no-console
    console.warn('[db][pool] connection error', err?.message || err);
  } catch (_) {}
});

// Get pool stats for health checks
function getPoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    ...poolStats
  };
}

// Simple transient-error detection for acquire/connect/query paths
function isTransientPgError(err) {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('timeout exceeded when trying to connect') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('eai_again') ||
    msg.includes('connection terminated unexpectedly') ||
    msg.includes('server closed the connection')
  );
}

function sleep(ms) { return new Promise(r => setTimeout(r, Math.max(0, ms || 0))); }

async function withPgRetry(fn, label) {
  const attempts = Math.max(1, Number(process.env.PG_RETRY_ATTEMPTS || 3));
  const base = Math.max(0, Number(process.env.PG_RETRY_BASE_MS || 150));
  const jitter = Math.max(0, Number(process.env.PG_RETRY_JITTER_MS || 150));
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientPgError(err) || i === attempts - 1) {
        throw err;
      }
      const backoff = base * Math.pow(2, i) + Math.floor(Math.random() * (jitter + 1));
      try { /* eslint-disable no-console */ console.warn(`[db][retry] ${label || 'op'} attempt ${i + 1} failed: ${err.message}. Retrying in ${backoff}ms`); } catch(_) {}
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// Expose sanitized connection info for diagnostics (/envz)
let __parsed;
try {
  __parsed = new URL(connectionString);
} catch (_) {
  __parsed = null;
}

function getConnectionInfo() {
  const host = __parsed ? __parsed.host : undefined;
  const username = __parsed ? __parsed.username : undefined; // typically postgres.<project-ref>
  const database = __parsed ? (__parsed.pathname || '').replace(/^\//, '') : undefined;
  return {
    previewDetected: isPreviewEnv,
    host,
    username,
    database
  };
}

module.exports = {
  query: (text, params) => withPgRetry(() => pool.query(text, params), 'query'),
  getClient: () => withPgRetry(() => pool.connect(), 'connect'),
  getConnectionInfo,
  getPoolStats,
  pool // Expose pool for advanced use cases (e.g., graceful shutdown)
};