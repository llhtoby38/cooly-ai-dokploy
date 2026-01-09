const db = require('../db');

/**
 * Clean up old entries from deleted_emails blacklist
 * This allows legitimate users to return after a specified period
 * @param {number} daysOld - Remove entries older than this many days (default: 90)
 */
async function cleanupDeletedEmails(daysOld = 90) {
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');

    // Delete entries older than specified days
    const { rows } = await client.query(
      'DELETE FROM deleted_emails WHERE deleted_at < NOW() - INTERVAL \'$1 days\' RETURNING email, deleted_at',
      [daysOld]
    );

    await client.query('COMMIT');

    if (rows.length > 0) {
      console.log(`🧹 Cleaned up ${rows.length} old deleted email entries (older than ${daysOld} days)`);
      rows.forEach(row => {
        console.log(`  - ${row.email} (deleted: ${row.deleted_at})`);
      });
    } else {
      console.log(`🧹 No old deleted email entries to clean up (older than ${daysOld} days)`);
    }

    return rows.length;
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to cleanup deleted emails:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get statistics about the deleted emails blacklist
 */
async function getDeletedEmailsStats() {
  try {
    const { rows } = await db.query(`
      SELECT 
        COUNT(*) as total_entries,
        COUNT(CASE WHEN deleted_at > NOW() - INTERVAL '7 days' THEN 1 END) as last_7_days,
        COUNT(CASE WHEN deleted_at > NOW() - INTERVAL '30 days' THEN 1 END) as last_30_days,
        COUNT(CASE WHEN deleted_at > NOW() - INTERVAL '90 days' THEN 1 END) as last_90_days,
        MIN(deleted_at) as oldest_entry,
        MAX(deleted_at) as newest_entry
      FROM deleted_emails
    `);

    return rows[0];
    
  } catch (error) {
    console.error('❌ Failed to get deleted emails stats:', error);
    throw error;
  }
}

module.exports = {
  cleanupDeletedEmails,
  getDeletedEmailsStats
};
