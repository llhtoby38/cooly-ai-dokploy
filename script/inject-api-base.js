// script/inject-api-base.js
// Dynamically sets NEXT_PUBLIC_API_BASE for Vercel builds so that
// each preview front-end talks to its matching Render back-end.
//
// Rules:
// 1. On PR previews we build the URL from the PR number →
//       https://cooly-ai-pr-<PR_NUMBER>.onrender.com
//    (Render names PR preview web services this way.)
// 2. On production (main) we use the permanent production URL.
// 3. On any other branch build (feature branches without PR) we
//    fall back to the old “branch--service.onrender.com” pattern.

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
// NOTE: converted to async script to allow GitHub API fetch
console.log('▪ ENV SNAPSHOT', {
  PR_ID: process.env.VERCEL_GIT_PULL_REQUEST_ID,
  PR_NUM: process.env.VERCEL_GIT_PULL_REQUEST_NUMBER,
  PR_LEGACY: process.env.VERCEL_PULL_REQUEST,
  BRANCH: process.env.VERCEL_GIT_COMMIT_REF,
  ENV: process.env.VERCEL_ENV
});

// ------------- figure out environment ------------
const branch = process.env.VERCEL_GIT_COMMIT_REF || 'main';
let prNumber =
  process.env.VERCEL_GIT_PULL_REQUEST_ID || // Vercel 2024+ variable
  process.env.VERCEL_GIT_PULL_REQUEST_NUMBER || // older variable name
  process.env.VERCEL_PULL_REQUEST || // fallback
  '';

// -------- GitHub fallback lookup --------
if (!prNumber && process.env.GITHUB_TOKEN) {
  try {
    const owner = process.env.VERCEL_GIT_REPO_OWNER;
    const repo  = process.env.VERCEL_GIT_REPO_SLUG;
    if (owner && repo) {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`;
      const output = execSync(
        `curl -s -H "Authorization: token ${process.env.GITHUB_TOKEN}" ${apiUrl}`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
      );
      const prs = JSON.parse(output);
      if (Array.isArray(prs) && prs.length) {
        prNumber = prs[0].number.toString();
        console.log('• GitHub lookup found PR', prNumber);
      } else {
        console.log('• GitHub lookup: no open PR for this branch');
      }
    }
  } catch (e) {
    console.log('• GitHub lookup failed:', e.message);
  }
}


let apiBase;
if (prNumber) {
  // PR preview → Render service is cooly-ai-pr-<N>.onrender.com
  apiBase = `https://cooly-ai-pr-${prNumber}.onrender.com`;
} else if (branch === 'main' || process.env.VERCEL_ENV === 'production') {
  // Production build (main branch) → permanent backend
  apiBase = 'https://cooly-ai.onrender.com';
} else if (process.env.VERCEL_ENV === 'preview') {
  // Preview environment without PR ID - cannot determine backend URL
  // Render only creates preview services for PRs, not branches
  console.error('❌ Preview build without PR ID - cannot determine backend URL');
  console.error('   Render preview services only exist for PRs');
  console.error('   Create a PR first, then push changes');
  process.exit(1);
} else {
  // Non-preview environment (development) - use production backend
  apiBase = 'https://cooly-ai.onrender.com';
  console.log('• Using production backend for non-preview build');
}

// ------------- load root .env (if present) ------------------------
// Read the repo root .env so we can propagate relevant NEXT_PUBLIC_* vars
const rootEnvPath = path.resolve(process.cwd(), '../.env');
let rootEnv = {};
if (fs.existsSync(rootEnvPath)) {
  try {
    const raw = fs.readFileSync(rootEnvPath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) {
        const key = m[1].trim();
        const val = m[2].trim();
        // Strip optional surrounding quotes
        rootEnv[key] = val.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
      }
    });
  } catch (e) {
    console.log('• Could not parse root .env:', e.message);
  }
}

// ------------- write frontend .env.local ------------------------
// We are running from the frontend directory (cwd). Write into that dir so Next picks it up.
const envPath = path.resolve(process.cwd(), '.env.local');
let lines = [];
if (fs.existsSync(envPath)) {
  lines = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) =>
      !l.startsWith('NEXT_PUBLIC_API_BASE=') &&
      !l.startsWith('NEXT_PUBLIC_MOCK_API=') &&
      !l.startsWith('NEXT_PUBLIC_DEBUG_LOGS=')
    );
}

// Base URL (computed above)
lines.push(`NEXT_PUBLIC_API_BASE=${apiBase}`);

// Propagate mock/debug flags from root .env if present; otherwise preserve existing process.env
const mockFromRoot = rootEnv.NEXT_PUBLIC_MOCK_API ?? process.env.NEXT_PUBLIC_MOCK_API;
if (typeof mockFromRoot !== 'undefined') {
  lines.push(`NEXT_PUBLIC_MOCK_API=${mockFromRoot}`);
}
const debugFromRoot = rootEnv.NEXT_PUBLIC_DEBUG_LOGS ?? process.env.NEXT_PUBLIC_DEBUG_LOGS;
if (typeof debugFromRoot !== 'undefined') {
  lines.push(`NEXT_PUBLIC_DEBUG_LOGS=${debugFromRoot}`);
}

fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
console.log('✓ inject-api-base →', apiBase);
if (typeof mockFromRoot !== 'undefined') console.log('✓ synced NEXT_PUBLIC_MOCK_API =', mockFromRoot);
if (typeof debugFromRoot !== 'undefined') console.log('✓ synced NEXT_PUBLIC_DEBUG_LOGS =', debugFromRoot);
