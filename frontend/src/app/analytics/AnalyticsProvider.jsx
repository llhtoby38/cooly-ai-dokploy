"use client";
import React, { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from "../contexts/AuthContext";
import { initAnalytics, capture, identify, alias, getDistinctId } from './analyticsClient';

export default function AnalyticsProvider({ children }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const priorAnonIdRef = useRef(null);

  // Init once
  useEffect(() => {
    initAnalytics();
    // store initial anonymous id for aliasing later
    try { priorAnonIdRef.current = getDistinctId(); } catch {}
  }, []);

  // Identify / alias on auth changes
  useEffect(() => {
    const uid = user?.id ? String(user.id) : null;
    if (!uid) return;
    try {
      const prev = priorAnonIdRef.current;
      if (prev && prev !== uid) {
        alias(prev, uid);
      }
    } catch {}
    identify(uid, { email: user?.email || undefined });
  }, [user?.id]);

  // Track page views on route change
  useEffect(() => {
    const search = searchParams?.toString() || '';
    const ref = typeof document !== 'undefined' ? (document.referrer || undefined) : undefined;
    // Custom event for funnels
    capture('Page Viewed', { path: pathname || '/', search: search ? `?${search}` : '', referrer: ref });
    // Also emit $pageview so Web Analytics dashboard populates
    capture('$pageview', { current_url: (typeof window !== 'undefined' ? window.location.href : undefined), referrer: ref });

    // Centralized funnel events
    const path = pathname || '';
    const m = path.match(/^\/(image|video)\/([^/]+)/);
    if (m) {
      const tool = m[2];
      capture('Tool Viewed', { tool, url: (typeof window !== 'undefined' ? window.location.href : undefined) });
    }
    if (path.startsWith('/billing')) {
      capture('Pricing Viewed', { source: 'billing-page', url: (typeof window !== 'undefined' ? window.location.href : undefined) });
    }
  }, [pathname, searchParams]);

  // Listen to existing global events to avoid touching components
  useEffect(() => {
    const onAuth = (e) => {
      const mode = e?.detail?.mode === 'register' ? 'register' : 'login';
      capture(mode === 'register' ? 'Registration Modal Opened' : 'Login Modal Opened');
      capture('Auth Modal Opened', { mode });
    };
    const onBilling = () => {
      capture('Billing Modal Opened');
      capture('Pricing Viewed', { source: 'billing-modal' });
    };
    const onCreated = (e) => capture('Generation Session Created', { ...(e?.detail || {}) });
    const onCompleted = (e) => capture('Generation Session Completed', { ...(e?.detail || {}) });
    const onAttached = (e) => capture('Images Attached', { ...(e?.detail || {}) });
    window.addEventListener('open-auth-modal', onAuth);
    window.addEventListener('open-billing-modal', onBilling);
    window.addEventListener('session_created', onCreated);
    window.addEventListener('session_completed', onCompleted);
    window.addEventListener('images_attached', onAttached);
    return () => {
      window.removeEventListener('open-auth-modal', onAuth);
      window.removeEventListener('open-billing-modal', onBilling);
      window.removeEventListener('session_created', onCreated);
      window.removeEventListener('session_completed', onCompleted);
      window.removeEventListener('images_attached', onAttached);
    };
  }, []);

  return children;
}


