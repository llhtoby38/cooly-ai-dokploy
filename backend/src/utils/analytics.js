const { PostHog } = require('posthog-node');

let client = null;

function getClient() {
  if (client) return client;
  const key = process.env.POSTHOG_KEY;
  const host = process.env.POSTHOG_HOST || 'https://app.posthog.com';
  if (!key) return null;
  client = new PostHog(key, {
    host,
    flushAt: 20,
    flushInterval: 2000,
    maxBatchSize: 100,
    requestTimeout: 3500
  });
  return client;
}

async function capture({ distinctId, event, properties }) {
  try {
    const c = getClient();
    if (!c || !event) return;
    c.capture({ distinctId: String(distinctId || 'anonymous'), event, properties });
  } catch {}
}

function shutdown() {
  try { if (client) client.shutdown(); } catch {}
}

module.exports = { capture, shutdown };


