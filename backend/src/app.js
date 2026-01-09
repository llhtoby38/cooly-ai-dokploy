const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
// Load env ONLY from repo root .env
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const port = process.env.PORT || 5000;

// Trust proxy for correct IP logging/rate limiting behind proxies
app.set('trust proxy', 1);
// Disable ETag to avoid 304 caching on dynamic API responses
app.set('etag', false);

// Logger (pino-http) with shared base logger
const pinoHttp = require('pino-http');
const { logger } = require('./utils/logger');

const sampleRate = Math.max(0, Math.min(1, Number(process.env.LOG_SAMPLE_2XX_RATE || 0)));
function isSsePath(url) {
  return (url && (url.endsWith('/stream') || /\/progress\/stream/.test(url)));
}

app.use(pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => {
      if (!req || !req.url) return false;
      if (req.method === 'OPTIONS') return true; // skip CORS preflights
      if (req.url === '/envz') return true; // noisy env endpoint
      if (isSsePath(req.url)) return true; // long-lived SSE
      return false;
    }
  },
  customLogLevel: (req, res, err) => {
    if (err) return 'error';
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    // Sampling for high-traffic 2xx endpoints
    const url = req && req.url ? req.url : '';
    const isSampledPath = (
      url.startsWith('/api/images/seedream4/history') ||
      url.startsWith('/api/image/price')
    );
    if (res.statusCode < 400 && isSampledPath && sampleRate > 0 && sampleRate < 1) {
      if (Math.random() > sampleRate) return 'silent';
    }
    return 'info';
  }
}));

// Static serving of local videos removed; videos are streamed from provider URLs now.

// Special handling for Stripe webhooks - must be raw body (BEFORE JSON parsing)
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// Security
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Basic rate limiter (does not affect Stripe webhook path)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Middleware
app.use(express.json());
app.use(cookieParser());
// Analytics middleware (non-blocking, batched)
try { app.use(require('./middleware/analytics')); } catch {}
// Allowed origins for CORS – configurable via env
const defaultOrigins = [
  'http://localhost:3000',
  'https://cooly-ai.vercel.app'
];
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)
  .concat(defaultOrigins);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow mobile apps / curl
    if (
      allowedOrigins.includes(origin) ||
      /.*\.vercel\.app$/.test(origin) ||
      /.*--cooly-ai-api\.onrender\.com$/.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error('CORS not allowed')); // reject other origins
  },
  credentials: true
}));

// Simple circuit breaker: deny new generation POSTs briefly when DB connect is unstable
try {
  const { isOpen } = require('./utils/circuitBreaker');
  app.use((req, res, next) => {
    try {
      if (req.method !== 'POST') return next();
      const url = req.url || '';
      const isGen = (
        url.startsWith('/api/image/generate') ||
        url.startsWith('/api/images/seedream4/generate') ||
        url.startsWith('/api/video/seedance/generate') ||
        url.startsWith('/api/veo31/generate')
      );
      if (!isGen) return next();
      if (isOpen && isOpen()) {
        return res.status(503).json({ error: 'temporarily unavailable, please retry shortly' });
      }
      return next();
    } catch (_) { return next(); }
  });
} catch (_) {}

// Import routes
const imageGenerationRouter = require('./api/imageGeneration');
// Lightweight env/DB diagnostics
const db = require('./db');
app.get('/envz', (_req, res) => {
  try {
    const info = db.getConnectionInfo ? db.getConnectionInfo() : {};
    const envName = process.env.ENV_NAME || process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown';
    // Surface mock flags so frontend can display active modes (read-only)
    const mocks = {
      MOCK_API: String(process.env.MOCK_API || '').toLowerCase() === 'true',
      MOCK_SEEDREAM3: String(process.env.MOCK_SEEDREAM3 || '').toLowerCase() === 'true',
      MOCK_SEEDREAM4: String(process.env.MOCK_SEEDREAM4 || '').toLowerCase() === 'true',
      MOCK_SEEDANCE: String(process.env.MOCK_SEEDANCE || '').toLowerCase() === 'true',
      MOCK_VIDEO: String(process.env.MOCK_VIDEO || '').toLowerCase() === 'true',
      MOCK_SORA: String(process.env.MOCK_SORA || '').toLowerCase() === 'true'
    };
    res.json({ envName, db: info, mocks });
  } catch (e) {
    res.json({ envName: process.env.ENV_NAME || process.env.VERCEL_ENV || 'unknown', mocks: {} });
  }
});
const imageGenerationV3Router = require('./api/imageGeneration_v3');
const seedream4Router = require('./api/seedream4');
const byteplusTTSRouter = require('./api/byteplusTTS');
const videoGenerationRouter = require('./api/videoGeneration');
const videoHistoryVeosRouter = require('./api/videoHistoryVeos');
const videoHistorySeedanceRouter = require('./api/videoHistorySeedance');
const templatesRouter = require('./api/templates');
const veo31Router = require('./api/veo31');
const authRouter = require('./api/auth');
const billingRouter = require('./api/billing');
const userRouter = require('./api/user');
const seedanceRouter = require('./api/seedance');
const adminRouter = require('./api/admin');
const soraRouter = require('./api/sora2');
const { startCaptureWorker } = require('./workers/captureWorker');
const { startSeedanceSweeper } = require('./workers/seedanceSweeper');
const { startSessionSweeper } = (() => { try { return require('./workers/sessionSweeper'); } catch { return {}; } })();
// Optionally start BullMQ worker in-process (for dev). In prod, prefer a separate worker process.
try {
  if (String(process.env.START_GEN_WORKER || '').toLowerCase() === 'true') {
    require('./queue/genWorker');
  }
} catch (_) {}

// Use routes
app.use('/api/auth', authRouter);
app.use('/api/image', imageGenerationRouter);
app.use('/api/images/seedream4', seedream4Router);
app.use('/api/images/seedream3', imageGenerationV3Router);
app.use('/api/tts', byteplusTTSRouter);
app.use('/api/video', videoGenerationRouter);
app.use('/api/video/veo', videoHistoryVeosRouter);
app.use('/api/video/seedance', videoHistorySeedanceRouter);
app.use('/api/billing', billingRouter);
app.use('/api/user', userRouter);
app.use('/api/seedance', seedanceRouter);
app.use('/api/sora2', soraRouter);
app.use('/api/veo31', veo31Router);
app.use('/api/admin', adminRouter);
app.use('/api/templates', templatesRouter);

// Download proxy endpoint
app.get('/api/download', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    // Validate URL to prevent abuse
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // Convert browser-accessible S3 URLs to internal endpoints for server-side access
    // This handles both local MinIO (localhost:9000 → minio:9000) and potential production scenarios
    let fetchUrl = url;
    const s3PublicUrl = process.env.S3_PUBLIC_URL;
    const s3Endpoint = process.env.S3_ENDPOINT;

    if (s3PublicUrl && s3Endpoint && url.startsWith(s3PublicUrl.replace(/\/$/, ''))) {
      // Replace browser-facing URL with internal endpoint
      fetchUrl = url.replace(s3PublicUrl.replace(/\/$/, ''), s3Endpoint.replace(/\/$/, ''));
    }

    // Fetch the file from the external URL
    const response = await fetch(fetchUrl);
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch file' });
    }
    
    // Get content type and filename
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = response.headers.get('content-disposition');
    
    // Extract filename from URL if not in content-disposition
    let filename = 'download';
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) filename = match[1];
    } else {
      const urlPath = new URL(url).pathname;
      filename = urlPath.split('/').pop() || 'download';
    }
    
    // Set headers for download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    
    // Convert response to buffer and send
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
    
  } catch (error) {
    console.error('Download proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health endpoints
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/readyz', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.status(200).send('ready');
  } catch (e) {
    res.status(503).send('not-ready');
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler (last)
app.use((err, req, res, _next) => {
  req.log?.error({ err }, 'Unhandled error');
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : (err?.message || 'Error');
  const status = err?.statusCode || 500;
  res.status(status).json({ error: message });
});

app.get('/', (req, res) => {
  res.send('API is running');
});

app.listen(port, async () => {
  try { logger.info({ event: 'server.start', port }); } catch {}
  
  // Start metrics collector
  try {
    const metricsCollector = require('./utils/metricsCollector');
    await metricsCollector.start();
    try { logger.info({ event: 'metrics.started' }); } catch {}
  } catch (error) {
    console.error('Failed to start metrics collector:', error);
  }

  // Start capture worker (background reservation finalizer)
  try {
    if ((process.env.ENABLE_CAPTURE_WORKER || 'true').toLowerCase() === 'true') {
      startCaptureWorker();
    }
  } catch (e) {
    console.error('Failed to start capture worker:', e);
  }

  // Start Seedance sweeper (finalizes stuck processing sessions)
  try {
    if ((process.env.ENABLE_SEEDANCE_SWEEPER || 'true').toLowerCase() === 'true') {
      startSeedanceSweeper();
      try { logger.info({ event: 'seedanceSweeper.started' }); } catch {}
    }
  } catch (e) {
    console.error('Failed to start Seedance sweeper:', e);
  }

  // Start centralized session sweeper (generic watchdog for all tools)
  try {
    if ((process.env.ENABLE_SESSION_SWEEPER || 'true').toLowerCase() === 'true' && typeof startSessionSweeper === 'function') {
      startSessionSweeper();
      try { logger.info({ event: 'sessionSweeper.started' }); } catch {}
    }
  } catch (e) {
    console.error('Failed to start Session sweeper:', e);
  }

  // Start Outbox relay (reliable handoff to queue)
  try {
    if (String(process.env.START_OUTBOX_RELAY || '').toLowerCase() === 'true') {
      const { startOutboxRelay } = require('./workers/outboxRelay');
      startOutboxRelay();
      try { logger.info({ event: 'outboxRelay.started' }); } catch {}
    }
  } catch (e) {
    console.error('Failed to start Outbox relay:', e);
  }
});
