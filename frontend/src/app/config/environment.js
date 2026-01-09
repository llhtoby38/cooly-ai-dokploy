// Environment configuration for the application
// This centralizes environment variable access and provides defaults

const config = {
  // API Configuration
  API_BASE: process.env.NEXT_PUBLIC_API_BASE || (() => {
    // Force localhost for development to avoid cookie domain issues
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        return 'http://localhost:5000';
      }
    }
    return 'https://cooly-ai.onrender.com';
  })(),

  // Mock API Configuration
  MOCK_API_ENABLED: String(process.env.NEXT_PUBLIC_MOCK_API || '').toLowerCase() === 'true',

  // Development flags
  IS_DEVELOPMENT: process.env.NODE_ENV === 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',

  // Feature flags
  ENABLE_DEBUG_LOGS: process.env.NEXT_PUBLIC_DEBUG_LOGS === 'true' || process.env.NODE_ENV === 'development',
};

// Helper function to check if mock mode is enabled
export const isMockModeEnabled = () => {
  return config.MOCK_API_ENABLED;
};

// Helper function to get API base URL
export const getApiBase = () => {
  return config.API_BASE;
};

// Helper function to log debug information
export const debugLog = (...args) => {
  if (config.ENABLE_DEBUG_LOGS) {
    console.log('[DEBUG]', ...args);
  }
};

export default config;
