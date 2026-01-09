const db = require('../db');

/**
 * Optimized credit utilities - Contract Item A2.2
 * Target: Reduce database queries by 60-80%
 *
 * Key optimizations:
 * 1. Use CTEs (Common Table Expressions) instead of loops
 * 2. Batch operations with single queries
 * 3. Eliminate N+1 query patterns
 */

/**
 * Compute available credits considering active reservations
 * OPTIMIZED: Single query with subquery (was already good)
 */
async function getAvailableCredits(userId) {
  const { rows } = await db.query(
    `SELECT
       u.credits AS balance,
       COALESCE((
         SELECT SUM(amount) FROM credit_reservations
         WHERE user_id = $1 AND status = 'reserved'
           AND (expires_at IS NULL OR expires_at > NOW())
       ), 0) AS reserved
     FROM users u WHERE u.id = $1`,
    [userId]
  );
  if (!rows.length) return { success: false, error: 'User not found' };
  const balance = Number(rows[0].balance) || 0;
  const reserved = Number(rows[0].reserved) || 0;
  return { success: true, available: Math.max(0, balance - reserved), balance, reserved };
}

/**
 * Get detailed credits breakdown with lots
 * OPTIMIZED: Single query with JOIN instead of multiple queries
 */
async function getCredits(userId) {
  const { rows } = await db.query(
    `WITH lot_usage AS (
      SELECT
        lot_id,
        SUM(ABS(amount)) as used
      FROM credit_transactions
      WHERE lot_id IS NOT NULL
      GROUP BY lot_id
    ),
    active_lots AS (
      SELECT
        l.id,
        l.amount,
        l.remaining,
        l.expires_at,
        l.source,
        l.created_at,
        COALESCE(lu.used, 0) as used,
        GREATEST(0, l.remaining) as available
      FROM credit_lots l
      LEFT JOIN lot_usage lu ON lu.lot_id = l.id
      WHERE l.user_id = $1
        AND l.closed_at IS NULL
        AND l.remaining > 0
        AND (l.expires_at > NOW() OR l.source = 'one_off')
      ORDER BY l.expires_at ASC, l.created_at ASC
    )
    SELECT
      u.credits as balance,
      COALESCE((
        SELECT SUM(amount) FROM credit_reservations
        WHERE user_id = $1 AND status = 'reserved'
          AND (expires_at IS NULL OR expires_at > NOW())
      ), 0) as reserved,
      COALESCE((SELECT jsonb_agg(row_to_json(active_lots)) FROM active_lots), '[]'::jsonb) as lots
    FROM users u
    WHERE u.id = $1`,
    [userId]
  );

  if (!rows.length) return { success: false, error: 'User not found' };

  const balance = Number(rows[0].balance) || 0;
  const reserved = Number(rows[0].reserved) || 0;
  const lots = rows[0].lots || [];

  return {
    success: true,
    credits: balance,
    available: Math.max(0, balance - reserved),
    reserved,
    lots
  };
}

/**
 * Reserve credits (soft hold)
 * OPTIMIZED: Reduced from 3-4 queries to 2 queries
 */
async function reserveCredits(userId, amount, options = {}) {
  const description = options?.description || null;
  const sessionId = options?.sessionId || null;
  const ttlSeconds = Number(options?.ttlSeconds || 3600);
  const expiresAtExpr = ttlSeconds > 0 ? `NOW() + INTERVAL '${ttlSeconds} seconds'` : 'NULL';

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // OPTIMIZED: Single query to get balance and reserved amount
    const { rows: u } = await client.query(
      `SELECT
        u.id,
        u.credits,
        COALESCE((
          SELECT SUM(amount) FROM credit_reservations
          WHERE user_id = $1 AND status = 'reserved'
            AND (expires_at IS NULL OR expires_at > NOW())
        ), 0) as reserved
       FROM users u
       WHERE u.id = $1
       FOR UPDATE`,
      [userId]
    );

    if (!u.length) {
      await client.query('ROLLBACK');
      return { success: false, error: 'User not found' };
    }

    const balance = Number(u[0].credits) || 0;
    const reserved = Number(u[0].reserved) || 0;
    const available = balance - reserved;

    if (available < amount) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Insufficient credits',
        creditsLeft: available
      };
    }

    const ins = await client.query(
      `INSERT INTO credit_reservations (user_id, amount, status, session_id, description, expires_at)
       VALUES ($1, $2, 'reserved', $3, $4, ${expiresAtExpr}) RETURNING id, expires_at`,
      [userId, amount, sessionId, description]
    );

    // Notify credits changed
    try {
      const reservedNow = reserved + amount;
      const availableNow = Math.max(0, balance - reservedNow);
      await client.query('SELECT pg_notify($1, $2)', [
        'credits_changed',
        JSON.stringify({
          user_id: userId,
          credits: balance,
          available: availableNow,
          reserved: reservedNow,
          event: 'reserved',
          reservation_id: ins.rows[0].id,
          delta: amount,
          event_ts: Date.now()
        })
      ]);
    } catch (_) {}

    await client.query('COMMIT');
    return {
      success: true,
      reservationId: ins.rows[0].id,
      expiresAt: ins.rows[0].expires_at
    };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('reserveCredits error:', e);
    return { success: false, error: 'Database error' };
  } finally {
    client.release();
  }
}

/**
 * Capture a reservation: performs a debit and marks captured
 * OPTIMIZED: Use CTE instead of loop - reduces from N+1 queries to 1 query
 *
 * Before: For 5 credit lots = 1 + 5*3 = 16 queries
 * After: For 5 credit lots = 1 query
 * Reduction: 94% fewer queries!
 */
async function captureReservation(reservationId, options = {}) {
  const descriptionOverride = options?.description || null;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get reservation details
    const { rows: rRows } = await client.query(
      `SELECT cr.*, u.credits
       FROM credit_reservations cr
       JOIN users u ON u.id = cr.user_id
       WHERE cr.id = $1 FOR UPDATE`,
      [reservationId]
    );

    if (!rRows.length) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Reservation not found' };
    }

    const r = rRows[0];
    if (r.status !== 'reserved') {
      await client.query('ROLLBACK');
      return { success: false, error: `Invalid reservation status: ${r.status}` };
    }

    if (r.expires_at && new Date(r.expires_at) < new Date()) {
      await client.query(
        "UPDATE credit_reservations SET status='expired', released_at=NOW() WHERE id=$1",
        [reservationId]
      );
      await client.query('COMMIT');
      return { success: false, error: 'Reservation expired' };
    }

    const amount = Number(r.amount) || 0;
    const txDescription = descriptionOverride || (r.description || 'Credit usage');

    // OPTIMIZED: Use CTE to deduct from lots in a single query
    const result = await client.query(
      `WITH RECURSIVE lot_deductions AS (
        -- Get all available lots sorted by expiration
        SELECT
          id,
          remaining,
          expires_at,
          0 as cumulative,
          ROW_NUMBER() OVER (ORDER BY expires_at ASC, created_at ASC) as rn
        FROM credit_lots
        WHERE user_id = $1
          AND remaining > 0
          AND closed_at IS NULL
        ORDER BY expires_at ASC, created_at ASC
      ),
      deduction_plan AS (
        -- Calculate how much to deduct from each lot
        SELECT
          id,
          remaining,
          expires_at,
          CASE
            WHEN cumulative >= $2 THEN 0
            WHEN cumulative + remaining > $2 THEN $2 - cumulative
            ELSE remaining
          END as deduct_amount,
          CASE
            WHEN cumulative >= $2 THEN cumulative
            WHEN cumulative + remaining > $2 THEN $2
            ELSE cumulative + remaining
          END as new_cumulative
        FROM (
          SELECT
            id,
            remaining,
            expires_at,
            SUM(remaining) OVER (ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) as cumulative
          FROM lot_deductions
        ) t
      ),
      update_lots AS (
        -- Update lot remainings
        UPDATE credit_lots l
        SET remaining = l.remaining - dp.deduct_amount
        FROM deduction_plan dp
        WHERE l.id = dp.id AND dp.deduct_amount > 0
        RETURNING l.id, dp.deduct_amount, l.expires_at, l.remaining as new_remaining
      ),
      insert_txns AS (
        -- Insert credit transactions for each deduction
        INSERT INTO credit_transactions (user_id, description, amount, balance_after, lot_id, expires_at, reservation_id)
        SELECT
          $1,
          $3,
          -ul.deduct_amount,
          (SELECT COALESCE(SUM(remaining), 0) FROM credit_lots
           WHERE user_id = $1 AND remaining > 0 AND closed_at IS NULL
             AND (expires_at > NOW() OR source = 'one_off')),
          ul.id,
          ul.expires_at,
          $4
        FROM update_lots ul
        RETURNING id, balance_after
      )
      SELECT
        COALESCE(SUM(deduct_amount), 0) as total_deducted,
        (SELECT balance_after FROM insert_txns ORDER BY id DESC LIMIT 1) as final_balance
      FROM update_lots`,
      [r.user_id, amount, txDescription, reservationId]
    );

    const totalDeducted = Number(result.rows[0]?.total_deducted || 0);
    const finalBalance = Number(result.rows[0]?.final_balance || 0);

    if (totalDeducted < amount) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Insufficient credits to capture' };
    }

    // Update user balance
    await client.query('UPDATE users SET credits = $1 WHERE id = $2', [finalBalance, r.user_id]);

    // Mark reservation as captured
    await client.query(
      "UPDATE credit_reservations SET status='captured', captured_at=NOW() WHERE id=$1",
      [reservationId]
    );

    // Sync and notify
    try {
      const { rows: ar } = await client.query(
        `SELECT
           u.credits AS balance,
           COALESCE((SELECT SUM(amount) FROM credit_reservations
             WHERE user_id = $1 AND status = 'reserved'
               AND (expires_at IS NULL OR expires_at > NOW())), 0) AS reserved
         FROM users u WHERE u.id = $1`,
        [r.user_id]
      );

      const bal = Number(ar[0]?.balance || 0);
      const resv = Number(ar[0]?.reserved || 0);
      const available = Math.max(0, bal - resv);

      // Sync email_credit_tracking
      try {
        const { rows: urow } = await client.query('SELECT email FROM users WHERE id=$1', [r.user_id]);
        const userEmail = urow[0]?.email || null;
        if (userEmail) {
          const upd = await client.query(
            'UPDATE email_credit_tracking SET current_balance = $1, last_updated_at = NOW() WHERE email = $2',
            [bal, userEmail]
          );
          if (upd.rowCount === 0) {
            await client.query(
              'INSERT INTO email_credit_tracking (email, total_credits_given, current_balance) VALUES ($1,$2,$3)',
              [userEmail, 0, bal]
            );
          }
        }
      } catch (_) {}

      await client.query('SELECT pg_notify($1, $2)', [
        'credits_changed',
        JSON.stringify({
          user_id: r.user_id,
          credits: bal,
          available,
          reserved: resv,
          event: 'captured',
          reservation_id: reservationId,
          event_ts: Date.now()
        })
      ]);
    } catch (_) {}

    await client.query('COMMIT');
    return { success: true };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('captureReservation error:', e);
    return { success: false, error: 'Database error' };
  } finally {
    client.release();
  }
}

/**
 * Release a reservation without debiting
 * OPTIMIZED: Already efficient (2 queries)
 */
async function releaseReservation(reservationId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT user_id, status, amount FROM credit_reservations WHERE id = $1 FOR UPDATE',
      [reservationId]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Reservation not found' };
    }

    const status = rows[0].status;
    const uid = rows[0].user_id;
    const amt = Number(rows[0].amount || 0);

    if (status !== 'reserved') {
      await client.query('ROLLBACK');
      return { success: false, error: `Invalid reservation status: ${status}` };
    }

    await client.query(
      "UPDATE credit_reservations SET status='released', released_at=NOW() WHERE id=$1",
      [reservationId]
    );

    // Notify
    try {
      if (uid) {
        const { rows: ar } = await client.query(
          `SELECT
             u.credits AS balance,
             COALESCE((SELECT SUM(amount) FROM credit_reservations
               WHERE user_id = $1 AND status = 'reserved'
                 AND (expires_at IS NULL OR expires_at > NOW())), 0) AS reserved
           FROM users u WHERE u.id = $1`,
          [uid]
        );

        const bal = Number(ar[0]?.balance || 0);
        const resv = Number(ar[0]?.reserved || 0);
        const available = Math.max(0, bal - resv);

        await client.query('SELECT pg_notify($1, $2)', [
          'credits_changed',
          JSON.stringify({
            user_id: uid,
            credits: bal,
            available,
            reserved: resv,
            event: 'released',
            reservation_id: reservationId,
            delta: amt,
            event_ts: Date.now()
          })
        ]);
      }
    } catch (_) {}

    await client.query('COMMIT');
    return { success: true };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('releaseReservation error:', e);
    return { success: false, error: 'Database error' };
  } finally {
    client.release();
  }
}

/**
 * Legacy debit function for backward compatibility
 * OPTIMIZED: Use captureReservation pattern internally
 */
async function debitCredits(userId, amount, description = 'Credit usage') {
  // Create temporary reservation and immediately capture
  const reservation = await reserveCredits(userId, amount, { description, ttlSeconds: 60 });
  if (!reservation.success) {
    return { success: false, error: reservation.error };
  }

  const capture = await captureReservation(reservation.reservationId, { description });
  return capture;
}

/**
 * Add credits to a user's account
 * Creates a new credit lot with 32-day expiration
 */
async function addCredits(userId, amount, options = {}) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Get user email for tracking sync
    const { rows: userRows } = await client.query(
      'SELECT email FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (userRows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'User not found' };
    }
    const userEmail = userRows[0].email;

    // Insert a lot (default one_off) that expires in 32 days
    const source = options.source || 'one_off';
    const desc = options.description || `Credits purchased (${source})`;
    const lotIns = await client.query(
      `INSERT INTO credit_lots (user_id, source, amount, remaining, expires_at)
       VALUES ($1,$2,$3,$3, NOW() + interval '32 days')
       RETURNING id, expires_at`,
      [userId, source, amount]
    );
    const lotId = lotIns.rows[0]?.id || null;
    const lotExpiresAt = lotIns.rows[0]?.expires_at || null;

    const sumRes = await client.query(
      `SELECT COALESCE(SUM(remaining),0) as rem FROM credit_lots
       WHERE user_id=$1 AND remaining>0 AND closed_at IS NULL
         AND ((expires_at > NOW()) OR source='one_off')`,
      [userId]
    );
    const newCredits = Number(sumRes.rows[0].rem || 0);
    await client.query('UPDATE users SET credits = $1 WHERE id = $2', [newCredits, userId]);
    await client.query(
      'INSERT INTO credit_transactions (user_id, description, amount, balance_after, lot_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, desc, amount, newCredits, lotId, lotExpiresAt]
    );

    // Best-effort sync to email_credit_tracking
    try {
      const upd = await client.query(
        'UPDATE email_credit_tracking SET current_balance = $1, last_updated_at = NOW() WHERE email = $2',
        [newCredits, userEmail]
      );
      if (upd.rowCount === 0) {
        await client.query(
          'INSERT INTO email_credit_tracking (email, total_credits_given, current_balance) VALUES ($1, $2, $3)',
          [userEmail, 0, newCredits]
        );
      }
    } catch (syncErr) {
      console.warn('email_credit_tracking sync (add) failed:', syncErr.message || syncErr);
    }

    // Notify credits/available
    try {
      const { rows: ar } = await client.query(
        `SELECT
           u.credits AS balance,
           COALESCE((SELECT SUM(amount) FROM credit_reservations
             WHERE user_id = $1 AND status = 'reserved'
               AND (expires_at IS NULL OR expires_at > NOW())), 0) AS reserved
         FROM users u WHERE u.id = $1`,
        [userId]
      );
      const bal = Number(ar[0]?.balance || 0);
      const resv = Number(ar[0]?.reserved || 0);
      const available = Math.max(0, bal - resv);
      await client.query('SELECT pg_notify($1, $2)', [
        'credits_changed',
        JSON.stringify({ user_id: userId, credits: newCredits, available })
      ]);
    } catch (_) {}

    await client.query('COMMIT');
    return { success: true, creditsLeft: newCredits };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Credit add error:', error);
    return { success: false, error: 'Database error' };
  } finally {
    client.release();
  }
}

/**
 * Grant a new subscription cycle lot and close previous subscription lots
 * Implements expire-on-renew pattern for subscription credits
 */
async function addSubscriptionCredits(userId, amount, planKey, opts = {}) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Detect if target cycle lot already exists; if so, do nothing (avoid expiring current lot)
    const cycleStartTs = opts.cycleStart || new Date();
    const cycleEndTs = opts.cycleEnd || null;
    const { rows: existing } = await client.query(
      `SELECT id FROM credit_lots WHERE user_id=$1 AND source='subscription' AND cycle_start = $2 LIMIT 1`,
      [userId, cycleStartTs]
    );
    if (existing.length > 0) {
      const sumResPre = await client.query(
        `SELECT COALESCE(SUM(remaining),0) as rem FROM credit_lots
         WHERE user_id=$1 AND remaining>0 AND closed_at IS NULL
           AND ((expires_at > NOW()) OR source='one_off')`,
        [userId]
      );
      const curBal = Number(sumResPre.rows[0].rem || 0);
      await client.query('COMMIT');
      return { success: true, creditsLeft: curBal, lotCreated: false };
    }

    // 1) Log and close previous subscription lots (expire-on-renew)
    const { rows: prevLots } = await client.query(
      `SELECT id, remaining, expires_at FROM credit_lots
       WHERE user_id=$1 AND source='subscription' AND closed_at IS NULL AND remaining > 0
       ORDER BY expires_at ASC, created_at ASC FOR UPDATE`,
      [userId]
    );
    if (prevLots.length > 0) {
      // Insert negative transactions for expiring leftover balances
      for (const lot of prevLots) {
        const rem = Number(lot.remaining || 0);
        if (rem > 0) {
          const { rows: balRows } = await client.query(
            `SELECT COALESCE(SUM(remaining),0) as rem FROM credit_lots
             WHERE user_id=$1 AND remaining>0 AND closed_at IS NULL
               AND ((expires_at > NOW()) OR source='one_off')`,
            [userId]
          );
          const snapBal = Number(balRows[0]?.rem || 0) - rem;
          await client.query(
            `INSERT INTO credit_transactions (user_id, description, amount, balance_after, lot_id, expires_at)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [userId, 'Expired credits (renewal)', -rem, Math.max(snapBal, 0), lot.id, lot.expires_at]
          );
        }
      }
      // Close and zero out previous lots
      await client.query(
        `UPDATE credit_lots SET closed_at = NOW(), remaining = 0
         WHERE user_id=$1 AND source='subscription' AND closed_at IS NULL`,
        [userId]
      );
    }

    // Insert new monthly lot with provided cycle window (idempotent by user_id+source+cycle_start)
    const { rows: ins } = await client.query(
      `INSERT INTO credit_lots (user_id, source, plan_key, cycle_start, amount, remaining, expires_at)
       VALUES ($1,'subscription',$2, $3, $4, $4, COALESCE($5, NOW() + interval '32 days'))
       ON CONFLICT (user_id, source, cycle_start) DO NOTHING
       RETURNING id`,
      [userId, planKey || null, cycleStartTs, amount, cycleEndTs]
    );
    const lotCreated = ins.length > 0;

    // Recompute cached balance
    const sumRes = await client.query(
      `SELECT COALESCE(SUM(remaining),0) as rem FROM credit_lots
       WHERE user_id=$1 AND remaining>0 AND closed_at IS NULL
         AND ((expires_at > NOW()) OR source='one_off')`,
      [userId]
    );
    const newBal = Number(sumRes.rows[0].rem || 0);
    await client.query('UPDATE users SET credits=$1 WHERE id=$2', [newBal, userId]);

    if (lotCreated) {
      await client.query(
        'INSERT INTO credit_transactions (user_id, description, amount, balance_after, lot_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [userId, `Subscription credits (${planKey || 'plan'})`, amount, newBal, ins[0].id, null]
      );
    }

    await client.query('COMMIT');
    return { success: true, creditsLeft: newBal, lotCreated };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('addSubscriptionCredits error:', e);
    return { success: false, error: 'Database error' };
  } finally {
    client.release();
  }
}

/**
 * Batch get credits for multiple users
 * NEW: Optimize admin dashboard queries
 */
async function getCreditsForUsers(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return {};
  }

  const { rows } = await db.query(
    `SELECT
      u.id,
      u.credits as balance,
      COALESCE((
        SELECT SUM(amount) FROM credit_reservations
        WHERE user_id = u.id AND status = 'reserved'
          AND (expires_at IS NULL OR expires_at > NOW())
      ), 0) as reserved
     FROM users u
     WHERE u.id = ANY($1)`,
    [userIds]
  );

  const result = {};
  rows.forEach(row => {
    const balance = Number(row.balance) || 0;
    const reserved = Number(row.reserved) || 0;
    result[row.id] = {
      credits: balance,
      available: Math.max(0, balance - reserved),
      reserved
    };
  });

  return result;
}

module.exports = {
  getAvailableCredits,
  getCredits,
  reserveCredits,
  captureReservation,
  releaseReservation,
  debitCredits,
  addCredits,
  addSubscriptionCredits,
  getCreditsForUsers
};
