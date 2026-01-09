"use client";
import posthog from 'posthog-js';

let initialized = false;

export function initAnalytics() {
  if (initialized) return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';
  if (!key) {
    return; // no-op if not configured
  }
  posthog.init(key, {
    api_host: host,
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    persistence: 'cookie',
    disable_session_recording: true, // gate replay via consent if you enable later
  });
  initialized = true;
}

export function capture(event: string, properties?: Record<string, any>) {
  try { if (initialized) posthog.capture(event, properties); } catch {}
}

export function identify(userId: string, properties?: Record<string, any>) {
  try { if (initialized && userId) posthog.identify(String(userId), properties); } catch {}
}

export function alias(previousId: string, userId: string) {
  try { if (initialized && previousId && userId) posthog.alias(String(userId), String(previousId)); } catch {}
}

export function getDistinctId(): string | null {
  try { return initialized ? String(posthog.get_distinct_id() || '') : null; } catch { return null; }
}

export function shutdown() {
  try { if (initialized) posthog.reset(); } catch {}
}


