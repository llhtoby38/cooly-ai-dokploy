const db = require('../db');

/**
 * Clean up expired pending generations
 * This should be run periodically to remove old pending records
 */
async function cleanupExpiredPendingGenerations() {
  try {
    const result = await db.query(
      `DELETE FROM pending_generations 
       WHERE expires_at < NOW() OR 
             (status = 'failed' AND updated_at < NOW() - INTERVAL '1 hour') OR
             (status = 'resolved' AND updated_at < NOW() - INTERVAL '1 day')`,
    );
    
    if (result.rowCount > 0) {
      console.log(`[Cleanup] Removed ${result.rowCount} expired pending generations`);
    }
    
    return { success: true, cleaned: result.rowCount };
  } catch (error) {
    console.error('[Cleanup] Failed to clean up expired pending generations:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get pending generations statistics
 */
async function getPendingGenerationsStats() {
  try {
    const { rows } = await db.query(`
      SELECT 
        status,
        COUNT(*) as count,
        MIN(created_at) as oldest,
        MAX(created_at) as newest
      FROM pending_generations 
      GROUP BY status
    `);
    
    return { success: true, stats: rows };
  } catch (error) {
    console.error('[Stats] Failed to get pending generations stats:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  cleanupExpiredPendingGenerations,
  getPendingGenerationsStats
};
