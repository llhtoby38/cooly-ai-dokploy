const express = require('express');
const auth = require('../middleware/auth');
const db = require('../db');
const router = express.Router();

// Dedicated Seedream 3.0 history endpoint (server-side filtered)
router.get('/history', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    const whereSql = `s.user_id = $1 AND (LOWER(s.model) = 'seedream-3-0-t2i-250415' OR i.generation_tool = 'byteplus-seedream')`;

    const { rows } = await db.query(
      `SELECT s.id AS session_id, s.prompt, s.model, s.status, s.created_at, s.completed_at, s.outputs, s.aspect_ratio, s.resolution, s.guidance_scale, s.credit_cost, s.reservation_id, s.client_key,
              ARRAY_AGG(i.url) FILTER (WHERE i.url IS NOT NULL) as urls,
              ARRAY_AGG(i.b2_url) FILTER (WHERE i.b2_url IS NOT NULL) as b2_urls,
              ARRAY_AGG(i.b2_filename) FILTER (WHERE i.b2_filename IS NOT NULL) as b2_filenames,
              ARRAY_AGG(i.file_size) FILTER (WHERE i.file_size IS NOT NULL) as file_sizes,
              ARRAY_AGG(i.generation_tool) FILTER (WHERE i.generation_tool IS NOT NULL) as generation_tools,
              ARRAY_AGG(i.client_key) FILTER (WHERE i.client_key IS NOT NULL) as image_client_keys
       FROM generation_sessions s
       LEFT JOIN images i ON i.session_id = s.id
       WHERE ${whereSql}
       GROUP BY s.id, s.prompt, s.model, s.status, s.created_at, s.completed_at, s.outputs, s.aspect_ratio, s.resolution, s.guidance_scale, s.credit_cost, s.reservation_id
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.userId, limit, offset]
    );

    const { rows: countRows } = await db.query(
      `SELECT COUNT(DISTINCT s.id) as total FROM generation_sessions s
       LEFT JOIN images i ON i.session_id = s.id
       WHERE ${whereSql}`,
      [req.user.userId]
    );

    res.json({
      items: rows,
      pagination: {
        total: parseInt(countRows[0].total),
        limit,
        offset,
        hasMore: offset + limit < parseInt(countRows[0].total)
      }
    });
  } catch (err) {
    console.error('Seedream 3.0 history fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch Seedream 3.0 history' });
  }
});

// Dedicated estimate endpoint for 3.0 (optional)
router.get('/estimate', auth, async (req, res) => {
  try {
    const outputs = Number(req.query.outputs || 0) || null;
    const params = [req.user.userId];
    let sql = `
      WITH recent AS (
        SELECT s.duration_ms AS ms
        FROM generation_sessions s
        LEFT JOIN images i ON i.session_id = s.id
        WHERE s.status = 'completed'
          AND s.duration_ms IS NOT NULL
          AND s.duration_ms > 0
          AND (LOWER(s.model) = 'seedream-3-0-t2i-250415' OR i.generation_tool = 'byteplus-seedream')
          AND s.user_id = $1`;
    if (outputs) {
      params.push(outputs);
      sql += ` AND s.outputs = $${params.length}`;
    }
    sql += `
        ORDER BY s.completed_at DESC
        LIMIT 32
      )
      SELECT AVG(ms) AS avg_ms, COUNT(*) AS sample_size FROM recent
    `;
    const { rows } = await db.query(sql, params);
    const avgMsRaw = Number(rows[0]?.avg_ms || 0);
    const avgMs = Math.max(0, Math.round(avgMsRaw));
    const sampleSize = Number(rows[0]?.sample_size || 0);
    const DEFAULTS = { 1: 10000, 2: 11000, 3: 12000, 4: 13000, 5: 14000, 6: 15000, 7: 16000, 8: 17000 };
    const defaultMs = outputs && DEFAULTS[outputs] ? DEFAULTS[outputs] : 10000;
    const adjustedAvgMs = sampleSize > 0 && avgMs > 0 ? avgMs + 2000 : 0;
    const estimate = sampleSize > 0 && avgMs > 0 ? adjustedAvgMs : defaultMs;
    return res.json({ averageMs: estimate, sampleSize, outputs: outputs ?? null });
  } catch (err) {
    console.error('Seedream 3.0 estimate error:', err);
    return res.status(500).json({ error: 'Failed to compute Seedream 3.0 estimate' });
  }
});

module.exports = router;


