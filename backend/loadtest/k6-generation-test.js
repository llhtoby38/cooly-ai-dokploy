/**
 * k6 Load Test Script for Cooly AI Generation Endpoints
 * Contract Item A3.1: Load testing concurrent generation requests
 *
 * Usage:
 *   k6 run loadtest/k6-generation-test.js
 *
 * Environment variables:
 *   API_BASE - API base URL (default: http://localhost:5001)
 *   TEST_EMAIL - Test user email (default: test@example.com)
 *   TEST_PASSWORD - Test user password (default: testpassword123)
 *   TEST_DURATION - Test duration (default: 30s)
 *   TEST_VUS - Virtual users (default: 10)
 *   TEST_RPS - Target requests per second (default: 5)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');
const generationSuccess = new Rate('generation_success');
const creditErrors = new Counter('credit_errors');
const providerErrors = new Counter('provider_errors');

// Test configuration
export const options = {
  // Stages-based load test
  stages: [
    { duration: '10s', target: 5 },   // Ramp up to 5 users
    { duration: '20s', target: 10 },  // Ramp up to 10 users
    { duration: '30s', target: 10 },  // Stay at 10 users
    { duration: '10s', target: 0 },   // Ramp down to 0
  ],

  // Thresholds - Define pass/fail criteria
  thresholds: {
    'errors': ['rate<0.10'],                    // Error rate < 10%
    'response_time': ['p(95)<30000'],           // 95% of requests < 30s
    'generation_success': ['rate>0.80'],        // 80% success rate
    'http_req_failed': ['rate<0.10'],           // HTTP error rate < 10%
    'http_req_duration': ['p(99)<60000'],       // 99% of requests < 60s
  },
};

// Configuration
const API_BASE = __ENV.API_BASE || 'http://localhost:5001';
const TEST_EMAIL = __ENV.TEST_EMAIL || 'test@example.com';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'testpassword123';

// Test prompts
const prompts = [
  'A scenic landscape at sunset',
  'A futuristic city skyline',
  'A peaceful forest scene',
  'An abstract geometric pattern',
  'A cute cat playing with yarn',
  'A modern minimalist interior',
  'A vibrant street art mural',
  'A serene ocean beach',
];

// Login and get auth token
function login() {
  const loginPayload = JSON.stringify({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  };

  const response = http.post(`${API_BASE}/api/auth/login`, loginPayload, params);

  check(response, {
    'login successful': (r) => r.status === 200,
    'login returned token': (r) => r.json('token') !== undefined,
  });

  if (response.status !== 200) {
    console.error(`Login failed: ${response.status} ${response.body}`);
    return null;
  }

  return response.json('token');
}

// Setup function - runs once per VU
export function setup() {
  console.log(`Setting up load test against ${API_BASE}`);

  // Test login to verify connectivity
  const token = login();
  if (!token) {
    throw new Error('Setup failed: Could not obtain auth token');
  }

  return { apiBase: API_BASE };
}

// Main test function - runs repeatedly for each VU
export default function (data) {
  // Get auth token
  const token = login();
  if (!token) {
    errorRate.add(1);
    return;
  }

  // Select random prompt
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];

  // Generate image request
  const payload = JSON.stringify({
    prompt: prompt,
    model: 'seedream-4-0-t2i-250415',
    outputs: 1,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `token=${token}`,
    },
    timeout: '60s',
    tags: { endpoint: 'seedream4' },
  };

  const startTime = Date.now();
  const response = http.post(`${API_BASE}/api/images/seedream4/generate`, payload, params);
  const duration = Date.now() - startTime;

  responseTime.add(duration);

  // Check response
  const success = check(response, {
    'status is 202': (r) => r.status === 202,
    'has session_id': (r) => r.json('session_id') !== undefined,
    'has client_key': (r) => r.json('clientKey') !== undefined,
  });

  if (!success) {
    errorRate.add(1);

    // Track specific error types
    if (response.status === 402 || response.status === 400) {
      const body = response.json();
      if (body && body.error && body.error.includes('credit')) {
        creditErrors.add(1);
      }
    } else if (response.status >= 500) {
      providerErrors.add(1);
    }
  } else {
    generationSuccess.add(1);
  }

  // Random think time between 1-3 seconds
  sleep(Math.random() * 2 + 1);
}

// Teardown function - runs once at end
export function teardown(data) {
  console.log('Load test completed');
}
