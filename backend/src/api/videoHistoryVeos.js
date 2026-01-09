const express = require('express');
const auth = require('../middleware/auth');
const db = require('../db');
const router = express.Router();

// Veo3-only history
router.get('/history', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    const whereSql = `s.user_id = $1 AND (LOWER(s.model) LIKE 'veo3%' OR v.generation_tool = 'google-veo3')`;

    const { rows } = await db.query(
      `SELECT 
        s.id AS session_id,
        s.prompt,
        s.model,
        s.aspect_ratio,
        s.status,
        s.credit_cost,
        s.created_at,
        s.completed_at,
        s.duration_ms,
        v.original_url,
        v.b2_url,
        v.b2_filename,
        v.file_size,
        v.generation_tool
      FROM video_generation_sessions s
      LEFT JOIN videos v ON v.session_id = s.id
      WHERE ${whereSql}
      ORDER BY s.created_at DESC
      LIMIT $2 OFFSET $3`,
      [req.user.userId, limit, offset]
    );

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) as total FROM video_generation_sessions s
       LEFT JOIN videos v ON v.session_id = s.id
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
    console.error('Veo history fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch Veo history' });
  }
});

module.exports = router;


