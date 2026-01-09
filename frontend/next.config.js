/** @type {import('next').NextConfig} */
const path = require('path');

// Load env files - .env.local takes precedence for local development
try {
  // First load .env.local (local overrides)
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
  // Then load .env (defaults, won't override existing)
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} catch (e) {
  console.warn('[next.config] dotenv not found; relying on existing process.env');
}

// Check if running in production/Docker (standalone mode)
const isProduction = process.env.NODE_ENV === 'production';

const nextConfig = {
  // Enable standalone output for Docker deployments
  // Creates a self-contained build in .next/standalone
  output: 'standalone',

  // Expose selected env vars to the browser at build/dev time
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE,
    NEXT_PUBLIC_MOCK_API: process.env.NEXT_PUBLIC_MOCK_API,
    NEXT_PUBLIC_DEBUG_LOGS: process.env.NEXT_PUBLIC_DEBUG_LOGS,
    // Sanity public config (required both server and client)
    NEXT_PUBLIC_SANITY_PROJECT_ID: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
    NEXT_PUBLIC_SANITY_DATASET: process.env.NEXT_PUBLIC_SANITY_DATASET,
    NEXT_PUBLIC_SANITY_API_VERSION: process.env.NEXT_PUBLIC_SANITY_API_VERSION,
  },

  async rewrites() {
    // In production, frontend calls backend directly via NEXT_PUBLIC_API_BASE
    // Only use rewrites for local development proxy
    if (isProduction) {
      return [];
    }
    return [
      // Proxy ALL API requests to the backend in dev
      {
        source: '/api/:path*',
        destination: 'http://localhost:5000/api/:path*',
      },
    ];
  },
};

module.exports = nextConfig;