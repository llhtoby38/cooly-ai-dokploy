// Global fetch interceptor for mock mode
// When NEXT_PUBLIC_MOCK_API === 'true', intercept API calls to your backend
// and serve responses from MockApiService without touching the code at call sites.

import MockApiService from './mockApi';

export function installFetchInterceptor() {
  try {
    if (typeof window === 'undefined') return; // only in browser
    // Disabled: frontend no longer intercepts; backend mock handles everything
    return;
    if (window.__mockFetchInstalled) return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      try {
        const url = typeof input === 'string' ? input : (input?.url || '');
        const method = (init?.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
        // Never intercept mutating requests so backend (with MOCK_API) can persist sessions/images
        if (method !== 'GET' && method !== 'HEAD') {
          return await originalFetch(input, init);
        }
        // Only intercept calls to our API (relative /api or matches configured base)
        const isApi = (() => {
          if (!url) return false;
          try {
            if (url.startsWith('/api/')) return true;
            const base = process.env.NEXT_PUBLIC_API_BASE || '';
            if (base && url.startsWith(base)) return true;
          } catch {}
          return false;
        })();

        if (!isApi) {
          return await originalFetch(input, init);
        }

        // Use MockApiService to generate a Response-like object
        MockApiService.logUsage(method, url, init);
        const mock = await MockApiService.request(url, init);

        // Shape a real Response from mock
        return new Response(JSON.stringify(await mock.json()), {
          status: mock.status || 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        // Fallback to real fetch on any error
        return await originalFetch(input, init);
      }
    };

    window.__mockFetchInstalled = true;
    if (process.env.NODE_ENV === 'development') {
      console.log('🎭 Global fetch interceptor: enabled');
    }
  } catch {}
}

export default installFetchInterceptor;


