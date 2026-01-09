const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/templates/:tool/:slug
router.get('/:tool/:slug', async (req, res) => {
  const tool = String(req.params.tool || '').toLowerCase();
  const slug = String(req.params.slug || '').toLowerCase();
  if (!tool || !slug) return res.status(400).json({ error: 'Missing tool or slug' });

  try {
    const { rows } = await db.query(
      `SELECT tool, slug, title, description, version, status, public, settings
       FROM templates
       WHERE tool = $1 AND slug = $2 AND public = TRUE AND status = 'active'
       LIMIT 1`,
      [tool, slug]
    );
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    return res.json(rows[0]);
  } catch (e) {
    req.log?.error({ err: e }, 'Failed to fetch template');
    return res.status(500).json({ error: 'Failed to fetch template' });
  }
});

module.exports = router;



