const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Use the same connection logic as the backend
const envName = (process.env.ENV_NAME || '').toLowerCase();
const vercelPreview = (process.env.VERCEL_ENV || '').toLowerCase() === 'preview';
const renderUrl = (process.env.RENDER_EXTERNAL_URL || '').toLowerCase();
const renderHost = (process.env.RENDER_EXTERNAL_HOSTNAME || '').toLowerCase();
const renderBranch = (process.env.RENDER_GIT_BRANCH || '').toLowerCase();

const isRenderPr = renderUrl.includes('-pr-') || renderHost.includes('-pr-');
const isRenderNonMain = !!renderBranch && renderBranch !== 'main';

const isPreviewEnv = vercelPreview || isRenderPr || isRenderNonMain || envName === 'preview';

const connectionString = (isPreviewEnv && process.env.PREVIEW_DATABASE_URL)
  ? process.env.PREVIEW_DATABASE_URL
  : process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ No database connection string found. Expected DATABASE_URL or PREVIEW_DATABASE_URL with ENV_NAME=preview');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

async function checkAndRunMigrations() {
  try {
    console.log('🔍 Checking database schema...');
    
    // Check if client_key exists in generation_sessions
    const sessionsResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='generation_sessions' AND column_name='client_key'
    `);
    
    const sessionsHasClientKey = sessionsResult.rows.length > 0;
    console.log(`📋 generation_sessions.client_key exists: ${sessionsHasClientKey}`);
    
    // Check if client_key exists in images
    const imagesResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='images' AND column_name='client_key'
    `);
    
    const imagesHasClientKey = imagesResult.rows.length > 0;
    console.log(`📋 images.client_key exists: ${imagesHasClientKey}`);
    
    // Check if created_at exists in images
    const imagesCreatedAtResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='images' AND column_name='created_at'
    `);
    
    const imagesHasCreatedAt = imagesCreatedAtResult.rows.length > 0;
    console.log(`📋 images.created_at exists: ${imagesHasCreatedAt}`);
    
    // Check if completed_at exists in images
    const imagesCompletedAtResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='images' AND column_name='completed_at'
    `);
    // Check if client_key exists in video_generation_sessions (Seedance)
    const vidsClientKeyResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='video_generation_sessions' AND column_name='client_key'
    `);
    const vidsHasClientKey = vidsClientKeyResult.rows.length > 0;
    console.log(`📋 video_generation_sessions.client_key exists: ${vidsHasClientKey}`);

    // Check token_usage columns
    const genTokenUsage = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name='generation_sessions' AND column_name='token_usage'`);
    const vgenTokenUsage = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name='video_generation_sessions' AND column_name='token_usage'`);
    const hasGenUsage = genTokenUsage.rows.length > 0;
    const hasVgenUsage = vgenTokenUsage.rows.length > 0;
    console.log(`📋 generation_sessions.token_usage exists: ${hasGenUsage}`);
    console.log(`📋 video_generation_sessions.token_usage exists: ${hasVgenUsage}`);

    // Check token count columns
    const genCounts = await pool.query(`
      SELECT 1 FROM information_schema.columns WHERE table_name='generation_sessions' AND column_name IN ('completion_tokens','total_tokens')`);
    const vgenCounts = await pool.query(`
      SELECT 1 FROM information_schema.columns WHERE table_name='video_generation_sessions' AND column_name IN ('completion_tokens','total_tokens')`);
    const hasGenCounts = genCounts.rowCount >= 2; // both present
    const hasVgenCounts = vgenCounts.rowCount >= 2;
    console.log(`📋 generation_sessions token counts exist: ${hasGenCounts}`);
    console.log(`📋 video_generation_sessions token counts exist: ${hasVgenCounts}`);

    // Check USD columns
    const genUsd = await pool.query(`
      SELECT 1 FROM information_schema.columns WHERE table_name='generation_sessions' AND column_name IN ('per_image_usd','session_usd')`);
    const vgenUsd = await pool.query(`
      SELECT 1 FROM information_schema.columns WHERE table_name='video_generation_sessions' AND column_name IN ('token_usd_per_k','session_usd')`);
    const hasGenUsd = genUsd.rowCount >= 2;
    const hasVgenUsd = vgenUsd.rowCount >= 2;
    console.log(`📋 generation_sessions USD cols exist: ${hasGenUsd}`);
    console.log(`📋 video_generation_sessions USD cols exist: ${hasVgenUsd}`);

    
    const imagesHasCompletedAt = imagesCompletedAtResult.rows.length > 0;
    console.log(`📋 images.completed_at exists: ${imagesHasCompletedAt}`);
    
    // Run migrations if needed
    if (!sessionsHasClientKey) {
      console.log('🚀 Running migration 029_add_client_key_to_sessions.sql...');
      const migration029 = fs.readFileSync(path.join(__dirname, '../database/migrations/029_add_client_key_to_sessions.sql'), 'utf8');
      await pool.query(migration029);
      console.log('✅ Migration 029 complete');
    }
    
    if (!imagesHasClientKey || !imagesHasCreatedAt || !imagesHasCompletedAt) {
      console.log('🚀 Running migration 030_add_client_key_to_images.sql...');
      const migration030 = fs.readFileSync(path.join(__dirname, '../database/migrations/030_add_client_key_to_images.sql'), 'utf8');
      await pool.query(migration030);
      console.log('✅ Migration 030 complete');
    }
    
    if (!vidsHasClientKey) {
      console.log('🚀 Running migration 031_add_client_key_to_video_generation_sessions.sql...');
      const migration031 = fs.readFileSync(path.join(__dirname, '../database/migrations/031_add_client_key_to_video_generation_sessions.sql'), 'utf8');
      await pool.query(migration031);
      console.log('✅ Migration 031 complete');
    }

    if (!hasGenUsage || !hasVgenUsage) {
      console.log('🚀 Running migration 034_add_token_usage_columns.sql...');
      const migration034 = fs.readFileSync(path.join(__dirname, '../database/migrations/034_add_token_usage_columns.sql'), 'utf8');
      await pool.query(migration034);
      console.log('✅ Migration 034 complete');
    }

    if (!hasGenCounts || !hasVgenCounts) {
      console.log('🚀 Running migration 035_add_token_counts.sql...');
      const migration035 = fs.readFileSync(path.join(__dirname, '../database/migrations/035_add_token_counts.sql'), 'utf8');
      await pool.query(migration035);
      console.log('✅ Migration 035 complete');
    }

    if (!hasGenUsd || !hasVgenUsd) {
      console.log('🚀 Running migration 036_add_usd_cost_columns.sql...');
      const migration036 = fs.readFileSync(path.join(__dirname, '../database/migrations/036_add_usd_cost_columns.sql'), 'utf8');
      await pool.query(migration036);
      console.log('✅ Migration 036 complete');
    }

    if (sessionsHasClientKey && imagesHasClientKey && imagesHasCreatedAt && imagesHasCompletedAt && vidsHasClientKey && hasGenUsage && hasVgenUsage && hasGenCounts && hasVgenCounts && hasGenUsd && hasVgenUsd) {
      console.log('✅ All migrations already applied');
    }
    
    console.log('🎉 Migration check complete');
    
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkAndRunMigrations();
