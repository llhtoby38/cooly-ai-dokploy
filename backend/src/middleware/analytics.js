const { capture } = require('../utils/analytics');
const { getClientIp, hashIp, lookupGeo } = require('../utils/ip');

// Tuning knobs (env-overridable)
const SLOW_MS = Number(process.env.ANALYTICS_API_SLOW_MS || 300);
const SAMPLE_RATE = Math.max(0, Math.min(1, Number(process.env.ANALYTICS_API_SAMPLE || 0.1)));

const EXCLUDED_PATHS = new Set(['/envz', '/healthz', '/readyz']);

function isExcluded(req) {
  const p = req.path || '';
  if (EXCLUDED_PATHS.has(p)) return true;
  if (req.method === 'OPTIONS') return true; // CORS preflight
  // Skip noisy streaming/history endpoints
  if (p.endsWith('/credits/stream')) return true;
  if (req.method === 'GET' && (p.startsWith('/api/video/seedance') || p.startsWith('/api/video/veo'))) return true;
  return false;
}

module.exports = async function analyticsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  // allow endpoints to queue analytics events centrally
  res.locals.analyticsEvents = res.locals.analyticsEvents || [];

  // Proceed immediately; attach finish listener to avoid blocking
  res.on('finish', async () => {
    try {
      const latencyNs = Number(process.hrtime.bigint() - start);
      const latencyMs = Math.max(0, Math.round(latencyNs / 1e6));

      const ua = req.headers['user-agent'] || '';
      const ref = req.headers['referer'] || req.headers['referrer'] || '';

      const ip = getClientIp(req);
      const ipHash = hashIp(ip);
      const geo = await lookupGeo(ip);

      // Identity: prefer logged-in user, else client-provided PostHog distinct id, else anonymous
      const userId = req.user?.id ? String(req.user.id) : null;
      const clientDistinct = req.headers['x-posthog-distinct-id'] ? String(req.headers['x-posthog-distinct-id']) : null;
      const anonymousId = req.cookies?.anonymousId || null;
      const distinctId = userId || clientDistinct || anonymousId || ipHash || 'anonymous';

      // Generic API event (errors, slow requests, or sampled)
      if (!isExcluded(req)) {
        const isError = Number(res.statusCode) >= 400;
        const isSlow = latencyMs >= SLOW_MS;
        const isSampled = Math.random() < SAMPLE_RATE;
        if (isError || isSlow || isSampled) {
          capture({
            distinctId,
            event: 'API Request',
            properties: {
              route: req.path,
              method: req.method,
              status: res.statusCode,
              latencyMs,
              userAgent: ua,
              referer: ref || undefined,
              ipHash: ipHash || undefined,
              sampled: isSampled || undefined,
              slow: isSlow || undefined,
              error: isError || undefined,
              ...geo
            }
          });
        }
      }

      // Lightweight mapping for key domain events
      try {
        if (req.method === 'POST' && req.path === '/api/images/seedream4/generate') {
          const b = req.body || {};
          capture({
            distinctId,
            event: 'Generation Started',
            properties: {
              tool: 'seedream4',
              model: b.model,
              size: b.size,
              aspectRatio: b.aspect_ratio || b.aspectRatio,
              outputs: b.outputs,
            }
          });
        } else if (req.method === 'POST' && req.path === '/api/seedance/generate') {
          const b = req.body || {};
          capture({
            distinctId,
            event: 'Generation Started',
            properties: {
              tool: 'seedance',
              model: b.model,
              resolution: b.resolution,
              aspectRatio: b.aspectRatio,
              duration: b.duration,
            }
          });
        } else if (req.method === 'POST' && (req.path === '/api/image/price' || req.path === '/api/seedance/price')) {
          const b = req.body || {};
          capture({ distinctId, event: 'Pricing Viewed', properties: { path: req.path, ...b } });
        } else if (req.method === 'POST' && req.path === '/api/veo31/generate') {
          const b = req.body || {};
          capture({
            distinctId,
            event: 'Generation Started',
            properties: {
              tool: 'veo31',
              model: b.model,
              resolution: b.resolution,
              aspectRatio: b.aspectRatio,
              duration: b.duration,
            }
          });
        } else if (req.method === 'GET' && req.path.startsWith('/api/templates/')) {
          const parts = req.path.split('/').filter(Boolean);
          const tool = parts[2];
          const slug = parts[3];
          capture({ distinctId, event: 'Template Fetched', properties: { tool, slug } });
        }
      } catch {}

      // Flush any queued endpoint-specific events (centralized)
      try {
        const queued = Array.isArray(res.locals.analyticsEvents) ? res.locals.analyticsEvents : [];
        if (queued.length > 0) {
          const seen = new Set();
          for (const ev of queued) {
            if (!ev || !ev.event) continue;
            const key = `${ev.event}|${JSON.stringify(ev.properties || {})}`;
            if (seen.has(key)) continue; // de-dupe
            seen.add(key);
            capture({
              distinctId: String(ev.distinctId || distinctId || 'anonymous'),
              event: ev.event,
              properties: ev.properties || {}
            });
          }
        }
      } catch {}
    } catch {}
  });

  next();
};


