const express = require('express');
const auth = require('../middleware/auth');
const db = require('../db');
const { ensureListener, addSseClient } = require('../utils/creditsEvents');
const { getCredits } = require('../utils/credits');
const { deleteUserFiles } = require('../utils/storage');
const { updateCreditBalanceOnDeletion } = require('../utils/emailCredits');
const router = express.Router();
// Server-Sent Events: stream credits_changed events for the authenticated user
router.get('/credits/stream', auth, async (req, res) => {
  const userId = req.user.userId;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  try { await ensureListener(); } catch { try { res.status(500).end(); } catch {} return; }
  addSseClient(userId, res);
  const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (_) {} }, 25000);
  res.on('close', () => clearInterval(hb));
});
// Preview session exchange: accepts a short-lived exchange token and sets a local session
router.post('/session/exchange', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const secret = process.env.EXCHANGE_JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'Exchange not configured' });

    let payload;
    try {
      payload = jwt.verify(token, secret, { audience: 'session-exchange' });
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { sub: userId, email } = payload || {};
    if (!userId || !email) return res.status(400).json({ error: 'Invalid token payload' });

    // Create a normal app session cookie for this backend
    const appJwt = jwt.sign({ userId, email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', appJwt, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(204).end();
  } catch (err) {
    console.error('Session exchange error:', err);
    return res.status(500).json({ error: 'Failed to exchange session' });
  }
});

// Get current user info
router.get('/me', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT 
         u.id, u.email, u.credits, u.provider, u.provider_email, u.google_id, u.last_login_at,
         COALESCE((
           SELECT SUM(amount) FROM credit_reservations 
           WHERE user_id = u.id AND status = 'reserved' AND (expires_at IS NULL OR expires_at > NOW())
         ),0) AS reserved_sum
       FROM users u WHERE u.id = $1`,
      [req.user.userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];

    // Get subscription info if exists
    const { rows: subRows } = await db.query(
      'SELECT status, plan_id, current_period_end FROM subscriptions WHERE user_id = $1 AND status = $2',
      [req.user.userId, 'active']
    );

    res.json({
      id: user.id,
      email: user.email,
      credits: user.credits,
      available_credits: Math.max(0, Number(user.credits) - Number(user.reserved_sum || 0)),
      provider: user.provider,
      provider_email: user.provider_email,
      google_id: user.google_id,
      last_login_at: user.last_login_at,
      subscription: subRows.length > 0 ? subRows[0] : null
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Get credit usage history
router.get('/credit-usage', auth, async (req, res) => {
  try {
    const { startDate, endDate, before, after, limit = 50 } = req.query;
    
    console.log('Credit usage request:', { startDate, endDate, before, after, limit, userId: req.user.userId });
    
    let query = `SELECT 
      id,
      description,
      amount,
      balance_after,
      created_at
    FROM credit_transactions 
    WHERE user_id = $1`;
    
    const params = [req.user.userId];
    let paramIndex = 2;
    
    if (startDate) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    // Cursor-based pagination
    if (before) {
      query += ` AND created_at < $${paramIndex}`;
      params.push(before);
      paramIndex++;
    }
    
    if (after) {
      query += ` AND created_at > $${paramIndex}`;
      params.push(after);
      paramIndex++;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));
    
    console.log('Final query:', query);
    console.log('Params:', params);
    
    const { rows } = await db.query(query, params);

    // Check if there are more records
    let hasMore = false;
    if (rows.length === parseInt(limit)) {
      const lastRecord = rows[rows.length - 1];
      let checkQuery = `SELECT 1 FROM credit_transactions 
        WHERE user_id = $1 AND created_at < $2`;
      const checkParams = [req.user.userId, lastRecord.created_at];
      
      if (startDate) {
        checkQuery += ` AND created_at >= $3`;
        checkParams.push(startDate);
      }
      if (endDate) {
        checkQuery += ` AND created_at <= $${checkParams.length + 1}`;
        checkParams.push(endDate);
      }
      
      const { rows: checkRows } = await db.query(checkQuery, checkParams);
      hasMore = checkRows.length > 0;
    }

    console.log('Query result:', { rowCount: rows.length, hasMore });

    res.json({
      transactions: rows.map(row => ({
        id: row.id,
        description: row.description,
        amount: row.amount,
        balance_after: row.balance_after,
        created_at: row.created_at
      })),
      pagination: {
        hasMore,
        hasPrevious: !!before,
        limit: parseInt(limit)
      }
    });
  } catch (err) {
    console.error('Get credit usage error:', err);
    res.status(500).json({ error: 'Failed to get credit usage history' });
  }
});

// Logout user
router.post('/logout', auth, (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: !(['localhost', '127.0.0.1'].includes(req.hostname)),
    sameSite: ['localhost', '127.0.0.1'].includes(req.hostname) ? 'lax' : 'none'
  });
  
  res.json({ message: 'Logged out successfully' });
});

// Delete user account and all associated data
router.delete('/account', auth, async (req, res) => {
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');

    // Get user info for cleanup
    const { rows: userRows } = await client.query(
      'SELECT email, provider, credits FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (userRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userRows[0];

    // Save current credit balance to prevent credit farming
    try {
      await updateCreditBalanceOnDeletion(user.email, user.credits);
      console.log(`💾 Saved credit balance ${user.credits} for ${user.email} on account deletion`);
    } catch (creditError) {
      console.error('⚠️ Failed to save credit balance (continuing with deletion):', creditError);
      // Continue with account deletion even if credit tracking fails
    }

    // Delete user (this will cascade delete all related data)
    await client.query('DELETE FROM users WHERE id = $1', [req.user.userId]);

    // Clean up B2 files (images and videos)
    try {
      await deleteUserFiles(req.user.userId);
      console.log(`🗂️ Cleaned up B2 files for user ${req.user.userId}`);
    } catch (cleanupError) {
      console.error('⚠️ B2 cleanup failed (continuing with deletion):', cleanupError);
      // Continue with account deletion even if B2 cleanup fails
    }

    await client.query('COMMIT');

    // Clear the auth cookie
    res.clearCookie('token', {
      httpOnly: true,
      secure: !(['localhost', '127.0.0.1'].includes(req.hostname)),
      sameSite: ['localhost', '127.0.0.1'].includes(req.hostname) ? 'lax' : 'none'
    });

    console.log(`🗑️ Account deleted for user ${user.email} (${req.user.userId})`);
    
    res.json({ 
      message: 'Account deleted successfully',
      deletedAt: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Account deletion error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  } finally {
    client.release();
  }
});

// Admin endpoint to view deleted emails blacklist (for support)
router.get('/admin/deleted-emails', auth, async (req, res) => {
  try {
    // Basic admin check - you might want to add proper admin role checking
    const { rows: userRows } = await db.query(
      'SELECT email FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get deleted emails (limit to last 100 for performance)
    const { rows: deletedEmails } = await db.query(
      'SELECT email, user_id, deleted_at, reason FROM deleted_emails ORDER BY deleted_at DESC LIMIT 100'
    );

    res.json({
      count: deletedEmails.length,
      deletedEmails: deletedEmails
    });

  } catch (error) {
    console.error('Get deleted emails error:', error);
    res.status(500).json({ error: 'Failed to get deleted emails' });
  }
});

// Admin endpoint to cleanup old deleted email entries
router.post('/admin/cleanup-deleted-emails', auth, async (req, res) => {
  try {
    const { daysOld = 90 } = req.body;
    
    // Basic admin check - you might want to add proper admin role checking
    const { rows: userRows } = await db.query(
      'SELECT email FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { cleanupDeletedEmails } = require('../utils/cleanup');
    const cleanedCount = await cleanupDeletedEmails(daysOld);

    res.json({
      success: true,
      message: `Cleaned up ${cleanedCount} old deleted email entries`,
      cleanedCount,
      daysOld
    });

  } catch (error) {
    console.error('Cleanup deleted emails error:', error);
    res.status(500).json({ error: 'Failed to cleanup deleted emails' });
  }
});

// Admin endpoint to view email credit tracking
router.get('/admin/email-credits', auth, async (req, res) => {
  try {
    // Basic admin check - you might want to add proper admin role checking
    const { rows: userRows } = await db.query(
      'SELECT email FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { getCreditTrackingStats } = require('../utils/emailCredits');
    const stats = await getCreditTrackingStats();

    // Get recent credit tracking entries
    const { rows: creditEntries } = await db.query(`
      SELECT email, total_credits_given, current_balance, first_registration_at, last_updated_at
      FROM email_credit_tracking 
      ORDER BY last_updated_at DESC 
      LIMIT 50
    `);

    res.json({
      stats,
      recentEntries: creditEntries
    });

  } catch (error) {
    console.error('Get email credit tracking error:', error);
    res.status(500).json({ error: 'Failed to get email credit tracking' });
  }
});

module.exports = router; 

// Get user's current credits
router.get('/credits', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT 
         u.credits AS credits,
         COALESCE((
           SELECT SUM(amount) FROM credit_reservations 
           WHERE user_id = u.id AND status = 'reserved' AND (expires_at IS NULL OR expires_at > NOW())
         ),0) AS reserved
       FROM users u WHERE u.id = $1`,
      [req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const credits = Number(rows[0].credits) || 0;
    const reserved = Number(rows[0].reserved) || 0;
    return res.json({ credits, available: Math.max(0, credits - reserved), reserved });
  } catch (err) {
    console.error('Get credits error:', err);
    return res.status(500).json({ error: 'Failed to get credits' });
  }
});