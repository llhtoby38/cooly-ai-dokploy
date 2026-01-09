const CryptoJS = require('crypto-js');

function getClientIp(req) {
  try {
    const xf = req.headers['x-forwarded-for'];
    if (xf && typeof xf === 'string') {
      const parts = xf.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length) return parts[0];
    }
    if (Array.isArray(req.ips) && req.ips.length) return req.ips[0];
    return req.ip || req.connection?.remoteAddress || '';
  } catch {
    return '';
  }
}

function hashIp(ip) {
  try {
    const salt = process.env.POSTHOG_IP_SALT || '';
    if (!ip) return null;
    const h = CryptoJS.HmacSHA256(String(ip), String(salt));
    return CryptoJS.enc.Hex.stringify(h);
  } catch {
    return null;
  }
}

async function lookupGeo(_ip) {
  // Geo lookup disabled by default; plug in your provider later if needed
  return {};
}

module.exports = { getClientIp, hashIp, lookupGeo };


