"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';
import { getDistinctId } from '../analytics/analyticsClient';
import phFetch from '../services/phFetch';
import { useApiBase } from '../hooks/useApiBase';

export const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export function AuthProvider({ children, initialUser = null }) {
  const [user, setUser] = useState(initialUser);
  const [loading, setLoading] = useState(!initialUser);
  const sseRef = React.useRef(null);
  const lastEventTsRef = React.useRef(0);
  const [creditToasts, setCreditToasts] = useState([]); // [{ id, type, amount, createdAt }]
  const lastReservedDeltaRef = React.useRef(0);
  const lastReservedToastAtRef = React.useRef(0); // no-op (kept for potential future use)
  const recentLocalRefundAtRef = React.useRef(0);

  // Use the centralized useApiBase hook
  const API_BASE = useApiBase();

  // Check if user is logged in on app start (background if we already have initialUser)
  useEffect(() => {
    if (initialUser) {
      // Background revalidate without showing a loading flicker
      checkAuth(false);
    } else {
      checkAuth(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open SSE stream for credits updates when logged in
  useEffect(() => {
    // cleanup any previous
    if (sseRef.current) {
      try { sseRef.current.close(); } catch {}
      sseRef.current = null;
    }
    if (!user?.id) return;
    try {
      const src = new EventSource(`${API_BASE}/api/user/credits/stream`, { withCredentials: true });
      sseRef.current = src;
      src.addEventListener('credits', async (e) => {
        try {
          const data = JSON.parse(e.data || '{}');
          if (typeof data.credits === 'number') {
            if (process.env.NODE_ENV === 'development') {
              try { console.log('[SSE credits]', data); } catch {}
            }
            // Optional monotonic ordering by event_ts when present
            try {
              const ts = Number(data.event_ts || 0);
              if (ts && ts < lastEventTsRef.current) {
                if (process.env.NODE_ENV === 'development') {
                  console.log('[SSE debug] dropping stale event', { ts, last: lastEventTsRef.current });
                }
                return;
              }
              if (ts) lastEventTsRef.current = ts;
            } catch {}
            // Trust server math: available = credits - reserved
            setUser((prev) => {
              if (!prev) return prev;
              const payloadReserved = (typeof data.reserved === 'number') ? data.reserved : 0;
              const expectedAvail = Math.max(0, Number(data.credits || 0) - Number(payloadReserved || 0));
              return {
                ...prev,
                credits: data.credits,
                reserved_credits: payloadReserved,
                available_credits: expectedAvail
              };
            });
            try {
              const ev = String(data.event || '').toLowerCase();
              const amt = Number(data.delta || 0);
              if (ev === 'reserved' && amt > 0) {
                lastReservedDeltaRef.current = amt;
              }
              // Suppress SSE 'reserved' toast; keep 'released' and 'captured'
              if (((ev === 'released') || (ev === 'captured')) && amt > 0) {
                // If a local refund toast just fired very recently, suppress the SSE duplicate
                if (ev === 'released') {
                  const now = Date.now();
                  if (now - (recentLocalRefundAtRef.current || 0) < 1200) {
                    return;
                  }
                }
                const toast = { id: `${Date.now()}-${Math.random()}`, type: ev, amount: amt, createdAt: Date.now() };
                setCreditToasts((prev) => [...prev, toast].slice(-5));
                setTimeout(() => {
                  setCreditToasts((prev) => prev.filter(t => t.id !== toast.id));
                }, 2200);
              }
            } catch {}
          } else {
            // Fallback: soft refresh
            checkAuth(false);
          }
        } catch {
          checkAuth(false);
        }
      });
      
      // Generation event listeners
      src.addEventListener('session_created', (e) => {
        try {
          const data = JSON.parse(e.data || '{}');
          if (process.env.NODE_ENV === 'development') {
            try { console.log('[SSE gen] session_created', data); } catch {}
          }
          // Dispatch custom event for pages to listen to
          window.dispatchEvent(new CustomEvent('session_created', { detail: data }));
        } catch {}
      });
      
      src.addEventListener('session_completed', (e) => {
        try {
          const data = JSON.parse(e.data || '{}');
          if (process.env.NODE_ENV === 'development') {
            try { console.log('[SSE gen] session_completed', data); } catch {}
          }
          // Dispatch custom event for pages to listen to
          window.dispatchEvent(new CustomEvent('session_completed', { detail: data }));
        } catch {}
      });
      
      src.addEventListener('images_attached', (e) => {
        try {
          const data = JSON.parse(e.data || '{}');
          if (process.env.NODE_ENV === 'development') {
            try { console.log('[SSE gen] images_attached', data); } catch {}
          }
          // Dispatch custom event for pages to listen to
          window.dispatchEvent(new CustomEvent('images_attached', { detail: data }));
        } catch {}
      });
      
      src.onerror = () => {
        // retry will be handled by browser; keep minimal
      };
    } catch {}
    return () => {
      if (sseRef.current) {
        try { sseRef.current.close(); } catch {}
        sseRef.current = null;
      }
    };
  }, [user?.id, API_BASE]);

  const checkAuth = async (manageLoading = true) => {
    try {
      if (manageLoading) setLoading(true);
      const phId = (typeof window !== 'undefined') ? (getDistinctId() || undefined) : undefined;
      const response = await fetch(`${API_BASE}/api/user/me`, {
        credentials: 'include',
        headers: phId ? { 'X-PostHog-Distinct-Id': phId } : undefined
      });
      
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setUser(null);
    } finally {
      if (manageLoading) setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      const response = await phFetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        return { success: true };
      } else {
        const error = await response.json();
        return { success: false, error: error.error || 'Login failed' };
      }
    } catch (error) {
      return { success: false, error: 'Network error' };
    }
  };

  const register = async (email, password) => {
    try {
      const response = await phFetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        return { success: true };
      } else {
        const error = await response.json();
        return { success: false, error: error.error || 'Registration failed' };
      }
    } catch (error) {
      return { success: false, error: 'Network error' };
    }
  };

  const logout = async () => {
    try {
      const phId = (typeof window !== 'undefined') ? (getDistinctId() || undefined) : undefined;
      await fetch(`${API_BASE}/api/user/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: phId ? { 'X-PostHog-Distinct-Id': phId } : undefined
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
    }
  };

  const deleteAccount = async () => {
    try {
      const phId = (typeof window !== 'undefined') ? (getDistinctId() || undefined) : undefined;
      const response = await fetch(`${API_BASE}/api/user/account`, {
        method: 'DELETE',
        credentials: 'include',
        headers: phId ? { 'X-PostHog-Distinct-Id': phId } : undefined
      });

      if (response.ok) {
        // Account deleted successfully, clear user state
        setUser(null);
        return { success: true };
      } else {
        const error = await response.json();
        return { success: false, error: error.error || 'Failed to delete account' };
      }
    } catch (error) {
      console.error('Delete account error:', error);
      return { success: false, error: 'Network error' };
    }
  };

  const value = {
    user,
    loading,
    showCreditToast: (type, amount) => {
      try {
        if (!type || !(amount > 0)) return;
        if (type === 'released') {
          recentLocalRefundAtRef.current = Date.now();
        }
        const toast = { id: `${Date.now()}-${Math.random()}`, type, amount, createdAt: Date.now() };
        setCreditToasts((prev) => [...prev, toast].slice(-5));
        setTimeout(() => {
          setCreditToasts((prev) => prev.filter(t => t.id !== toast.id));
        }, 2200);
      } catch {}
    },
    getLastReservedAmount: () => {
      try { return Number(lastReservedDeltaRef.current || 0) || 0; } catch { return 0; }
    },
    applyOptimisticAvailableDelta: (delta) => {
      try {
        if (typeof delta !== 'number' || !Number.isFinite(delta)) return;
        setUser((prev) => {
          if (!prev) return prev;
          const base = (typeof prev.available_credits === 'number') ? prev.available_credits : (prev.credits || 0);
          const next = Math.max(0, base + delta);
          return { ...prev, available_credits: next };
        });
      } catch {}
    },
    login,
    register,
    logout,
    deleteAccount,
    checkAuth
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {creditToasts && creditToasts.length > 0 && (
        <div style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 9999, pointerEvents: 'none' }}>
          {[...creditToasts].slice(-5).map((t, idx, arr) => {
            const order = arr.length - 1 - idx; // newest last → stack upwards
            const y = order * 44;
            const ageMs = Math.max(0, Date.now() - (t.createdAt || 0));
            const life = 2200;
            const fade = ageMs > life - 400 ? Math.max(0, (life - ageMs) / 400) : 1;
            const isReleased = t.type === 'released';
            const isReserved = t.type === 'reserved';
            const bg = isReleased
              ? 'rgba(153, 27, 27, 0.92)'
              : (isReserved ? 'rgba(146, 64, 14, 0.90)' : 'rgba(6, 78, 59, 0.90)');
            const border = isReleased
              ? '#7f1d1d'
              : (isReserved ? '#854d0e' : '#065f46');
            const fg = isReleased
              ? '#fee2e2'
              : (isReserved ? '#fef08a' : '#bbf7d0');
            return (
              <div
                key={t.id}
                style={{
                  transform: `translateY(-${y}px)`,
                  marginTop: 8,
                  opacity: fade,
                  transition: 'opacity 180ms ease, transform 180ms ease',
                  backgroundColor: bg,
                  color: fg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  padding: '8px 12px',
                  boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                  pointerEvents: 'auto',
                  minWidth: 160,
                }}
                role="status"
                aria-live="polite"
              >
                {t.type === 'reserved' ? `Deducted ${t.amount} credits` : (t.type === 'released' ? `Refunded ${t.amount} credits` : `Captured ${t.amount} credits`)}
              </div>
            );
          })}
        </div>
      )}
    </AuthContext.Provider>
  );
}; 