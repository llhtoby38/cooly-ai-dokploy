#!/usr/bin/env node
/**
 * Minimal integration runner that exercises the live API and SQS worker path.
 *
 * Behaviour:
 * 1. Loads the repo root .env so local credentials are available.
 * 2. Hits `/healthz` (or `/api/healthz`) on the configured API base URL.
 * 3. Fires a generation via the existing queue smoke test (`diag:queue`).
 *
 * Required env vars:
 *   INTEGRATION_TEST_USER_ID   – UUID of a real user in the target environment.
 *
 * Optional overrides:
 *   INTEGRATION_BASE_URL       – API base URL (default http://localhost:5000).
 *   INTEGRATION_TEST_JOB_TYPE  – Queue job type (default gen.seedream4).
 *   INTEGRATION_TEST_OUTPUTS   – Number of outputs (default 1).
 *   INTEGRATION_USE_MOCK       – 'true' to force mock generation (default true).
 */

const path = require('path');
const { spawn } = require('child_process');

const dotenv = require('dotenv');
let fs;
try { fs = require('fs'); } catch (_) { fs = null; }

const candidateEnvPaths = [
  path.resolve(__dirname, '../../.env'),       // backend/.env
  path.resolve(__dirname, '../../../.env'),    // repo-root /.env
];

for (const envPath of candidateEnvPaths) {
  try {
    if (!fs || !fs.existsSync(envPath)) continue;
    dotenv.config({ path: envPath });
    break;
  } catch (_) {
    // ignore and try next candidate
  }
}

const axios = require('axios');

const BASE_URL = process.env.INTEGRATION_BASE_URL || 'http://localhost:5000';
const USER_ID = process.env.INTEGRATION_TEST_USER_ID;
const JOB_TYPE = process.env.INTEGRATION_TEST_JOB_TYPE || 'gen.seedream4';
const OUTPUTS = Number(process.env.INTEGRATION_TEST_OUTPUTS || 1);
const USE_MOCK = String(process.env.INTEGRATION_USE_MOCK || 'true').toLowerCase() !== 'false';

if (!USER_ID) {
  console.error('[integration] Missing INTEGRATION_TEST_USER_ID environment variable.');
  process.exit(1);
}

async function callHealthEndpoint() {
  const urlsToTry = [`${BASE_URL}/healthz`, `${BASE_URL}/api/healthz`, `${BASE_URL}/health`];
  let lastError = null;
  for (const url of urlsToTry) {
    try {
      const res = await axios.get(url, { timeout: 5000 });
      console.log('[integration] Health check ok:', url, res.status);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Health check failed for base URL ${BASE_URL}: ${lastError?.message || lastError}`);
}

function runQueueSmokeTest() {
  return new Promise((resolve, reject) => {
    const args = [
      path.resolve(__dirname, '../diagnostics/queueSmokeTest.js'),
      '--user',
      USER_ID,
      '--job',
      JOB_TYPE,
      '--outputs',
      String(Math.max(1, OUTPUTS)),
    ];

    if (!USE_MOCK) {
      args.push('--mock', 'false');
    }

    console.log('[integration] Running queue smoke test:', args.join(' '));

    const child = spawn('node', args, {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Queue smoke test exited with code ${code}`));
      }
    });
  });
}

(async () => {
  console.log('[integration] Starting integration checks');
  console.log('[integration] Base URL:', BASE_URL);
  console.log('[integration] User ID  :', USER_ID);
  console.log('[integration] Job type :', JOB_TYPE);
  console.log('[integration] Outputs  :', OUTPUTS);
  console.log('[integration] Mock mode:', USE_MOCK);

  await callHealthEndpoint();
  await runQueueSmokeTest();

  console.log('\n✅ Integration checks completed successfully.');
})().catch((err) => {
  console.error('\n❌ Integration checks failed:', err?.message || err);
  process.exit(1);
});


