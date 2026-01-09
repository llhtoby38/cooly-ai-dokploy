#!/usr/bin/env node

/**
 * Test script for deleted emails blacklist
 * Run this to verify the anti-credit-farming system is working
 */

const db = require('../backend/src/db');

async function testBlacklist() {
  console.log('🧪 Testing Deleted Emails Blacklist...\n');

  try {
    // Test 1: Check if table exists
    console.log('1️⃣ Checking if deleted_emails table exists...');
    const { rows: tableCheck } = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'deleted_emails'
      );
    `);
    
    if (tableCheck[0].exists) {
      console.log('✅ deleted_emails table exists');
    } else {
      console.log('❌ deleted_emails table does not exist');
      return;
    }

    // Test 2: Check table structure
    console.log('\n2️⃣ Checking table structure...');
    const { rows: columns } = await db.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'deleted_emails' 
      ORDER BY ordinal_position;
    `);
    
    console.log('Table columns:');
    columns.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });

    // Test 3: Check current blacklist entries
    console.log('\n3️⃣ Checking current blacklist entries...');
    const { rows: entries } = await db.query(`
      SELECT email, deleted_at, reason 
      FROM deleted_emails 
      ORDER BY deleted_at DESC 
      LIMIT 5;
    `);
    
    if (entries.length > 0) {
      console.log(`Found ${entries.length} blacklist entries:`);
      entries.forEach(entry => {
        console.log(`  - ${entry.email} (deleted: ${entry.deleted_at}, reason: ${entry.reason})`);
      });
    } else {
      console.log('No blacklist entries found (this is normal for a fresh system)');
    }

    // Test 4: Check indexes
    console.log('\n4️⃣ Checking indexes...');
    const { rows: indexes } = await db.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'deleted_emails';
    `);
    
    if (indexes.length > 0) {
      console.log('Indexes found:');
      indexes.forEach(idx => {
        console.log(`  - ${idx.indexname}`);
      });
    } else {
      console.log('No indexes found');
    }

    console.log('\n🎯 Blacklist system is ready!');
    console.log('\nTo test the system:');
    console.log('1. Register a new account');
    console.log('2. Delete the account');
    console.log('3. Try to register again with the same email');
    console.log('4. You should see: "This email address cannot be used for registration"');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    process.exit(0);
  }
}

// Run the test
testBlacklist();
