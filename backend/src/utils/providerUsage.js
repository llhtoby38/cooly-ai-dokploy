const db = require('../db');

function safeUsageFrom(obj) {
  if (!obj || typeof obj !== 'object') return null;
  // Common patterns: { usage: {...} } or usage at top-level
  const usage = obj.usage || obj.data?.usage || null;
  return usage && typeof usage === 'object' ? usage : null;
}

async function logProviderUsage({ userId, sessionId = null, taskId = null, provider, model = null, endpoint = null, raw, timing = null }) {
  try {
    // Opt-in via env to avoid errors if the audit table is not present
    const enabled = String(process.env.ENABLE_PROVIDER_USAGE_LOGS || '').toLowerCase() === 'true';
    if (!enabled) return;
    const providerUsage = safeUsageFrom(raw) || {};
    // Merge timing data into usage object for comprehensive logging
    const usage = {
      ...providerUsage,
      ...(timing ? { timing } : {})
    };
    await db.query(
      `INSERT INTO provider_usage_logs (user_id, session_id, task_id, provider, model, endpoint, usage)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, sessionId, taskId, provider, model, endpoint, Object.keys(usage).length > 0 ? JSON.stringify(usage) : null]
    );
  } catch (e) {
    // Swallow errors to avoid impacting request flow
    const msg = e?.message || '';
    // Silence missing-table errors
    if (msg.includes('relation "provider_usage_logs" does not exist') || msg.includes('provider_usage_logs')) return;
    if (String(process.env.NODE_ENV).toLowerCase() !== 'production') {
      console.warn('[providerUsage] insert failed', msg);
    }
  }
}

module.exports = { logProviderUsage };


