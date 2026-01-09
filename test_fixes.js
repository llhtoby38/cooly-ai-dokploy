#!/usr/bin/env node

// Quick test script to verify the fixes
const axios = require('axios');

const API_BASE = 'http://localhost:5000';
const TEST_TOKEN = 'your_test_token_here'; // Replace with actual token

async function testInputValidation() {
  console.log('🧪 Testing input validation...');
  
  const testCases = [
    {
      name: 'Empty prompt',
      data: { prompt: '', model: 'seedream-3-0-t2i-250415', outputs: 1 },
      expectedStatus: 400
    },
    {
      name: 'Invalid outputs',
      data: { prompt: 'test', model: 'seedream-3-0-t2i-250415', outputs: 15 },
      expectedStatus: 400
    },
    {
      name: 'Invalid guidance scale',
      data: { prompt: 'test', model: 'seedream-3-0-t2i-250415', outputs: 1, guidance_scale: 25 },
      expectedStatus: 400
    }
  ];

  for (const testCase of testCases) {
    try {
      const response = await axios.post(`${API_BASE}/api/image/generate`, testCase.data, {
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json'
        },
        validateStatus: () => true // Don't throw on 4xx/5xx
      });
      
      if (response.status === testCase.expectedStatus) {
        console.log(`✅ ${testCase.name}: PASSED (${response.status})`);
      } else {
        console.log(`❌ ${testCase.name}: FAILED (expected ${testCase.expectedStatus}, got ${response.status})`);
      }
    } catch (error) {
      console.log(`❌ ${testCase.name}: ERROR - ${error.message}`);
    }
  }
}

async function testDatabaseQuery() {
  console.log('🧪 Testing database query optimization...');
  
  try {
    const response = await axios.get(`${API_BASE}/api/images/seedream3/history`, {
      headers: { 'Authorization': `Bearer ${TEST_TOKEN}` }
    });
    
    if (response.data.items && response.data.items.length > 0) {
      const item = response.data.items[0];
      if (Array.isArray(item.urls) && Array.isArray(item.b2_urls)) {
        console.log('✅ Database query optimization: PASSED (arrays present)');
      } else {
        console.log('❌ Database query optimization: FAILED (arrays missing)');
      }
    } else {
      console.log('⚠️  Database query optimization: SKIPPED (no history data)');
    }
  } catch (error) {
    console.log(`❌ Database query optimization: ERROR - ${error.message}`);
  }
}

async function runTests() {
  console.log('🚀 Starting fix verification tests...\n');
  
  await testInputValidation();
  console.log('');
  await testDatabaseQuery();
  
  console.log('\n📝 Manual tests to perform:');
  console.log('1. Check console logs in development vs production mode');
  console.log('2. Monitor memory usage during multiple generations');
  console.log('3. Check polling frequency in Network tab (should be ~1s)');
  console.log('4. Test error handling with network failures');
}

if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testInputValidation, testDatabaseQuery };
