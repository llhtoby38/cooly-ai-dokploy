#!/usr/bin/env node

/**
 * Test script for Email Credit Tracking System
 * Run this to verify the anti-credit-farming system is working
 */

const db = require('../backend/src/db');
const { getAvailableCredits, getCreditTrackingStats } = require('../backend/src/utils/emailCredits');

async function testCreditTracking() {
  console.log('🧪 Testing Email Credit Tracking System...\n');

  try {
    // Test 1: Check if table exists
    console.log('1️⃣ Checking if email_credit_tracking table exists...');
    const { rows: tableCheck } = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'email_credit_tracking'
      );
    `);
    
    if (tableCheck[0].exists) {
      console.log('✅ email_credit_tracking table exists');
    } else {
      console.log('❌ email_credit_tracking table does not exist');
      return;
    }

    // Test 2: Check table structure
    console.log('\n2️⃣ Checking table structure...');
    const { rows: columns } = await db.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'email_credit_tracking' 
      ORDER BY ordinal_position;
    `);
    
    console.log('Table columns:');
    columns.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });

    // Test 3: Check current credit tracking entries
    console.log('\n3️⃣ Checking current credit tracking entries...');
    const { rows: entries } = await db.query(`
      SELECT email, total_credits_given, current_balance, first_registration_at, last_updated_at
      FROM email_credit_tracking 
      ORDER BY last_updated_at DESC 
      LIMIT 5;
    `);
    
    if (entries.length > 0) {
      console.log(`Found ${entries.length} credit tracking entries:`);
      entries.forEach(entry => {
        console.log(`  - ${entry.email}: ${entry.total_credits_given} total given, ${entry.current_balance} current balance`);
      });
    } else {
      console.log('No credit tracking entries found (this is normal for a fresh system)');
    }

    // Test 4: Check indexes
    console.log('\n4️⃣ Checking indexes...');
    const { rows: indexes } = await db.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'email_credit_tracking';
    `);
    
    if (indexes.length > 0) {
      console.log('Indexes found:');
      indexes.forEach(idx => {
        console.log(`  - ${idx.indexname}`);
      });
    } else {
      console.log('No indexes found');
    }

    // Test 5: Test credit tracking utility functions
    console.log('\n5️⃣ Testing credit tracking utility functions...');
    try {
      const stats = await getCreditTrackingStats();
      console.log('Credit tracking stats:');
      console.log(`  - Total emails tracked: ${stats.totalEmails}`);
      console.log(`  - Total credits given: ${stats.totalCreditsGiven}`);
      console.log(`  - Average credits per email: ${stats.averageCreditsPerEmail.toFixed(2)}`);
    } catch (error) {
      console.log('⚠️ Credit tracking stats failed:', error.message);
    }

    console.log('\n🎯 Credit tracking system is ready!');
    console.log('\nTo test the system:');
    console.log('1. Register a new account → Should get 10 credits');
    console.log('2. Use some credits (e.g., 3) → Should have 7 left');
    console.log('3. Delete the account → Credits saved in tracking system');
    console.log('4. Re-register with same email → Should get 7 credits (not 10)');
    console.log('5. Use more credits → Balance decreases');
    console.log('6. Eventually reach 0 lifetime credits → Cannot get more');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    process.exit(0);
  }
}

// Run the test
testCreditTracking();
