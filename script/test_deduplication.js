// Test script to simulate the deduplication issue
// Testing the new simplified deduplication logic

const simulateSessions = () => {
  // Simulate 3 completed sessions with similar timestamps
  const timestamp = new Date().toISOString();
  
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
      created_at: timestamp, // Same timestamp
      images: ['image2.jpg'],
      isOptimistic: false
    },
    {
      session_id: 'session-3',
      prompt: 'A city skyline',
      status: 'completed', 
      created_at: timestamp, // Same timestamp
      images: ['image3.jpg'],
      isOptimistic: false
    }
  ];

  console.log('Original sessions:', sessions.length);
  console.log('Session IDs:', sessions.map(s => s.session_id));

  // Test the NEW simplified deduplication logic
  const seen = new Map();
  const finalList = [];
  
  for (const s of sessions) {
    // NEW logic: prioritize session_id
    let primaryKey = s.session_id;
    
    // Fallback key: clientKey if no session_id
    if (!primaryKey) {
      primaryKey = s.clientKey;
    }
    
    // Final fallback: composite key for optimistic sessions
    if (!primaryKey) {
      const promptHash = (s.prompt || 'unknown').slice(0, 20);
      const status = s.status || 'unknown';
      primaryKey = `${promptHash}-${s.created_at}-${status}`;
    }
    
    console.log(`Processing session ${s.session_id || s.clientKey || 'optimistic'} with key: ${primaryKey}`);
    
    if (seen.has(primaryKey)) {
      console.log(`❌ DUPLICATE FOUND: ${primaryKey}`);
      const existing = seen.get(primaryKey);
      
      // If both have session_id, keep the one with more complete data
      if (s.session_id && existing.session_id) {
        const sCompleted = s.status === 'completed' || (s.images && s.images.length > 0);
        const existingCompleted = existing.status === 'completed' || (existing.images && existing.images.length > 0);
        
        if (sCompleted && !existingCompleted) {
          // Replace processing with completed
          const index = finalList.findIndex(item => {
            const itemKey = item.session_id || item.clientKey || 
              `${(item.prompt || 'unknown').slice(0, 20)}-${item.created_at}-${item.status || 'unknown'}`;
            return itemKey === primaryKey;
          });
          if (index >= 0) {
            finalList[index] = s;
            seen.set(primaryKey, s);
            console.log(`🔄 Replaced processing session ${primaryKey} with completed version`);
          }
        } else {
          console.log(`⏭️ Skipping duplicate session ${primaryKey} - keeping existing`);
        }
      } else {
        // One has session_id, one doesn't - prefer the one with session_id
        if (s.session_id && !existing.session_id) {
          const index = finalList.findIndex(item => {
            const itemKey = item.session_id || item.clientKey || 
              `${(item.prompt || 'unknown').slice(0, 20)}-${item.created_at}-${item.status || 'unknown'}`;
            return itemKey === primaryKey;
          });
          if (index >= 0) {
            finalList[index] = s;
            seen.set(primaryKey, s);
            console.log(`🔄 Replaced optimistic session ${primaryKey} with real session ${s.session_id}`);
          }
        } else {
          console.log(`⏭️ Skipping duplicate session ${primaryKey} - keeping existing`);
        }
      }
      continue;
    }
    
    // First time seeing this key, add it
    seen.set(primaryKey, s);
    finalList.push(s);
    console.log(`✅ Added new session ${primaryKey} with status ${s.status}`);
  }

  console.log('\nFinal result:');
  console.log('Final sessions count:', finalList.length);
  console.log('Final session IDs:', finalList.map(s => s.session_id));
  
  return finalList;
};

// Test with the problematic scenario
console.log('=== Testing NEW Simplified Deduplication Logic ===\n');
const result = simulateSessions();

if (result.length !== 3) {
  console.log('\n❌ ISSUE CONFIRMED: Only', result.length, 'out of 3 sessions survived deduplication');
} else {
  console.log('\n✅ SUCCESS: All 3 sessions survived deduplication');
}

// Test with optimistic sessions
console.log('\n=== Testing with Optimistic Sessions ===\n');
const testOptimistic = () => {
  const timestamp = new Date().toISOString();
  
  const sessions = [
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
      clientKey: 'temp-123', // Same clientKey as optimistic session
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
      created_at: timestamp,
      images: ['image2.jpg'],
      isOptimistic: false
    }
  ];

  console.log('Original sessions:', sessions.length);
  
  const seen = new Map();
  const finalList = [];
  
  for (const s of sessions) {
    let primaryKey = s.session_id || s.clientKey;
    if (!primaryKey) {
      const promptHash = (s.prompt || 'unknown').slice(0, 20);
      const status = s.status || 'unknown';
      primaryKey = `${promptHash}-${s.created_at}-${status}`;
    }
    
    console.log(`Processing session ${s.session_id || s.clientKey || 'optimistic'} with key: ${primaryKey}`);
    
    if (seen.has(primaryKey)) {
      const existing = seen.get(primaryKey);
      if (s.session_id && !existing.session_id) {
        const index = finalList.findIndex(item => {
          const itemKey = item.session_id || item.clientKey || 
            `${(item.prompt || 'unknown').slice(0, 20)}-${item.created_at}-${item.status || 'unknown'}`;
          return itemKey === primaryKey;
        });
        if (index >= 0) {
          finalList[index] = s;
          seen.set(primaryKey, s);
          console.log(`🔄 Replaced optimistic session ${primaryKey} with real session ${s.session_id}`);
        }
      } else {
        console.log(`⏭️ Skipping duplicate session ${primaryKey} - keeping existing`);
      }
      continue;
    }
    
    // Check if this real session should replace an existing optimistic session with same clientKey
    if (s.session_id && s.clientKey) {
      const optimisticIndex = finalList.findIndex(item => 
        !item.session_id && item.clientKey === s.clientKey
      );
      if (optimisticIndex >= 0) {
        finalList[optimisticIndex] = s;
        seen.set(s.clientKey, s);
        console.log(`🔄 Replaced existing optimistic session with real session ${s.session_id}`);
        continue;
      }
    }
    
    seen.set(primaryKey, s);
    finalList.push(s);
    console.log(`✅ Added new session ${primaryKey} with status ${s.status}`);
  }

  console.log('\nFinal result:');
  console.log('Final sessions count:', finalList.length);
  console.log('Final session IDs:', finalList.map(s => s.session_id || s.clientKey));
  
  return finalList;
};

const optimisticResult = testOptimistic();
if (optimisticResult.length === 2 && optimisticResult.some(s => s.session_id === 'session-1')) {
  console.log('\n✅ SUCCESS: Optimistic session correctly replaced with real session');
} else {
  console.log('\n❌ ISSUE: Optimistic session replacement failed');
}