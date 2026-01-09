const db = require('../db');
const jwt = require('jsonwebtoken');

let __cache = null;
let __ts = 0;
const DEFAULT_TTL_MS = Number(process.env.FEATURE_FLAG_CACHE_MS || 3000);

async function loadFlags() {
  try {
    const { rows } = await db.query(`SELECT key, value FROM app_settings WHERE key LIKE 'feature_%'`);
    const map = {};
    for (const r of rows || []) {
      const k = String(r.key || '').replace(/^feature_/, '');
      let v;
      try { v = JSON.parse(r.value); } catch { v = r.value; }
      map[k] = (v === true || v === 'true');
    }
    return map;
  } catch {
    return {};
  }
}

async function getFlags() {
  const ttl = DEFAULT_TTL_MS;
  if (!__cache || (Date.now() - __ts) > ttl) {
    __cache = await loadFlags();
    __ts = Date.now();
  }
  return __cache;
}

function envTrue(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function anyEnvTrue(names) {
  return names.some((n) => envTrue(n));
}

async function shouldMock(toolKey, req) {
  const flags = await getFlags();
  let overrides = {};
  // Optional per-request overrides via signed header token
  try {
    if (req && req.headers && req.headers['x-mock-override']) {
      const token = String(req.headers['x-mock-override'] || '');
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload && payload.scope === 'load_test' && payload.flags && typeof payload.flags === 'object') {
        overrides = Object.fromEntries(
          Object.entries(payload.flags).map(([k, v]) => [String(k).toLowerCase(), Boolean(v)])
        );
      }
    }
  } catch (_) {}
  const anyOverride = (...keys) => keys.some(k => overrides[k] === true);
  const anyFlag = (...keys) => keys.some(k => flags[k] === true);

  switch (String(toolKey).toLowerCase()) {
    case 'seedream3':
      return anyOverride('mock_api','mock_seedream3') || anyFlag('mock_api', 'mock_seedream3') || anyEnvTrue(['MOCK_API','MOCK_SEEDREAM3']);
    case 'seedream4':
      return anyOverride('mock_api','mock_seedream4') || anyFlag('mock_api', 'mock_seedream4') || anyEnvTrue(['MOCK_API','MOCK_SEEDREAM4']);
    case 'seedance':
      return anyOverride('mock_api','mock_video','mock_seedance') || anyFlag('mock_api', 'mock_video', 'mock_seedance') || anyEnvTrue(['MOCK_API','MOCK_VIDEO','MOCK_SEEDANCE']);
    case 'sora2':
      return anyOverride('mock_api','mock_video','mock_sora') || anyFlag('mock_api', 'mock_video', 'mock_sora') || anyEnvTrue(['MOCK_API','MOCK_VIDEO','MOCK_SORA']);
    case 'veo31':
      return anyOverride('mock_api','mock_video','mock_veo31') || anyFlag('mock_api', 'mock_video', 'mock_veo31') || anyEnvTrue(['MOCK_API','MOCK_VIDEO','MOCK_VEO31']);
    case 'video':
      return anyOverride('mock_api','mock_video') || anyFlag('mock_api', 'mock_video') || anyEnvTrue(['MOCK_API','MOCK_VIDEO']);
    default:
      return anyOverride('mock_api') || anyFlag('mock_api') || anyEnvTrue(['MOCK_API']);
  }
}

module.exports = { shouldMock };


