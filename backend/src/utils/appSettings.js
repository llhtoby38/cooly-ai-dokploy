const db = require('../db');
const { child: makeLogger } = require('./logger');

const log = (() => {
  try { return makeLogger('appSettings'); } catch (_) { return { info() {}, warn() {}, error() {} }; }
})();

const DEFAULT_CACHE_MS = Math.max(1000, Number(process.env.APP_SETTINGS_CACHE_MS || 5000));

const cache = new Map();

function parseStoredValue(raw) {
  if (raw === null || typeof raw === 'undefined') return undefined;
  if (typeof raw === 'object') return raw;
  const str = String(raw);
  try { return JSON.parse(str); } catch (_) { return str; }
}

function setCache(key, value) {
  cache.set(key, { value, fetchedAt: Date.now() });
}

function shouldUseCache(entry, ttl) {
  if (!entry) return false;
  if (ttl <= 0) return false;
  return (Date.now() - entry.fetchedAt) < ttl;
}

async function getAppSetting(key, options = {}) {
  if (!key) return undefined;
  const ttl = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_CACHE_MS;
  const entry = cache.get(key);
  if (!options.force && shouldUseCache(entry, ttl)) {
    return entry.value;
  }

  try {
    const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', [key]);
    const value = rows.length ? parseStoredValue(rows[0].value) : undefined;
    setCache(key, value);
    return value;
  } catch (err) {
    try { log.warn({ event: 'app_settings.load_failed', key, msg: err?.message || String(err) }); } catch (_) {}
    setCache(key, undefined);
    return undefined;
  }
}

async function getBooleanSetting(key, defaultValue = false, options = {}) {
  const value = await getAppSetting(key, options);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return defaultValue;
}

function invalidateAppSettingCache(key) {
  if (!key) return;
  cache.delete(key);
}

function invalidateAllAppSettings() {
  cache.clear();
}

module.exports = {
  getAppSetting,
  getBooleanSetting,
  invalidateAppSettingCache,
  invalidateAllAppSettings,
};

