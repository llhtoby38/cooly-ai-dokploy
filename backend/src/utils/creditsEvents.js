const db = require('../db');

// Map<userId, Set<ServerResponse>>
const clientsByUser = new Map();

let listenerClient = null;
let listening = false;

async function ensureListener() {
  if (listening) return;
  try {
    listenerClient = await db.getClient();
    await listenerClient.query('LISTEN credits_changed');
    listenerClient.on('notification', (msg) => {
      if (!msg || msg.channel !== 'credits_changed') return;
      try {
        const payload = JSON.parse(msg.payload || '{}');
        const userId = payload && payload.user_id;
        if (!userId) return;
        const set = clientsByUser.get(String(userId));
        if (!set || set.size === 0) return;
        const data = JSON.stringify({
          credits: payload.credits,
          available: payload.available,
          reserved: payload.reserved,
          event: payload.event,
          reservation_id: payload.reservation_id,
          delta: payload.delta,
          event_ts: payload.event_ts
        });
        for (const res of set) {
          try {
            res.write('event: credits\n');
            res.write(`data: ${data}\n\n`);
          } catch (_) {}
        }
      } catch (_) {}
    });
    listening = true;
  } catch (e) {
    try { listenerClient?.release?.(); } catch {}
    listenerClient = null;
    listening = false;
    throw e;
  }
}

function addSseClient(userId, res) {
  const key = String(userId);
  let set = clientsByUser.get(key);
  if (!set) { set = new Set(); clientsByUser.set(key, set); }
  set.add(res);
  res.on('close', () => {
    try { set.delete(res); } catch {}
    if (set.size === 0) clientsByUser.delete(key);
  });
}

module.exports = {
  ensureListener,
  addSseClient,
};


