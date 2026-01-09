const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const db = require('../db');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { invalidateAppSettingCache } = require('../utils/appSettings');

async function logAdminAction(req, action, targetType, targetId, details) {
  try {
    const adminId = req.admin?.id;
    // target_id in some actions isn't a UUID (e.g., settings key). Store as text in details instead.
    await db.query(
      `INSERT INTO admin_actions (admin_id, action, target_type, target_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, NULL, $4, $5, $6)` ,
      [adminId || null, action, targetType, details ? JSON.stringify({ targetId, ...details }) : JSON.stringify({ targetId }), req.ip || null, req.headers['user-agent'] || null]
    );
  } catch (e) {
    console.warn('admin action log failed:', e.message || e);
  }
}

// Admin login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Check if user exists and is admin
    const result = await db.query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1 AND role = $2',
      [email, 'admin']
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    
    // Verify password (you'll need to implement password hashing)
    // For now, using a simple check - replace with proper bcrypt
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      admin: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get dashboard overview
router.get('/dashboard', adminAuth, async (req, res) => {
  try {
    // Get total users
    const usersResult = await db.query('SELECT COUNT(*) as total FROM users');
    const totalUsers = usersResult.rows[0].total;

    // Get active subscriptions
    const subsResult = await db.query(`
      SELECT COUNT(*) as total, 
             SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active
      FROM subscriptions
    `);
    const subscriptions = subsResult.rows[0];

    // Get total revenue (last 30 days)
    const revenueResult = await db.query(`
      SELECT SUM(amount) as total_revenue
      FROM credit_transactions 
      WHERE amount > 0 
      AND created_at >= NOW() - INTERVAL '30 days'
    `);
    const revenue = revenueResult.rows[0].total_revenue || 0;

    // Get credit usage (last 30 days)
    const usageResult = await db.query(`
      SELECT SUM(ABS(amount)) as total_usage
      FROM credit_transactions 
      WHERE amount < 0 
      AND created_at >= NOW() - INTERVAL '30 days'
    `);
    const creditUsage = usageResult.rows[0].total_usage || 0;

    // Get recent users
    const recentUsersResult = await db.query(`
      SELECT id, email, created_at, credits
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    // Get recent credit transactions
    const recentTransactionsResult = await db.query(`
      SELECT ct.*, u.email as user_email
      FROM credit_transactions ct
      JOIN users u ON ct.user_id = u.id
      ORDER BY ct.created_at DESC 
      LIMIT 10
    `);

    res.json({
      overview: {
        totalUsers: parseInt(totalUsers),
        activeSubscriptions: parseInt(subscriptions.active),
        totalSubscriptions: parseInt(subscriptions.total),
        revenue: parseFloat(revenue),
        creditUsage: parseInt(creditUsage)
      },
      recentUsers: recentUsersResult.rows,
      recentTransactions: recentTransactionsResult.rows
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Settings: get all app settings (subset used by UI)
router.get('/settings', adminAuth, async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT key, value FROM app_settings`);
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    res.json({ settings: obj });
  } catch (e) {
    console.error('Admin get settings error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Settings: update a single setting
router.put('/settings/:key', adminAuth, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body || {};
    if (typeof value === 'undefined') {
      return res.status(400).json({ error: 'Missing value' });
    }
    const jsonVal = typeof value === 'object' ? value : (value === true || value === false ? value : String(value));
    const { rows } = await db.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
       RETURNING key, value`,
      [key, JSON.stringify(jsonVal)]
    );
    await logAdminAction(req, 'settings.update', 'app_settings', key, { value: jsonVal });
    invalidateAppSettingCache(key);
    res.json({ setting: rows[0] });
  } catch (e) {
    console.error('Admin update setting error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Soft-delete user by id or email. Finance ledger remains linked.
router.delete('/users', adminAuth, async (req, res) => {
  try {
    const { id, email } = req.query;
    if (!id && !email) {
      return res.status(400).json({ error: 'Provide id or email' });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Resolve user
      const sel = id ?
        await client.query('SELECT id, email, credits, deleted_at FROM users WHERE id = $1', [id]) :
        await client.query('SELECT id, email, credits, deleted_at FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL', [email]);
      if (sel.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found' });
      }
      const u = sel.rows[0];

      // Log snapshot
      await logAdminAction(req, 'user.soft_delete.request', 'user', u.id, { email: u.email, credits: u.credits });

      // Soft delete: mark deleted_at, keep row and all FKs intact
      await client.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [u.id]);

      await client.query('COMMIT');
      await logAdminAction(req, 'user.soft_delete', 'user', u.id, { email: u.email });
      res.json({ success: true, softDeleted: true });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('Admin delete user error:', e);
      res.status(500).json({ error: 'Failed to delete user' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Admin delete user route error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users with pagination (exclude soft-deleted by default)
router.get('/users', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    const offset = (page - 1) * limit;

  let query = `
      SELECT u.id, u.email, u.created_at, u.credits, u.role,
             s.status as subscription_status,
             s.plan_id,
             s.plan_name as subscription_plan_name,
             s.sub_billing_mode as subscription_billing_mode
      FROM users u
      LEFT JOIN LATERAL (
        SELECT s.status, s.plan_id, s.created_at,
               sp.display_name as plan_name,
               s.billing_mode as sub_billing_mode
        FROM subscriptions s
        LEFT JOIN subscription_plans sp
          ON sp.plan_key = s.plan_id AND sp.billing_mode = s.billing_mode
        WHERE s.user_id = u.id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) s ON TRUE
    WHERE u.deleted_at IS NULL
    `;
    
    const params = [];
    let paramIndex = 1;

    if (search) {
      query += ` WHERE u.email ILIKE $${paramIndex}`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY u.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM users u WHERE u.deleted_at IS NULL';
    if (search) {
      countQuery += ' AND u.email ILIKE $1';
    }
    const countResult = await db.query(countQuery, search ? [`%${search}%`] : []);
    const total = countResult.rows[0].count;

    res.json({
      users: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Users list error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user details
router.get('/users/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Get user info
    const userResult = await db.query(`
      SELECT u.*, s.status as subscription_status, s.plan_id, s.created_at as subscription_created,
             s.plan_name as subscription_plan_name,
             s.sub_billing_mode as subscription_billing_mode
      FROM users u
      LEFT JOIN LATERAL (
        SELECT s.status, s.plan_id, s.created_at,
               sp.display_name as plan_name,
               s.billing_mode as sub_billing_mode
        FROM subscriptions s
        LEFT JOIN subscription_plans sp
          ON sp.plan_key = s.plan_id AND sp.billing_mode = s.billing_mode
        WHERE s.user_id = u.id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) s ON TRUE
      WHERE u.id = $1
    `, [id]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's credit transactions
    const transactionsResult = await db.query(`
      SELECT * FROM credit_transactions 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT 50
    `, [id]);

    res.json({
      user: userResult.rows[0],
      transactions: transactionsResult.rows
    });
  } catch (error) {
    console.error('User details error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Adjust user credits (consumes/creates credit_lots and logs credit_transactions)
router.post('/users/:id/credits', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;

    if (!amount || !reason) {
      return res.status(400).json({ error: 'Amount and reason required' });
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) {
      return res.status(400).json({ error: 'Amount must be a non-zero number' });
    }

    // Use credits utility to keep lots and cache consistent
    const credits = require('../utils/credits');
    if (n > 0) {
      // Use allowed source value for credit_lots CHECK constraint
      const r = await credits.addCredits(id, n, { source: 'one_off', description: `Admin adjustment: ${reason}` });
      if (!r.success) return res.status(500).json({ error: r.error || 'Failed to add credits' });
      await logAdminAction(req, 'credits.add', 'user', id, { amount: n, reason });
      return res.json({ success: true, newCredits: r.creditsLeft });
    } else {
      const r = await credits.debitCredits(id, Math.abs(n), { description: `Admin adjustment: ${reason}` });
      if (!r.success) return res.status(400).json({ error: r.error || 'Failed to debit credits' });
      await logAdminAction(req, 'credits.debit', 'user', id, { amount: n, reason });
      return res.json({ success: true, newCredits: r.creditsLeft });
    }
  } catch (error) {
    console.error('Credit adjustment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// List credit transactions (admin)
router.get('/transactions', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, email = '', startDate, endDate, include_expiry = 'true' } = req.query;
    const offset = (page - 1) * limit;

    // Build base query with optional email filter and date range
    let whereClauses = [];
    const params = [];
    let paramIndex = 1;

    if (email) {
      whereClauses.push(`u.email ILIKE $${paramIndex++}`);
      params.push(`%${email}%`);
    }
    if (startDate) {
      whereClauses.push(`ct.created_at >= $${paramIndex++}`);
      params.push(startDate);
    }
    if (endDate) {
      whereClauses.push(`ct.created_at <= $${paramIndex++}`);
      params.push(endDate);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const listSql = `
      SELECT ct.id, ct.user_id, u.email AS user_email, ct.description, ct.amount, ct.balance_after, ct.created_at
      FROM credit_transactions ct
      JOIN users u ON u.id = ct.user_id
      ${whereSql}
      ORDER BY ct.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const listParams = params.concat([Number(limit), Number(offset)]);

    const countSql = `
      SELECT COUNT(*) AS total
      FROM credit_transactions ct
      JOIN users u ON u.id = ct.user_id
      ${whereSql}
    `;

    const [listRes, countRes] = await Promise.all([
      db.query(listSql, listParams),
      db.query(countSql, params)
    ]);

    const total = parseInt(countRes.rows[0].total);

    res.json({
      transactions: listRes.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Admin list transactions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Manually sweep and log expirations for overdue lots (admin tool)
router.post('/transactions/expire-overdue', adminAuth, async (req, res) => {
  try {
    const { user_id } = req.body || {};
    const params = [];
    let filter = '';
    if (user_id) { filter = ' AND l.user_id = $1'; params.push(user_id); }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      // Select overdue open lots with remaining > 0
      const { rows: lots } = await client.query(
        `select l.id, l.user_id, l.remaining, l.expires_at, l.source
         from credit_lots l
         where l.closed_at is null and l.remaining > 0 and l.expires_at <= now()
         ${filter}
         for update`, params);

      for (const lot of lots) {
        const rem = Number(lot.remaining || 0);
        if (rem <= 0) continue;
        // Snapshot balance after expiration
        const { rows: balRows } = await client.query(
          `select coalesce(sum(remaining),0) as rem from credit_lots
           where user_id=$1 and remaining>0 and (closed_at is null) and (expires_at > now() or source='one_off')`,
          [lot.user_id]
        );
        const snapBal = Math.max(Number(balRows[0]?.rem || 0) - rem, 0);
        await client.query(
          `insert into credit_transactions (user_id, description, amount, balance_after, lot_id, expires_at)
           values ($1,$2,$3,$4,$5,$6)`,
          [lot.user_id, 'Expired credits', -rem, snapBal, lot.id, lot.expires_at]
        );
        await client.query('update credit_lots set remaining = 0, closed_at = now() where id=$1', [lot.id]);
        await client.query('update users set credits = $1 where id = $2', [snapBal, lot.user_id]);
      }

      await client.query('COMMIT');
      res.json({ success: true, expiredLots: lots.length });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('expire-overdue error:', e);
      res.status(500).json({ error: 'Failed to expire overdue lots' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Admin expire-overdue error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get system health metrics
router.get('/health-metrics', adminAuth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT * FROM system_health_metrics 
      ORDER BY recorded_at DESC, metric_name ASC
    `);
    res.json({ metrics: rows });
  } catch (error) {
    console.error('Health metrics error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get metrics collector status
router.get('/health-metrics/status', adminAuth, async (req, res) => {
  try {
    const metricsCollector = require('../utils/metricsCollector');
    const status = metricsCollector.getStatus();
    res.json({ status });
  } catch (error) {
    console.error('Metrics collector status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start metrics collector
router.post('/health-metrics/start', adminAuth, async (req, res) => {
  try {
    const metricsCollector = require('../utils/metricsCollector');
    await metricsCollector.start();
    res.json({ success: true, message: 'Metrics collector started' });
  } catch (error) {
    console.error('Start metrics collector error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Stop metrics collector
router.post('/health-metrics/stop', adminAuth, async (req, res) => {
  try {
    const metricsCollector = require('../utils/metricsCollector');
    metricsCollector.stop();
    res.json({ success: true, message: 'Metrics collector stopped' });
  } catch (error) {
    console.error('Stop metrics collector error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Trigger manual metrics collection
router.post('/health-metrics/collect', adminAuth, async (req, res) => {
  try {
    const metricsCollector = require('../utils/metricsCollector');
    await metricsCollector.collectAllMetrics();
    res.json({ success: true, message: 'Metrics collection triggered' });
  } catch (error) {
    console.error('Manual metrics collection error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Controlled load test: simulate multiple generation requests across users
// Safety: requires explicit allow env flag and caps on totals
let __activeLoadTest = null;
router.post('/load-test/start', adminAuth, async (req, res) => {
  try {
    // Gate via env OR app_settings.enable_admin_load_test
    let enableFromSettings = false;
    try {
      const r = await db.query(`SELECT value FROM app_settings WHERE key = 'enable_admin_load_test' LIMIT 1`);
      if (r.rows?.length) {
        const v = JSON.parse(r.rows[0].value);
        enableFromSettings = v === true || v === 'true';
      }
    } catch (_) {}
    if (!enableFromSettings && String(process.env.ENABLE_ADMIN_LOAD_TEST || '').toLowerCase() !== 'true') {
      return res.status(403).json({ error: 'Load test disabled (enable in settings or set ENABLE_ADMIN_LOAD_TEST=true)' });
    }
    if (__activeLoadTest?.running) {
      return res.status(409).json({ error: 'Load test already running' });
    }
    const {
      totalRequests = 50,
      concurrent = 5,
      users = [],
      userEmails = [],
      userIds = [],
      model = 'seedream-3-0-t2i-250415',
      outputs = 1,
      prompt = 'A scenic landscape at sunset',
      // optional toggles set via app_settings for test window
      toggles = { MOCK_API: undefined },
      uiParity = false
    } = req.body || {};

    // Caps can be overridden by app_settings
    let capReq = Number(process.env.LOAD_TEST_MAX_REQUESTS || 200);
    let capConc = Number(process.env.LOAD_TEST_MAX_CONCURRENCY || 10);
    try {
      const r = await db.query(`SELECT key, value FROM app_settings WHERE key IN ('load_test_max_requests','load_test_max_concurrency')`);
      for (const row of r.rows || []) {
        const v = Number(JSON.parse(row.value));
        if (row.key === 'load_test_max_requests' && Number.isFinite(v)) capReq = v;
        if (row.key === 'load_test_max_concurrency' && Number.isFinite(v)) capConc = v;
      }
    } catch (_) {}
    const maxRequests = Math.min(Number(totalRequests) || 0, capReq);
    const maxConcurrent = Math.min(Number(concurrent) || 1, capConc);
    if (maxRequests <= 0 || maxConcurrent <= 0) {
      return res.status(400).json({ error: 'invalid totalRequests or concurrent' });
    }

    const apiBase = process.env.PUBLIC_API_BASE || process.env.API_BASE || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5000';

    // Apply temporary toggles in app_settings (scoped, not global env)
    try {
      if (toggles && typeof toggles === 'object') {
        const entries = Object.entries(toggles).filter(([,v]) => typeof v !== 'undefined');
        for (const [k, v] of entries) {
          const key = `feature_${String(k).toLowerCase()}`; // e.g., feature_mock_api
          await db.query(
            `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [key, JSON.stringify(Boolean(v))]
          );
        }
      }
    } catch (_) {}
    // Resolve target users for the test
    let userRows = [];
    if (Array.isArray(userIds) && userIds.length > 0) {
      const ids = userIds.filter(Boolean);
      if (ids.length > 0) {
        const { rows } = await db.query(`SELECT id, email FROM users WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [ids]);
        userRows = rows;
      }
    } else if (Array.isArray(userEmails) && userEmails.length > 0) {
      const emails = userEmails.map(e => String(e || '').toLowerCase()).filter(Boolean);
      if (emails.length > 0) {
        const { rows } = await db.query(`SELECT id, email FROM users WHERE lower(email) = ANY($1::text[]) AND deleted_at IS NULL`, [emails]);
        userRows = rows;
      }
    } else if (Array.isArray(users) && users.length > 0 && users.every(u => u && u.id && u.email)) {
      userRows = users;
    } else {
      const { rows } = await db.query(`SELECT id, email FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`);
      userRows = rows;
    }
    if (userRows.length === 0) {
      return res.status(400).json({ error: 'no users available to simulate' });
    }

    const makeUserToken = (u) => jwt.sign({ userId: u.id, email: u.email, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    // Build a signed per-request mock override token for load test scope
    const overrideToken = jwt.sign({ scope: 'load_test', flags: {
      mock_api: !!(toggles && toggles.MOCK_API),
      mock_seedream3: !!(toggles && toggles.MOCK_SEEDREAM3),
      mock_seedream4: !!(toggles && toggles.MOCK_SEEDREAM4),
      mock_video: !!(toggles && toggles.MOCK_VIDEO),
      mock_seedance: !!(toggles && toggles.MOCK_SEEDANCE),
      mock_sora: !!(toggles && toggles.MOCK_SORA),
      mock_veo31: !!(toggles && toggles.MOCK_VEO31)
    } }, process.env.JWT_SECRET, { expiresIn: '2h' });
    const tokens = userRows.map(u => ({ id: u.id, email: u.email, token: makeUserToken(u) }));

    const queue = [];
    const results = { startedAt: Date.now(), total: maxRequests, ok: 0, fail: 0, errors: {}, samples: [] };
    let inFlight = 0;
    let idx = 0;
    let stopped = false;

    const startOne = async () => {
      if (stopped) return;
      if (idx >= maxRequests) return;
      const myIdx = idx++;
      const user = tokens[myIdx % tokens.length];
      inFlight++;
      const t0 = Date.now();
      try {
        // Build request exactly like the UI for parity, otherwise minimal payload
        let path, payload;
        if (uiParity) {
          const { buildImageRequest } = require('../utils/uiRequestBuilder');
          const reqSpec = buildImageRequest({ model, prompt, outputs });
          path = reqSpec.path;
          payload = reqSpec.payload;
        } else {
          const isSeedream4 = String(model || '').toLowerCase().includes('seedream-4');
          path = isSeedream4 ? '/api/images/seedream4/generate' : '/api/image/generate';
          payload = { prompt, model, outputs };
        }
        await axios.post(`${apiBase}${path}`, payload, {
          headers: {
            Cookie: `token=${user.token}`,
            ...(uiParity ? {} : { 'x-mock-override': overrideToken })
          },
          timeout: 120000
        });
        results.ok++;
      } catch (e) {
        results.fail++;
        const key = (e?.response?.status || e?.code || 'ERR').toString();
        results.errors[key] = (results.errors[key] || 0) + 1;
        if (results.samples.length < 5) {
          results.samples.push({ idx: myIdx, ms: Date.now() - t0, status: e?.response?.status || null, code: e?.code || null, msg: e?.message || '' });
        }
      } finally {
        inFlight--;
        tick();
      }
    };

    const tick = () => {
      while (!stopped && inFlight < maxConcurrent && idx < maxRequests) startOne();
      if (!stopped && inFlight === 0 && idx >= maxRequests) {
        __activeLoadTest = { running: false, ...results, finishedAt: Date.now() };
      }
    };

    __activeLoadTest = { running: true, ...results };
    tick();
    res.json({ success: true, running: true, total: maxRequests, concurrent: maxConcurrent });
  } catch (error) {
    console.error('Load test start error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/load-test/status', adminAuth, async (_req, res) => {
  try {
    if (!__activeLoadTest) return res.json({ running: false });
    res.json(__activeLoadTest);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/load-test/stop', adminAuth, async (_req, res) => {
  try {
    if (__activeLoadTest?.running) {
      __activeLoadTest.running = false;
    }
    res.json({ success: true, stopped: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DLQ MONITORING ENDPOINTS - Contract Item A1.4
// Get DLQ messages (dead letter queue monitoring)
router.get('/dlq/messages', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const sqsClient = require('../queue/sqsClient');
    const DLQ_URL = sqsClient.DLQ_QUEUE_URL;

    if (!DLQ_URL) {
      return res.status(503).json({ error: 'DLQ not configured (missing SQS_DLQ_QUEUE_URL)' });
    }

    // Receive messages from DLQ (max 10 per call due to SQS limits)
    const maxMessages = Math.min(10, Number(limit));
    const messages = await sqsClient.receiveMessages({
      queueUrl: DLQ_URL,
      maxMessages,
      waitTimeSeconds: 1, // Short poll
      visibilityTimeout: 300, // 5 min to allow admin to review
      attributeNames: ['All'],
      messageAttributeNames: ['All']
    });

    // Parse message bodies and extract metadata
    const parsed = messages.map(msg => {
      let body = {};
      let payload = {};
      try {
        body = JSON.parse(msg.Body || '{}');
        payload = body.payload || body;
      } catch (_) {
        body = { raw: msg.Body };
      }

      const receiveCount = msg.Attributes?.ApproximateReceiveCount || '1';
      const sentTimestamp = msg.Attributes?.SentTimestamp || Date.now();
      const failureCode = body.code || body.failureCode || 'unknown';
      const failureMessage = body.message || body.error || 'No error message';

      return {
        messageId: msg.MessageId,
        receiptHandle: msg.ReceiptHandle,
        body: payload,
        failureCode,
        failureMessage,
        receiveCount: Number(receiveCount),
        sentAt: new Date(Number(sentTimestamp)),
        attributes: msg.Attributes,
        messageAttributes: msg.MessageAttributes
      };
    });

    res.json({
      messages: parsed,
      queueUrl: DLQ_URL,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        hasMore: messages.length >= maxMessages
      }
    });
  } catch (error) {
    console.error('DLQ messages fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch DLQ messages', details: error.message });
  }
});

// Retry a DLQ message (move back to main queue)
router.post('/dlq/messages/:messageId/retry', adminAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { receiptHandle, payload } = req.body;

    if (!receiptHandle || !payload) {
      return res.status(400).json({ error: 'receiptHandle and payload required' });
    }

    const sqsClient = require('../queue/sqsClient');
    const MAIN_URL = sqsClient.MAIN_QUEUE_URL;
    const DLQ_URL = sqsClient.DLQ_QUEUE_URL;

    if (!MAIN_URL || !DLQ_URL) {
      return res.status(503).json({ error: 'SQS queues not configured' });
    }

    // Send message back to main queue
    await sqsClient.sendMessage({
      queueUrl: MAIN_URL,
      body: payload,
      messageAttributes: {
        retried_from_dlq: { DataType: 'String', StringValue: 'true' },
        original_message_id: { DataType: 'String', StringValue: messageId },
        retried_at: { DataType: 'String', StringValue: new Date().toISOString() },
        retried_by: { DataType: 'String', StringValue: req.admin?.email || 'admin' }
      }
    });

    // Delete from DLQ
    await sqsClient.deleteMessage(DLQ_URL, receiptHandle);

    await logAdminAction(req, 'dlq.retry', 'dlq_message', messageId, { payload });

    res.json({ success: true, messageId, retriedToQueue: MAIN_URL });
  } catch (error) {
    console.error('DLQ retry error:', error);
    res.status(500).json({ error: 'Failed to retry message', details: error.message });
  }
});

// Delete a DLQ message (permanent removal)
router.delete('/dlq/messages/:messageId', adminAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { receiptHandle } = req.body;

    if (!receiptHandle) {
      return res.status(400).json({ error: 'receiptHandle required' });
    }

    const sqsClient = require('../queue/sqsClient');
    const DLQ_URL = sqsClient.DLQ_QUEUE_URL;

    if (!DLQ_URL) {
      return res.status(503).json({ error: 'DLQ not configured' });
    }

    await sqsClient.deleteMessage(DLQ_URL, receiptHandle);
    await logAdminAction(req, 'dlq.delete', 'dlq_message', messageId, {});

    res.json({ success: true, messageId, deleted: true });
  } catch (error) {
    console.error('DLQ delete error:', error);
    res.status(500).json({ error: 'Failed to delete message', details: error.message });
  }
});

// Purge all DLQ messages (dangerous - requires confirmation)
router.post('/dlq/purge', adminAuth, async (req, res) => {
  try {
    const { confirmation } = req.body;

    if (confirmation !== 'PURGE_DLQ') {
      return res.status(400).json({ error: 'Confirmation required: send {confirmation: "PURGE_DLQ"}' });
    }

    const { SQSClient, PurgeQueueCommand } = require('@aws-sdk/client-sqs');
    const sqsClient = require('../queue/sqsClient');
    const DLQ_URL = sqsClient.DLQ_QUEUE_URL;

    if (!DLQ_URL) {
      return res.status(503).json({ error: 'DLQ not configured' });
    }

    const client = new SQSClient({ region: sqsClient.REGION });
    await client.send(new PurgeQueueCommand({ QueueUrl: DLQ_URL }));

    await logAdminAction(req, 'dlq.purge', 'dlq', 'all', { confirmed: true });

    res.json({ success: true, purged: true, queueUrl: DLQ_URL });
  } catch (error) {
    console.error('DLQ purge error:', error);
    res.status(500).json({ error: 'Failed to purge DLQ', details: error.message });
  }
});

module.exports = router;

// COST REPORTING ENDPOINTS
router.get('/costs/summary', adminAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const clauses = [];
    const params = [];
    let i = 1;
    if (startDate) { clauses.push(`ts >= $${i++}`); params.push(startDate); }
    if (endDate) { clauses.push(`ts <= $${i++}`); params.push(endDate); }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `
      SELECT 
        COALESCE(SUM(session_usd),0) AS usd,
        COUNT(*) AS sessions
      FROM v_session_costs
      ${whereSql}
    `;
    const byProduct = `
      SELECT product, COALESCE(SUM(session_usd),0) AS usd, COUNT(*) AS sessions
      FROM v_session_costs
      ${whereSql}
      GROUP BY 1
      ORDER BY 1`;
    const byModel = `
      SELECT model_key, COALESCE(SUM(session_usd),0) AS usd, COUNT(*) AS sessions
      FROM v_session_costs
      ${whereSql}
      GROUP BY 1
      ORDER BY 1`;
    const [tot, prod, model] = await Promise.all([
      db.query(sql, params),
      db.query(byProduct, params),
      db.query(byModel, params)
    ]);
    res.json({ total: tot.rows[0], byProduct: prod.rows, byModel: model.rows });
  } catch (e) {
    console.error('costs/summary error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/costs/daily', adminAuth, async (req, res) => {
  try {
    const { startDate, endDate, group = 'none' } = req.query; // none|product|model
    const clauses = [];
    const params = [];
    let i = 1;
    if (startDate) { clauses.push(`ts >= $${i++}`); params.push(startDate); }
    if (endDate) { clauses.push(`ts <= $${i++}`); params.push(endDate); }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const dayExpr = `date_trunc('day', ts AT TIME ZONE 'UTC')::date`;
    let select = `${dayExpr} AS day_utc, COALESCE(SUM(session_usd),0) AS usd, COUNT(*) AS sessions`;
    let groupBy = `1`;
    if (group === 'product') { select = `${dayExpr} AS day_utc, product, COALESCE(SUM(session_usd),0) AS usd`; groupBy = `1,2`; }
    if (group === 'model') { select = `${dayExpr} AS day_utc, model_key, COALESCE(SUM(session_usd),0) AS usd`; groupBy = `1,2`; }
    const sql = `
      SELECT ${select}
      FROM v_session_costs
      ${whereSql}
      GROUP BY ${groupBy}
      ORDER BY 1`;
    const { rows } = await db.query(sql, params);
    res.json({ daily: rows });
  } catch (e) {
    console.error('costs/daily error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/costs/top-users', adminAuth, async (req, res) => {
  try {
    const { startDate, endDate, limit = 20 } = req.query;
    const clauses = [];
    const params = [];
    let i = 1;
    if (startDate) { clauses.push(`ts >= $${i++}`); params.push(startDate); }
    if (endDate) { clauses.push(`ts <= $${i++}`); params.push(endDate); }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `
      SELECT user_id, COALESCE(SUM(session_usd),0) AS usd, COUNT(*) AS sessions
      FROM v_session_costs
      ${whereSql}
      GROUP BY 1
      ORDER BY usd DESC
      LIMIT $${i}`;
    params.push(Number(limit));
    const { rows } = await db.query(sql, params);
    res.json({ users: rows });
  } catch (e) {
    console.error('costs/top-users error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/costs/top-sessions', adminAuth, async (req, res) => {
  try {
    const { startDate, endDate, limit = 50 } = req.query;
    const clauses = [];
    const params = [];
    let i = 1;
    if (startDate) { clauses.push(`ts >= $${i++}`); params.push(startDate); }
    if (endDate) { clauses.push(`ts <= $${i++}`); params.push(endDate); }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `
      SELECT *
      FROM v_session_costs
      ${whereSql}
      ORDER BY session_usd DESC NULLS LAST
      LIMIT $${i}`;
    params.push(Number(limit));
    const { rows } = await db.query(sql, params);
    res.json({ sessions: rows });
  } catch (e) {
    console.error('costs/top-sessions error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PRICING MANAGEMENT ENDPOINTS
// Get subscription plans
router.get('/pricing/plans', adminAuth, async (req, res) => {
  try {
    const { billing_mode } = req.query; // optional filter
    let q = `SELECT * FROM subscription_plans WHERE is_active = TRUE`;
    const params = [];
    if (billing_mode) {
      q += ` AND billing_mode = $1`;
      params.push(billing_mode);
    }
    q += ` ORDER BY sort_order ASC`;
    const { rows } = await db.query(q, params);
    res.json({ plans: rows });
  } catch (e) {
    console.error('Get plans error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// SUBSCRIPTION EVENTS ENDPOINTS
router.get('/subscriptions/history', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, email = '', event_type, plan_key, startDate, endDate } = req.query;
    const offset = (page - 1) * limit;

    const clauses = [];
    const params = [];
    let idx = 1;
    if (email) { clauses.push(`u.email ILIKE $${idx}`); params.push(`%${email}%`); idx++; }
    if (event_type) { clauses.push(`se.event_type = $${idx}`); params.push(event_type); idx++; }
    if (plan_key) { clauses.push(`(se.prev_plan_key = $${idx} OR se.new_plan_key = $${idx})`); params.push(plan_key); idx++; }
    if (startDate) { clauses.push(`se.created_at >= $${idx}`); params.push(startDate); idx++; }
    if (endDate) { clauses.push(`se.created_at <= $${idx}`); params.push(endDate); idx++; }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const listSql = `
      SELECT se.*, u.email AS user_email
      FROM subscription_events se
      JOIN users u ON u.id = se.user_id
      ${whereSql}
      ORDER BY se.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    const listParams = params.concat([Number(limit), Number(offset)]);

    const countSql = `
      SELECT COUNT(*) AS total
      FROM subscription_events se
      JOIN users u ON u.id = se.user_id
      ${whereSql}
    `;

    const [listRes, countRes] = await Promise.all([
      db.query(listSql, listParams),
      db.query(countSql, params)
    ]);

    res.json({
      events: listRes.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: Number(countRes.rows[0].total),
        pages: Math.ceil(Number(countRes.rows[0].total) / Number(limit))
      }
    });
  } catch (e) {
    console.error('Admin subscription history error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Pending scheduled changes (plan or cancel/resume) with future effective_at
router.get('/subscriptions/pending', adminAuth, async (req, res) => {
  try {
    const { email, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const where = [`se.effective_at > NOW()`, `se.event_type IN ('plan_change_scheduled','cancel_scheduled','resume_scheduled')`];
    const params = [];
    let i = 1;
    if (email) { where.push(`u.email ILIKE $${i++}`); params.push(`%${email}%`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const listSql = `
      SELECT se.*, u.email AS user_email
      FROM subscription_events se
      JOIN users u ON u.id = se.user_id
      ${whereSql}
      ORDER BY se.effective_at ASC
      LIMIT $${i} OFFSET $${i + 1}`;
    const listParams = params.concat([Number(limit), Number(offset)]);
    const countSql = `SELECT COUNT(*) AS total FROM subscription_events se JOIN users u ON u.id = se.user_id ${whereSql}`;
    const [listRes, countRes] = await Promise.all([
      db.query(listSql, listParams),
      db.query(countSql, params)
    ]);
    res.json({
      pending: listRes.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: Number(countRes.rows[0].total),
        pages: Math.ceil(Number(countRes.rows[0].total) / Number(limit))
      }
    });
  } catch (e) {
    console.error('Pending subscriptions error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});
// FINANCIALS ENDPOINTS
router.get('/finance/ledger', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, side, category, provider, model_key, startDate, endDate } = req.query;
    const offset = (page - 1) * limit;
    const clauses = [];
    const params = [];
    let i = 1;
    if (side) { clauses.push(`fl.side = $${i++}`); params.push(side); }
    if (category) { clauses.push(`fl.category = $${i++}`); params.push(category); }
    if (provider) { clauses.push(`fl.provider = $${i++}`); params.push(provider); }
    if (model_key) { clauses.push(`fl.model_key = $${i++}`); params.push(model_key); }
    if (startDate) { clauses.push(`fl.created_at >= $${i++}`); params.push(startDate); }
    if (endDate) { clauses.push(`fl.created_at <= $${i++}`); params.push(endDate); }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const listSql = `
      SELECT fl.*, u.email AS user_email,
             -- subscription fields
             CASE WHEN fl.category='subscription' THEN (fl.metadata->>'plan_key') ELSE NULL END AS sub_plan_key,
             COALESCE(
               CASE WHEN fl.category='subscription' THEN (fl.metadata->>'billing_mode') END,
               sp_fb.billing_mode
             ) AS sub_billing_mode,
             COALESCE(sp.display_name, sp_fb.display_name) AS sub_plan_name,
             -- one-off fields
             COALESCE(
               CASE WHEN fl.category='one_off' THEN (fl.metadata->>'credits') END,
               cpj.credits_added::text
             ) AS one_off_credits
      FROM finance_ledger fl
      LEFT JOIN users u ON u.id = fl.user_id
      -- Direct join from metadata to plan (preferred)
      LEFT JOIN subscription_plans sp
        ON sp.plan_key = (fl.metadata->>'plan_key')
       AND sp.billing_mode = (fl.metadata->>'billing_mode')
      -- Fallback: infer plan from subscriptions nearest before the ledger time
      LEFT JOIN LATERAL (
        SELECT s.plan_id
        FROM subscriptions s
        WHERE s.user_id = fl.user_id AND s.created_at <= fl.created_at
        ORDER BY s.created_at DESC
        LIMIT 1
      ) s_fb ON TRUE
      LEFT JOIN subscription_plans sp_fb ON sp_fb.plan_key = s_fb.plan_id
      -- Fallback: infer one-off credits from credit_purchases around that time and amount
      LEFT JOIN LATERAL (
        SELECT cp.credits_added
        FROM credit_purchases cp
        WHERE cp.user_id = fl.user_id
          AND cp.amount_usd_cents = fl.amount_cents
          AND ABS(EXTRACT(EPOCH FROM (fl.created_at - COALESCE(cp.created_at, fl.created_at)))) <= 86400
        ORDER BY ABS(EXTRACT(EPOCH FROM (fl.created_at - COALESCE(cp.created_at, fl.created_at)))) ASC
        LIMIT 1
      ) cpj ON TRUE
      ${whereSql}
      ORDER BY fl.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}`;
    const listParams = params.concat([Number(limit), Number(offset)]);
    const countSql = `SELECT COUNT(*) AS total FROM finance_ledger fl ${whereSql}`;
    const [listRes, countRes] = await Promise.all([
      db.query(listSql, listParams),
      db.query(countSql, params)
    ]);
    res.json({
      ledger: listRes.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: Number(countRes.rows[0].total),
        pages: Math.ceil(Number(countRes.rows[0].total) / Number(limit))
      }
    });
  } catch (e) {
    console.error('Finance ledger fetch error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/finance/summary', adminAuth, async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'month' } = req.query; // day|week|month
    const bucket = groupBy === 'day' ? 'day' : groupBy === 'week' ? 'week' : 'month';
    const clauses = [];
    const params = [];
    let i = 1;
    if (startDate) { clauses.push(`created_at >= $${i++}`); params.push(startDate); }
    if (endDate) { clauses.push(`created_at <= $${i++}`); params.push(endDate); }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `
      SELECT date_trunc('${bucket}', created_at) AS period,
             SUM(CASE WHEN side='income' THEN amount_cents ELSE 0 END) AS income_cents,
             SUM(CASE WHEN side='cost' THEN amount_cents ELSE 0 END) AS cost_cents
      FROM finance_ledger
      ${whereSql}
      GROUP BY 1
      ORDER BY 1 DESC
    `;
    const { rows } = await db.query(sql, params);
    res.json({ summary: rows });
  } catch (e) {
    console.error('Finance summary error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/subscriptions/history/:userId', adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const list = await db.query(
      `SELECT * FROM subscription_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, Number(limit), Number(offset)]
    );
    const cnt = await db.query(`SELECT COUNT(*) AS total FROM subscription_events WHERE user_id = $1`, [userId]);
    res.json({
      events: list.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: Number(cnt.rows[0].total),
        pages: Math.ceil(Number(cnt.rows[0].total) / Number(limit))
      }
    });
  } catch (e) {
    console.error('Admin user subscription history error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upsert subscription plan
router.post('/pricing/plans', adminAuth, async (req, res) => {
  try {
    const { id, plan_key, billing_mode, display_name, price_cents, credits_per_period, is_active, sort_order } = req.body;
    if (!plan_key || !billing_mode || !display_name || price_cents == null || credits_per_period == null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (Number(price_cents) < 0 || Number(credits_per_period) <= 0) {
      return res.status(400).json({ error: 'Invalid price or credits' });
    }
    const q = id ?
      `UPDATE subscription_plans SET plan_key=$1, billing_mode=$2, display_name=$3, price_cents=$4, credits_per_period=$5, is_active=COALESCE($6, is_active), sort_order=COALESCE($7, sort_order), updated_at=NOW() WHERE id=$8 RETURNING *` :
      `INSERT INTO subscription_plans (plan_key, billing_mode, display_name, price_cents, credits_per_period, is_active, sort_order) VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE),COALESCE($7,0)) RETURNING *`;
    const params = id ? [plan_key, billing_mode, display_name, price_cents, credits_per_period, is_active, sort_order, id] : [plan_key, billing_mode, display_name, price_cents, credits_per_period, is_active, sort_order];
    const { rows } = await db.query(q, params);
    await logAdminAction(req, id ? 'plan.update' : 'plan.create', 'subscription_plan', rows[0]?.id, rows[0]);
    res.json({ plan: rows[0] });
  } catch (e) {
    console.error('Upsert plan error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get one-off credit packages
router.get('/pricing/packages', adminAuth, async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM credit_packages WHERE is_active = TRUE ORDER BY sort_order ASC`);
    res.json({ packages: rows });
  } catch (e) {
    console.error('Get packages error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upsert credit package
router.post('/pricing/packages', adminAuth, async (req, res) => {
  try {
    const { id, display_name, credits, price_cents, is_active, sort_order } = req.body;
    if (!display_name || credits == null || price_cents == null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (Number(credits) <= 0 || Number(price_cents) < 0) {
      return res.status(400).json({ error: 'Invalid credits or price' });
    }
    const q = id ?
      `UPDATE credit_packages SET display_name=$1, credits=$2, price_cents=$3, is_active=COALESCE($4, is_active), sort_order=COALESCE($5, sort_order), updated_at=NOW() WHERE id=$6 RETURNING *` :
      `INSERT INTO credit_packages (display_name, credits, price_cents, is_active, sort_order) VALUES ($1,$2,$3,COALESCE($4,TRUE),COALESCE($5,0)) RETURNING *`;
    const params = id ? [display_name, credits, price_cents, is_active, sort_order, id] : [display_name, credits, price_cents, is_active, sort_order];
    const { rows } = await db.query(q, params);
    await logAdminAction(req, id ? 'package.update' : 'package.create', 'credit_package', rows[0]?.id, rows[0]);
    res.json({ package: rows[0] });
  } catch (e) {
    console.error('Upsert package error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get model pricing
router.get('/pricing/models', adminAuth, async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM model_pricing WHERE is_active = TRUE ORDER BY display_name ASC`);
    res.json({ models: rows });
  } catch (e) {
    console.error('Get model pricing error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upsert model pricing
router.post('/pricing/models', adminAuth, async (req, res) => {
  try {
    const { id, model_key, display_name, operation, unit, credit_cost_per_unit, is_active } = req.body;
    if (!model_key || !display_name || !operation || !unit || credit_cost_per_unit == null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (Number(credit_cost_per_unit) < 0) {
      return res.status(400).json({ error: 'Invalid credit cost' });
    }
    const q = id ?
      `UPDATE model_pricing SET model_key=$1, display_name=$2, operation=$3, unit=$4, credit_cost_per_unit=$5, is_active=COALESCE($6, is_active), updated_at=NOW() WHERE id=$7 RETURNING *` :
      `INSERT INTO model_pricing (model_key, display_name, operation, unit, credit_cost_per_unit, is_active) VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE)) RETURNING *`;
    const params = id ? [model_key, display_name, operation, unit, credit_cost_per_unit, is_active, id] : [model_key, display_name, operation, unit, credit_cost_per_unit, is_active];
    const { rows } = await db.query(q, params);
    await logAdminAction(req, id ? 'model_pricing.update' : 'model_pricing.create', 'model_pricing', rows[0]?.id, rows[0]);
    res.json({ model: rows[0] });
  } catch (e) {
    console.error('Upsert model pricing error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});
