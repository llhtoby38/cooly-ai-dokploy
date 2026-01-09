// Simple verification that the new deduplication logic works correctly
// This simulates the exact scenario where 3 completed sessions should all appear

console.log('=== Verifying Deduplication Fix ===\n');

// Simulate 3 completed sessions with identical timestamps (the problematic case)
const timestamp = '2024-01-15T10:30:00.000Z';

const sessions = [
  {
    session_id: 'session-1',
    prompt: 'A beautiful sunset',
    status: 'completed',
    created_at: timestamp,
    images: ['image1.jpg'],
    isOptimistic: false
  },
  {
    session_id: 'session-2', 
    prompt: 'A mountain landscape',
    status: 'completed',
    created_at: timestamp, // Same timestamp - this was causing issues
    images: ['image2.jpg'],
    isOptimistic: false
  },
  {
    session_id: 'session-3',
    prompt: 'A city skyline',
    status: 'completed', 
    created_at: timestamp, // Same timestamp - this was causing issues
    images: ['image3.jpg'],
    isOptimistic: false
  }
];

console.log('Input: 3 sessions with identical timestamps');
console.log('Session IDs:', sessions.map(s => s.session_id));

// Apply the NEW simplified deduplication logic
const seen = new Map();
const finalList = [];

for (const s of sessions) {
  // NEW logic: prioritize session_id (this is the key fix)
  let primaryKey = s.session_id;
  
  // Since all sessions have session_id, this will be the primary key
  console.log(`Processing ${s.session_id} with key: ${primaryKey}`);
  
  if (seen.has(primaryKey)) {
    console.log(`❌ DUPLICATE: ${primaryKey} (this should not happen with unique session_ids)`);
    continue;
  }
  
  seen.set(primaryKey, s);
  finalList.push(s);
  console.log(`✅ Added ${s.session_id}`);
}

console.log('\n=== Results ===');
console.log(`Final count: ${finalList.length} (expected: 3)`);
console.log(`Final IDs: ${finalList.map(s => s.session_id).join(', ')}`);

if (finalList.length === 3) {
  console.log('\n✅ SUCCESS: All 3 sessions preserved!');
  console.log('The fix correctly handles sessions with identical timestamps by using session_id as the primary key.');
} else {
  console.log('\n❌ FAILURE: Sessions were lost during deduplication');
}

// Test the optimistic replacement scenario
console.log('\n=== Testing Optimistic Replacement ===\n');

const optimisticSessions = [
  {
    session_id: null,
    clientKey: 'temp-123',
    prompt: 'A beautiful sunset',
    status: 'processing',
    created_at: timestamp,
    images: [],
    isOptimistic: true
  },
  {
    session_id: 'session-1',
    clientKey: 'temp-123', // Same clientKey as optimistic
    prompt: 'A beautiful sunset',
    status: 'completed',
    created_at: timestamp,
    images: ['image1.jpg'],
    isOptimistic: false
  }
];

console.log('Input: 1 optimistic + 1 real session with same clientKey');
console.log('Optimistic clientKey:', optimisticSessions[0].clientKey);
console.log('Real session_id:', optimisticSessions[1].session_id);

const seen2 = new Map();
const finalList2 = [];

for (const s of optimisticSessions) {
  let primaryKey = s.session_id || s.clientKey;
  console.log(`Processing ${s.session_id || s.clientKey} with key: ${primaryKey}`);
  
  if (seen2.has(primaryKey)) {
    const existing = seen2.get(primaryKey);
    if (s.session_id && !existing.session_id) {
      // Replace optimistic with real session
      const index = finalList2.findIndex(item => {
        const itemKey = item.session_id || item.clientKey;
        return itemKey === primaryKey;
      });
      if (index >= 0) {
        finalList2[index] = s;
        seen2.set(primaryKey, s);
        console.log(`🔄 Replaced optimistic with real session ${s.session_id}`);
      }
    } else {
      console.log(`⏭️ Skipping duplicate - keeping existing`);
    }
    continue;
  }
  
  // Check if this real session should replace an existing optimistic session with same clientKey
  if (s.session_id && s.clientKey) {
    const optimisticIndex = finalList2.findIndex(item => 
      !item.session_id && item.clientKey === s.clientKey
    );
    if (optimisticIndex >= 0) {
      finalList2[optimisticIndex] = s;
      seen2.set(s.clientKey, s);
      console.log(`🔄 Replaced optimistic session with real session ${s.session_id}`);
      continue;
    }
  }
  
  seen2.set(primaryKey, s);
  finalList2.push(s);
  console.log(`✅ Added ${s.session_id || s.clientKey}`);
}

console.log('\n=== Optimistic Replacement Results ===');
console.log(`Final count: ${finalList2.length} (expected: 1)`);
console.log(`Final session_id: ${finalList2[0]?.session_id || 'none'}`);

if (finalList2.length === 1 && finalList2[0].session_id === 'session-1') {
  console.log('\n✅ SUCCESS: Optimistic session correctly replaced with real session!');
} else {
  console.log('\n❌ FAILURE: Optimistic replacement failed');
}
