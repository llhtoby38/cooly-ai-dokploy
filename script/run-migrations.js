// Simple script to run the client_key migrations
const fs = require('fs');
const path = require('path');

console.log('🚀 Running client_key migrations...\n');

// Migration 029: Add client_key to generation_sessions
const migration029 = fs.readFileSync(path.join(__dirname, '../database/migrations/029_add_client_key_to_sessions.sql'), 'utf8');
console.log('📋 Migration 029: Add client_key to generation_sessions');
console.log('SQL:', migration029.split('\n')[0] + '...');

// Migration 030: Add client_key to images  
const migration030 = fs.readFileSync(path.join(__dirname, '../database/migrations/030_add_client_key_to_images.sql'), 'utf8');
console.log('\n📋 Migration 030: Add client_key to images');
console.log('SQL:', migration030.split('\n')[0] + '...');

console.log('\n✅ Migration files are ready!');
console.log('\n📝 To run these migrations, you need to:');
console.log('1. Connect to your database');
console.log('2. Run: psql -d your_database_name -f database/migrations/029_add_client_key_to_sessions.sql');
console.log('3. Run: psql -d your_database_name -f database/migrations/030_add_client_key_to_images.sql');
console.log('\nOr if you have a .env file with DATABASE_URL:');
console.log('cd backend && node -e "const db=require(\'./src/db\'); const fs=require(\'fs\'); db.query(fs.readFileSync(\'../database/migrations/029_add_client_key_to_sessions.sql\',\'utf8\')).then(()=>db.query(fs.readFileSync(\'../database/migrations/030_add_client_key_to_images.sql\',\'utf8\'))).then(()=>{console.log(\'Migrations complete\'); process.exit(0);}).catch(e=>{console.error(e); process.exit(1);});"');
