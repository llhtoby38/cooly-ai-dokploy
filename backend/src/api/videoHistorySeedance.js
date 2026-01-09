const express = require('express');
const auth = require('../middleware/auth');
const db = require('../db');
const router = express.Router();

// Seedance-only history
router.get('/history', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    const whereSql = `s.user_id = $1 AND (LOWER(s.model) LIKE 'seedance%' OR v.generation_tool = 'seedance-1-0')`;

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
        s.task_id,
        s.resolution,
        s.video_duration,
        s.storage_status,
        s.ref_image_url,
        s.start_frame_url,
        s.end_frame_url,
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
    console.error('Seedance history fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch Seedance history' });
  }
});

module.exports = router;


