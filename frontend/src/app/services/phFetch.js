import { getDistinctId, capture, initAnalytics } from '../analytics/analyticsClient';

export async function phFetch(input, options = {}) {
  try { initAnalytics(); } catch {}
  const phId = (typeof window !== 'undefined') ? (getDistinctId() || undefined) : undefined;
  const headers = {
    ...(options.headers || {}),
    ...(phId ? { 'X-PostHog-Distinct-Id': phId } : {}),
  };
  const finalOpts = {
    credentials: 'include',
    ...options,
    headers,
  };
  try {
    // Centralized funnel events based on request intent
    const rawUrl = typeof input === 'string' ? input : (input?.url || '');
    const base = (typeof window !== 'undefined' && window.location) ? window.location.origin : 'http://localhost';
    let pathname = '';
    try { pathname = new URL(rawUrl, base).pathname || ''; } catch {}
    const method = (finalOpts.method || 'GET').toUpperCase();

    if (method === 'POST' && /\/generate(\/?|$)/.test(pathname)) {
      capture('Generate Clicked', { path: pathname });
    }
    const tmplMatch = pathname.match(/^\/api\/templates\/([^/]+)\/([^/]+)/);
    if (method === 'GET' && tmplMatch) {
      const tool = tmplMatch[1];
      const slug = tmplMatch[2];
      capture('Template Applied', { tool, templateSlug: slug });
    }

    // Checkout Started (one-off credits or subscription)
    if (method === 'POST' && /\/api\/billing\/(create-checkout-session|create-subscription)(\/?|$)/.test(pathname)) {
      capture('Checkout Started', { path: pathname });
    }

    // Registration Completed: detect successful register call on response below
  } catch {}

  const res = await fetch(input, finalOpts);
  try {
    const rawUrl = typeof input === 'string' ? input : (input?.url || '');
    const base = (typeof window !== 'undefined' && window.location) ? window.location.origin : 'http://localhost';
    let pathname = '';
    try { pathname = new URL(rawUrl, base).pathname || ''; } catch {}
    const method = (finalOpts.method || 'GET').toUpperCase();

    // Registration Completed (client confirmation): only on success status
    if (method === 'POST' && res.ok && /\/api\/auth\/register(\/?|$)/.test(pathname)) {
      capture('Registration Completed', { method: 'email_password' });
    }
    // Login Completed (client confirmation): only on success status
    if (method === 'POST' && res.ok && /\/api\/auth\/login(\/?|$)/.test(pathname)) {
      capture('Login Completed');
    }
    // OAuth Login Completed via session exchange
    if (method === 'POST' && res.ok && /\/api\/user\/session\/exchange(\/?|$)/.test(pathname)) {
      capture('Login Completed', { method: 'google_oauth' });
    }
  } catch {}
  return res;
}

export default phFetch;


