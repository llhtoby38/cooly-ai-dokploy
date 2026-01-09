const db = require('../db');
const { getBooleanSetting } = require('./appSettings');

const LIFETIME_CREDIT_LIMIT = 10; // Maximum FREE credits ever given to an email

async function isFreeSignupCreditsEnabled() {
  try {
    return await getBooleanSetting('free_signup_credits_enabled', true);
  } catch {
    return true; // fail-open to avoid blocking signups if table missing
  }
}

/**
 * Get remaining credits available for an email address
 * @param {string} email - Email address to check
 * @returns {Promise<{freeAvailable: number, paidRestore: number, totalToGive: number, totalGiven: number, isNewEmail: boolean, isRestore: boolean}>}
 */
async function getAvailableCredits(email) {
  try {
    const { rows } = await db.query(
      'SELECT total_credits_given, current_balance, free_balance, paid_balance FROM email_credit_tracking WHERE email = $1',
      [email]
    );

    if (rows.length === 0) {
      // New email: optionally give welcome credits depending on setting
      const flag = await isFreeSignupCreditsEnabled();
      const free = flag ? LIFETIME_CREDIT_LIMIT : 0;
      return {
        freeAvailable: free,
        paidRestore: 0,
        totalToGive: free,
        totalGiven: 0,
        currentBalance: 0,
        isNewEmail: true,
        isRestore: false
      };
    }

    const tracking = rows[0];
    const freeBalance = Number(tracking.free_balance) || 0;
    const paidBalance = Number(tracking.paid_balance) || 0;
    const hasSavedBalances = freeBalance > 0 || paidBalance > 0;

    if (hasSavedBalances) {
      const freeAvailable = freeBalance;
      const paidRestore = paidBalance;
      return {
        freeAvailable,
        paidRestore,
        totalToGive: freeAvailable + paidRestore,
        totalGiven: tracking.total_credits_given,
        currentBalance: (Number(tracking.current_balance) || (freeBalance + paidBalance)),
        isNewEmail: false,
        isRestore: true
      };
    }

    // Otherwise, offer any remaining lifetime FREE headroom (if they were previously granted < limit)
    const flag = await isFreeSignupCreditsEnabled();
    const remainingLifetime = LIFETIME_CREDIT_LIMIT - tracking.total_credits_given;
    const freeAvailable = flag ? Math.max(0, remainingLifetime) : 0;

    return {
      freeAvailable,
      paidRestore: 0,
      totalToGive: freeAvailable,
      totalGiven: tracking.total_credits_given,
      currentBalance: Number(tracking.current_balance) || 0,
      isNewEmail: false,
      isRestore: false
    };
  } catch (error) {
    console.error('Failed to get available credits for email:', error);
    throw error;
  }
}

/**
 * Create or update email credit tracking for new registration
 * @param {string} email - Email address
 * @param {number} freeCreditsToGive - FREE credits to give at registration
 * @param {number} paidCreditsToRestore - PURCHASED credits to restore at registration
 * @param {{ incrementLifetimeTotal?: boolean }} options - Whether to increment lifetime total_credits_given by freeCreditsToGive
 * @returns {Promise<{success: boolean, freeGiven: number, paidRestored: number, totalGiven: number}>}
 */
async function registerEmailCredits(email, freeCreditsToGive, paidCreditsToRestore, options = {}) {
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');

    // Check if email already has tracking
    const { rows } = await client.query(
      'SELECT total_credits_given, current_balance, free_balance, paid_balance FROM email_credit_tracking WHERE email = $1',
      [email]
    );

    if (rows.length === 0) {
      // New email, create tracking record
      await client.query(
        'INSERT INTO email_credit_tracking (email, total_credits_given, current_balance, free_balance, paid_balance) VALUES ($1, $2, $3, $4, $5)',
        [email, freeCreditsToGive, freeCreditsToGive + paidCreditsToRestore, freeCreditsToGive, paidCreditsToRestore]
      );
    } else {
      // Existing email, update tracking
      const currentTotal = rows[0].total_credits_given;
      const incrementLifetime = options.incrementLifetimeTotal === true ? freeCreditsToGive : 0;
      const newTotal = currentTotal + incrementLifetime;

      await client.query(
        'UPDATE email_credit_tracking SET total_credits_given = $1, current_balance = $2, free_balance = $3, paid_balance = $4, last_updated_at = NOW() WHERE email = $5',
        [newTotal, freeCreditsToGive + paidCreditsToRestore, freeCreditsToGive, paidCreditsToRestore, email]
      );
    }

    await client.query('COMMIT');

    return {
      success: true,
      freeGiven: freeCreditsToGive,
      paidRestored: paidCreditsToRestore,
      totalGiven: rows.length > 0 ? (rows[0].total_credits_given + (options.incrementLifetimeTotal ? freeCreditsToGive : 0)) : freeCreditsToGive
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to register email credits:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Update credit balance when account is deleted
 * @param {string} email - Email address
 * @param {number} currentBalance - Current credit balance in the account being deleted
 * @returns {Promise<{success: boolean}>}
 */
async function updateCreditBalanceOnDeletion(email, currentBalance) {
  try {
    // Read current tracked split
    const { rows } = await db.query(
      'SELECT free_balance, paid_balance FROM email_credit_tracking WHERE email = $1',
      [email]
    );

    let freeBal = 0;
    let paidBal = 0;
    if (rows.length > 0) {
      freeBal = Number(rows[0].free_balance) || 0;
      paidBal = Number(rows[0].paid_balance) || 0;
    }

    // Constrain by currentBalance at deletion time
    const freeToSave = Math.min(freeBal, currentBalance);
    const paidToSave = Math.max(currentBalance - freeToSave, 0);

    await db.query(
      'UPDATE email_credit_tracking SET current_balance = $1, free_balance = $2, paid_balance = $3, last_updated_at = NOW() WHERE email = $4',
      [freeToSave + paidToSave, freeToSave, paidToSave, email]
    );

    console.log(`💾 Saved credit balance ${currentBalance} for ${email} on account deletion`);
    return { success: true };

  } catch (error) {
    console.error('Failed to update credit balance on deletion:', error);
    throw error;
  }
}

/**
 * Get credit tracking statistics
 * @returns {Promise<{totalEmails: number, totalCreditsGiven: number, averageCreditsPerEmail: number}>}
 */
async function getCreditTrackingStats() {
  try {
    const { rows } = await db.query(`
      SELECT 
        COUNT(*) as total_emails,
        SUM(total_credits_given) as total_credits_given,
        AVG(total_credits_given) as average_credits_per_email
      FROM email_credit_tracking
    `);

    return {
      totalEmails: parseInt(rows[0].total_emails) || 0,
      totalCreditsGiven: parseInt(rows[0].total_credits_given) || 0,
      averageCreditsPerEmail: parseFloat(rows[0].average_credits_per_email) || 0
    };

  } catch (error) {
    console.error('Failed to get credit tracking stats:', error);
    throw error;
  }
}

module.exports = {
  getAvailableCredits,
  registerEmailCredits,
  updateCreditBalanceOnDeletion,
  getCreditTrackingStats,
  LIFETIME_CREDIT_LIMIT
};
