const db = require('../backend/src/db');

async function checkMigrations() {
  try {
    console.log('🔍 Checking if migrations have been run...\n');
    
    // Check if client_key column exists in generation_sessions
    const sessionsCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'generation_sessions' AND column_name = 'client_key'
    `);
    
    console.log('📋 generation_sessions.client_key column:', sessionsCheck.rows.length > 0 ? '✅ EXISTS' : '❌ MISSING');
    
    // Check if client_key column exists in images
    const imagesCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'images' AND column_name = 'client_key'
    `);
    
    console.log('🖼️ images.client_key column:', imagesCheck.rows.length > 0 ? '✅ EXISTS' : '❌ MISSING');
    
    // Check if created_at column exists in images
    const imagesCreatedCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'images' AND column_name = 'created_at'
    `);
    
    console.log('🖼️ images.created_at column:', imagesCreatedCheck.rows.length > 0 ? '✅ EXISTS' : '❌ MISSING');
    
    // Check sample data
    if (sessionsCheck.rows.length > 0) {
      const sampleSessions = await db.query(`
        SELECT id, client_key, created_at 
        FROM generation_sessions 
        ORDER BY created_at DESC 
        LIMIT 3
      `);
      
      console.log('\n📊 Sample generation_sessions:');
      sampleSessions.rows.forEach((row, idx) => {
        console.log(`  ${idx + 1}. ID: ${row.id}, client_key: ${row.client_key || 'NULL'}, created: ${row.created_at}`);
      });
    }
    
    if (imagesCheck.rows.length > 0) {
      const sampleImages = await db.query(`
        SELECT session_id, client_key, created_at 
        FROM images 
        ORDER BY created_at DESC 
        LIMIT 3
      `);
      
      console.log('\n🖼️ Sample images:');
      sampleImages.rows.forEach((row, idx) => {
        console.log(`  ${idx + 1}. session_id: ${row.session_id}, client_key: ${row.client_key || 'NULL'}, created: ${row.created_at}`);
      });
    }
    
    console.log('\n✅ Migration check complete!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration check failed:', error);
    process.exit(1);
  }
}

checkMigrations();
