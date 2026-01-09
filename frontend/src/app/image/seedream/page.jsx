"use client";
import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import phFetch from "../../services/phFetch";
import AppShell from "../../components/AppShell";
import SeedreamPanel from "../../components/SeedreamPanel";
import GenerationGuard, { canGenerate } from "../../components/GenerationGuard";
import { useAuth } from "../../contexts/AuthContext";
import { useImageGeneration } from "../../hooks/useImageGeneration";
import ImageHistoryCard from "../../components/history/ImageHistoryCard";

function SeedreamTemplateApplier({ img }) {
  const searchParams = useSearchParams();
  const appliedRef = useRef(false);
  
  useEffect(() => {
    if (appliedRef.current) return;
    
    const slug = String(searchParams?.get('template') || '').toLowerCase();
    if (!slug) return;
    const run = async () => {
      try {
        const res = await phFetch(`${img.API_BASE}/api/templates/seedream/${encodeURIComponent(slug)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const t = await res.json();
        if (t && t.settings) {
          img.applyTemplate?.(t.settings);
          appliedRef.current = true;
        }
      } catch {}
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  return null;
}

export default function SeedreamPage() {
  const { user, checkAuth, logout } = useAuth();
  const img = useImageGeneration(user);
  const [sessions, setSessions] = useState([]);
  const [buttonCooldown, setButtonCooldown] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasConfirmedNoData, setHasConfirmedNoData] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);

  // Persist optimistic cards across refresh (per-user)
  const storageKey = useMemo(() => `sd3_optimistic_${user?.id || 'anon'}`, [user?.id]);
  const readOptimisticFromStorage = () => {
    try { const raw = sessionStorage.getItem(storageKey); return raw ? JSON.parse(raw) : []; } catch { return []; }
  };
  const writeOptimisticToStorage = (list) => { try { sessionStorage.setItem(storageKey, JSON.stringify(list || [])); } catch {} };
  const addOptimisticToStorage = (item) => {
    try { const list = readOptimisticFromStorage(); if (!list.some(x => x && x.clientKey === item.clientKey)) writeOptimisticToStorage([item, ...list].slice(0, 20)); } catch {}
  };
  const removeOptimisticFromStorage = (clientKey) => {
    try { const list = readOptimisticFromStorage(); writeOptimisticToStorage(list.filter(x => x && x.clientKey !== clientKey)); } catch {}
  };

  const fetchBusyRef = useRef(false);
  const fetchAndSetHistory = async (showLoading = true) => {
         if (!user) { 
       setSessions([]); 
       if (showLoading) setIsLoadingHistory(false);
       setHasConfirmedNoData(true);
       return; 
     }
    // Avoid overlapping fetches to reduce flicker
    if (fetchBusyRef.current && !showLoading) return;
    fetchBusyRef.current = true;
    if (showLoading) setIsLoadingHistory(true);
    // Hydrate optimistic from storage (before DB merge)
    try {
      const stored = readOptimisticFromStorage();
      if (stored && stored.length) {
        setSessions(prev => {
          const seen = new Set(prev.map(s => s.clientKey || s.session_id));
          const toAdd = stored.filter(s => s && !seen.has(s.clientKey));
          return toAdd.length ? [...toAdd, ...prev] : prev;
        });
      }
    } catch {}
     try {
       const res = await phFetch(`${img.API_BASE}/api/images/seedream3/history?limit=10&offset=0`);
       if (!res.ok) return;
       const data = await res.json();
       const rows = data.items || [];
      
      if (process.env.NODE_ENV === 'development') {
        console.log("📥 Fetched history rows:", rows.length);
        if (rows.length > 0) {
          console.log("📋 Sample row:", rows[0]);
        }
      }
      
      // Convert array format to the expected format
      const databaseSessions = rows.map(r => ({
        session_id: r.session_id,
        prompt: r.prompt,
        model: r.model,
        status: r.status,
        created_at: r.created_at,
        completed_at: r.completed_at,
        credit_cost: r.credit_cost || null,
        expectedOutputs: r.outputs || 1,
        aspectRatio: r.aspect_ratio || null,
        resolution: r.resolution || null,
        reservation_id: r.reservation_id,
        client_key: r.client_key || null,
        image_client_keys: Array.isArray(r.image_client_keys) ? r.image_client_keys : [],
        images: r.b2_urls || r.urls || [], // Use arrays from backend
        progress: []
      }));
      
      if (process.env.NODE_ENV === 'development') {
        console.log("🔄 Database sessions found:", databaseSessions.length);
        if (databaseSessions.length > 0) {
          console.log("📊 Sample session:", databaseSessions[0]);
        }
      }

        // Replace optimistic sessions with real data without reordering unchanged items
        setSessions(prev => {
        const merged = [];
        const processedRealSessionIds = new Set();

        // Process optimistic sessions first - replace them with real data when available
        prev.forEach(session => {
          if (session.isOptimistic) {
            if (process.env.NODE_ENV === 'development') {
              console.log("🔍 Processing optimistic session:", session.clientKey, "reservation_id:", session.reservation_id);
            }
            
            // Prefer clientKey matching (align with Seedream 4.0)
            let matchingRealSession = null;
            if (session.clientKey) {
              matchingRealSession = databaseSessions.find(dbSession => (dbSession.client_key === session.clientKey) || (Array.isArray(dbSession.image_client_keys) && dbSession.image_client_keys.includes(session.clientKey)));
              if (matchingRealSession && process.env.NODE_ENV === 'development') {
                console.log("✅ Found matching real session by clientKey:", session.clientKey, "→", matchingRealSession.session_id);
              }
            }
            // Fallback to reservation_id
            if (!matchingRealSession && session.reservation_id) {
              matchingRealSession = databaseSessions.find(dbSession => dbSession.reservation_id === session.reservation_id);
              if (matchingRealSession && process.env.NODE_ENV === 'development') {
                console.log("✅ Found matching real session by reservation_id:", session.reservation_id, "→", matchingRealSession.session_id);
              }
            }

            if (matchingRealSession) {
              if (process.env.NODE_ENV === 'development') {
                console.log("🔄 Replacing optimistic session with real data:", session.clientKey, "→", matchingRealSession.session_id, "reservation_id:", matchingRealSession.reservation_id);
              }
              // Use the real session data (which now includes aspect_ratio from database)
              merged.push({
                ...matchingRealSession,
                credit_cost: (matchingRealSession.credit_cost != null ? matchingRealSession.credit_cost : session.credit_cost),
                isOptimistic: false
              });
              processedRealSessionIds.add(matchingRealSession.session_id);
              try { if (session.clientKey) removeOptimisticFromStorage(session.clientKey); } catch {}
            } else {
              if (process.env.NODE_ENV === 'development') {
                console.log("⏳ Keeping optimistic session:", session.clientKey, "reservation_id:", session.reservation_id);
              }
              // Keep the optimistic session (either no real data yet, or no reservation_id for matching)
              merged.push(session);
            }
          }
        });

        // Add remaining real sessions that weren't processed above
        databaseSessions.forEach(dbSession => {
          if (!processedRealSessionIds.has(dbSession.session_id)) {
            merged.push({
              ...dbSession,
              // ensure credit_cost from DB is included
              credit_cost: dbSession.credit_cost || null
            });
          }
        });

        // Simple deduplication: remove duplicates based on session_id or reservation_id
        const seen = new Map();
        const deduplicatedSessions = [];
        
        for (const session of merged) {
          // Primary key: session_id if available
          let key = session.session_id;
          
          // Fallback: reservation_id for optimistic sessions
          if (!key) {
            key = session.reservation_id;
          }
          
          // Final fallback: composite key for sessions without either
          if (!key) {
            const promptHash = (session.prompt || 'unknown').slice(0, 20);
            const status = session.status || 'unknown';
            key = `${promptHash}-${session.created_at}-${status}`;
          }
          
          if (seen.has(key)) {
            // Keep the one with more complete data (prefer real session over optimistic)
            const existing = seen.get(key);
            if (session.session_id && !existing.session_id) {
              // Replace optimistic with real session
              const index = deduplicatedSessions.findIndex(s => {
                const sKey = s.session_id || s.reservation_id || 
                  `${(s.prompt || 'unknown').slice(0, 20)}-${s.created_at}-${s.status || 'unknown'}`;
                return sKey === key;
              });
              if (index >= 0) {
                deduplicatedSessions[index] = session;
                seen.set(key, session);
              }
            }
            // Otherwise keep existing
            continue;
          }
          
          seen.set(key, session);
          deduplicatedSessions.push(session);
        }
        
        // Sort by created_at desc (newest first)
        const finalSessions = deduplicatedSessions.sort((a, b) => 
          new Date(b.created_at) - new Date(a.created_at)
        );
        if (process.env.NODE_ENV === 'development') {
          console.log("🎯 Setting sessions:", finalSessions.length);
          if (finalSessions.length > 0) {
            console.log("📝 Final sessions:", finalSessions.map(s => ({ 
              id: s.session_id, 
              prompt: s.prompt?.substring(0, 30) + '...', 
              status: s.status,
              isOptimistic: s.isOptimistic 
            })));
          }
        }
                 return finalSessions;
       });
       setHasMore(data.pagination?.hasMore || false);
       setCurrentOffset(10);
       setHasConfirmedNoData(true);
     } catch (error) {
       console.error('Failed to load image history:', error);
       setHasConfirmedNoData(true);
    } finally {
      fetchBusyRef.current = false;
       if (showLoading) setIsLoadingHistory(false);
     }
  };

  // Get average estimate (global last 32) for countdowns
  const [avgEstimateMs, setAvgEstimateMs] = useState(10000);
  useEffect(() => {
    const loadEstimate = async () => {
      try {
        const url = new URL(`${img.API_BASE}/api/image/estimate`);
        if (img.outputs) url.searchParams.set('outputs', String(img.outputs));
        const res = await phFetch(url.toString());
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.averageMs === 'number' && data.averageMs > 0) setAvgEstimateMs(Math.round(data.averageMs));
      } catch {}
    };
    loadEstimate();
  }, [img.API_BASE, img.outputs]);

  useEffect(() => { fetchAndSetHistory(); }, [user?.id]);

   // Reset confirmation state when user changes
   useEffect(() => {
     setHasConfirmedNoData(false);
     setHasMore(false);
     setIsLoadingMore(false);
     setCurrentOffset(0);
   }, [user]);

  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => {
    const handler = () => setGuardVisible(true);
    window.addEventListener('seedream3-open-guard', handler);
    const requestHandler = async (e) => {
      const explicit = Number(e?.detail?.requiredCredits || 0);
      const need = explicit > 0 ? explicit : Number(img.priceCredits || 0);
      try {
        const res = await phFetch(`${img.API_BASE}/api/user/credits`, { cache: 'no-store' });
        if (!res.ok) { setGuardVisible(true); return; }
        const j = await res.json();
        const balance = Number(j?.credits || 0);
        if (balance <= 0 || (need > 0 && balance < need)) {
          setGuardVisible(true);
          try { await checkAuth?.(); } catch {}
        } else {
          await handleOptimisticGenerate();
        }
      } catch {
        setGuardVisible(true);
      }
    };
    window.addEventListener('seedream3-open-guard-request', requestHandler);
    return () => {
      window.removeEventListener('seedream3-open-guard', handler);
      window.removeEventListener('seedream3-open-guard-request', requestHandler);
    };
  }, [img.API_BASE, img.priceCredits]);
  // Only start polling when there is at least one real (non-optimistic) processing session with a real id
  const hasProcessing = useMemo(() => sessions.some(s => s.status === 'processing' && s.session_id && !s.isOptimistic), [sessions]);
  const lastImmediateRefreshRef = useRef(0);

  useEffect(() => {
    if (!hasProcessing) return;

    // Poll history less frequently without toggling skeleton
    const historyInterval = setInterval(() => fetchAndSetHistory(false), 5000);

    // Also poll per-session progress while processing (stable interval)
    const progressInterval = setInterval(async () => {
      try {
        const current = sessionsRef.current || [];
        const updates = await Promise.all(
          current
            .filter(s => s.status === 'processing' && s.session_id && !s.isOptimistic)
            .map(async (s) => {
              const res = await phFetch(`${img.API_BASE}/api/image/progress/${s.session_id}`);
              if (!res.ok) return { id: s.session_id, progress: [] };
              const data = await res.json();
              return { id: s.session_id, progress: Array.isArray(data.progress) ? data.progress : [] };
            })
        );
        if (updates.length === 0) return;
        let needsRefresh = false;
        let anyChanged = false;
        setSessions(prev => {
          const next = prev.map(s => {
            const u = updates.find(x => x.id === s.session_id);
            if (!u) return s;
            const expected = s.expectedOutputs || 1;
            const prevProg = Array.isArray(s.progress) ? s.progress : [];
            const nextProg = Array.isArray(u.progress) ? u.progress : [];
            const sameLen = prevProg.length === nextProg.length;
            const sameVals = sameLen && prevProg.every((v, i) => (v || 0) === ((nextProg[i] || 0)));
            if (!sameVals) anyChanged = true;
            const updated = sameVals ? s : { ...s, progress: nextProg };
            if (nextProg.length > 0) {
              const allDone = nextProg.slice(0, expected).every(p => (p || 0) >= 100);
              if (allDone && (updated.images?.length || 0) < expected) {
                needsRefresh = true;
              }
            }
            return updated;
          });
          // If nothing changed, return prev to avoid re-render flicker
          return anyChanged ? next : prev;
        });
        if (needsRefresh) {
          const now = Date.now();
          if (now - lastImmediateRefreshRef.current > 2000) {
            lastImmediateRefreshRef.current = now;
            // Fetch latest images immediately without skeleton
            fetchAndSetHistory(false);
          }
        }
      } catch {}
    }, 1000); // Reduced from 300ms to 1 second

    return () => {
      clearInterval(historyInterval);
      clearInterval(progressInterval);
    };
  }, [hasProcessing]);

  const handleOptimisticGenerate = async () => {
    // Avoid immediate checkAuth so optimistic available_credits persists until SSE
    if (process.env.NODE_ENV === 'development') {
      console.log("🔍 handleOptimisticGenerate called");
    }
    
    // Quick credit check before creating optimistic card
    let creditsSufficient = false;
    
    try {
      const creditsRes = await phFetch(`${img.API_BASE}/api/user/credits`);

      if (creditsRes.ok) {
        const creditsData = await creditsRes.json();
        const requiredCredits = img.outputs || 1;
        
        if (process.env.NODE_ENV === 'development') {
          console.log("💰 Credits check:", creditsData.credits, "vs required:", requiredCredits);
        }

        if (creditsData.credits >= requiredCredits) {
          creditsSufficient = true;
        } else {
          if (process.env.NODE_ENV === 'development') {
            console.log("❌ Insufficient credits - setting error and returning");
          }
          img.setError("Not enough credits");
          try { await checkAuth?.(); } catch {}
          setGuardVisible(true);
          return;
        }
                    } else {
         console.log("❌ Credit check failed with status:", creditsRes.status);
         img.setError("Unable to verify credits. Please try again later.");
         return;
       }
     } catch (error) {
      console.log("⚠️ Credit check failed:", error);
      // If credit check fails, show guard so user can sign in/buy credits
      img.setError("Unable to verify credits. Please try again later.");
      setGuardVisible(true);
       return;
     }
    
    if (!creditsSufficient) {
      if (process.env.NODE_ENV === 'development') {
      console.log("❌ Credits not sufficient - returning early");
    }
      return;
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log("✅ Credits sufficient - proceeding with generation");
    }

    // Create a unique identifier for this optimistic session
    const optimisticId = `temp-seedream3-${Date.now()}`;
    if (process.env.NODE_ENV === 'development') {
      console.log("🎴 Creating optimistic card with ID:", optimisticId);
    }

    // Compute final WxH used by Seedream 3.0 request for consistent placeholders
    const calcSeedream3Size = () => {
      const ratioStr = String(img.aspectRatio || '').trim();
      const m = ratioStr.match(/^(\d+)\s*[:/]\s*(\d+)$/);
      const maxDim = 1024; // Seedream 3.0 uses ~1024 long edge by default
      if (!m) return `${maxDim}x${maxDim}`;
      const wR = Math.max(1, parseInt(m[1], 10));
      const hR = Math.max(1, parseInt(m[2], 10));
      let width, height;
      if (wR >= hR) {
        width = maxDim;
        height = Math.round((maxDim * hR) / wR);
      } else {
        height = maxDim;
        width = Math.round((maxDim * wR) / hR);
      }
      const round64 = (n) => Math.max(64, Math.round(n / 64) * 64);
      width = round64(width);
      height = round64(height);
      return `${width}x${height}`;
    };

    // Optimistic card
    const optimistic = {
      prompt: img.prompt,
      images: [],
      expectedOutputs: img.outputs, // Track expected number of outputs
      credit_cost: (typeof img.priceCredits === 'number' ? img.priceCredits : null),
      aspectRatio: img.aspectRatio, // Store aspect ratio for UI
      created_at: new Date().toISOString(),
      completed_at: null,
      status: 'processing',
      model: img.model,
      session_id: optimisticId,
      clientKey: optimisticId,
      isOptimistic: true, // Mark as optimistic
      progress: Array(Math.max(1, img.outputs || 1)).fill(0),
      // Use request-sized WxH so placeholders match final results
      resolution: calcSeedream3Size()
    };

    if (process.env.NODE_ENV === 'development') {
      console.log("🎴 Adding optimistic card to sessions:", optimisticId);
    }
    setSessions(prev => {
      if (process.env.NODE_ENV === 'development') {
        console.log("📊 Previous sessions count:", prev.length);
      }
      const newSessions = [optimistic, ...prev];
      if (process.env.NODE_ENV === 'development') {
        console.log("📊 New sessions count:", newSessions.length);
        console.log("📋 All session IDs:", newSessions.map(s => s.session_id || s.clientKey));
      }
      return newSessions;
    });
    addOptimisticToStorage(optimistic);

    // Show "Starting…" with 0% until backend sets 10%

    // Add 300ms cooldown to prevent rapid clicking
    setButtonCooldown(true);
    setTimeout(() => {
      setButtonCooldown(false);
    }, 300); // Keep 300ms cooldown for button clicks

    try {
      const result = await img.generate({ clientKey: optimisticId });
      if (result && result.sessionId) {
        if (process.env.NODE_ENV === 'development') {
          console.log("🎯 Generation completed:", result.sessionId, "reservation_id:", result.reservation_id);
        }
        // Attach server sessionId and reservation_id so that progress polling can start once it exists
        setSessions(prev => prev.map(s => s.session_id === optimisticId ? { 
          ...s, 
          session_id: result.sessionId, 
          reservation_id: result.reservation_id,
          isOptimistic: false, 
          clientKey: s.clientKey || optimisticId 
        } : s));
        removeOptimisticFromStorage(optimisticId);
        // Credits now update via SSE; no additional polling needed
      }
      // Let the polling mechanism handle the updates instead of immediate fetch
      // This prevents the card from disappearing
    } catch (error) {
      // Remove optimistic card on error to avoid glitching on explicit-content failures
      setSessions(prev => prev.filter(s => s.session_id !== optimisticId));
      removeOptimisticFromStorage(optimisticId);
    }
  };

  const loadMoreImages = async () => {
    if (isLoadingMore || !hasMore) return;
    
    setIsLoadingMore(true);
    try {
      const res = await phFetch(`${img.API_BASE}/api/images/seedream3/history?limit=10&offset=${currentOffset}`);
      if (!res.ok) return;
      const data = await res.json();
      const rows = data.items || [];
      
      const grouped = {};
      rows
        .forEach(r => {
        const key = r.session_id || r.created_at;
        if (!grouped[key]) grouped[key] = {
          session_id: r.session_id,
          prompt: r.prompt,
          model: r.model,
          status: r.status,
          created_at: r.created_at,
          completed_at: r.completed_at,
          expectedOutputs: r.outputs || 1,
          aspectRatio: r.aspect_ratio || null,
          images: [],
          progress: []
        };
        const imgUrl = r.b2_url || r.url;
        if (imgUrl) grouped[key].images.push(imgUrl);
      });
      const newSessions = Object.values(grouped);
      
      // Append new images to existing ones
      setSessions(prev => {
        const optimisticCards = prev.filter(s => s.isOptimistic);
        const existingSessions = prev.filter(s => !s.isOptimistic);
        return [...optimisticCards, ...existingSessions, ...newSessions];
      });
      
      setHasMore(data.pagination?.hasMore || false);
      setCurrentOffset(prev => prev + 10);
    } catch (error) {
      console.error('Failed to load more images:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const authed = !!user;
  const allowGenerate = canGenerate({ isAuthenticated: authed, userCredits: user?.credits || 0, requiredCredits: img.priceCredits });
  const [guardVisible, setGuardVisible] = useState(false);

  return (
    <AppShell
      selectedTool="image"
      onSignInClick={() => {}}
      onSignUpClick={() => {}}
      onBuyCreditsClick={() => {}}
      mobilePromptNode={(
        <textarea
          className="w-full p-2 rounded bg-[#232326] text-white focus:outline-none focus:ring border border-white/10"
          rows={2}
          value={img.prompt}
          onChange={(e) => img.setPrompt(e.target.value)}
          placeholder="Describe your image..."
        />
      )}
      onMobileGenerate={async () => {
        if (!user) {
          window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
          return;
        }
        // Check credits before generating
        try {
          const res = await fetch(`${img.API_BASE}/api/user/credits`, { credentials: 'include', cache: 'no-store' });
          if (!res.ok) {
            window.location.href = `/billing?returnTo=${encodeURIComponent(window.location.pathname)}`;
            return;
          }
          const data = await res.json();
          const balance = Number(data?.credits || 0);
          const required = img.outputs || 1;
          if (balance < required) {
            window.location.href = `/billing?returnTo=${encodeURIComponent(window.location.pathname)}`;
            return;
          }
          img.generate();
        } catch {
          window.location.href = `/billing?returnTo=${encodeURIComponent(window.location.pathname)}`;
        }
      }}
      mobileGenerateDisabled={!img.prompt.trim()}
        mobileCreditAmount={img.priceCredits}
      mobileSettingsContent={(
        <SeedreamPanel
          prompt={img.prompt}
          setPrompt={img.setPrompt}
          model={img.model}
          setModel={img.setModel}
          outputs={img.outputs}
          setOutputs={img.setOutputs}
          aspectRatio={img.aspectRatio}
          setAspectRatio={img.setAspectRatio}
          loading={img.loading}
          error={img.error}
          onGenerate={handleOptimisticGenerate}
          submittingCount={0}
          buttonCooldown={buttonCooldown}
          priceCredits={img.priceCredits}
          priceLoading={img.priceLoading}
          priceError={img.priceError}
        />
      )}
      childrenLeft={(
        <SeedreamPanel
          prompt={img.prompt}
          setPrompt={img.setPrompt}
          model={img.model}
          setModel={img.setModel}
          outputs={img.outputs}
          setOutputs={img.setOutputs}
          aspectRatio={img.aspectRatio}
          setAspectRatio={img.setAspectRatio}
          loading={img.loading}
          error={img.error}
          onGenerate={handleOptimisticGenerate}
          submittingCount={0}
          buttonCooldown={buttonCooldown}
          priceCredits={img.priceCredits}
          priceLoading={img.priceLoading}
          priceError={img.priceError}
          canGenerate={allowGenerate}
        />
      )}
      childrenMain={(
        <>
          <div className="sticky top-0 z-10 -mx-6 px-6 pt-6 mb-4 bg-[#0a0a0a]">
            <h1 className="text-xl font-bold border-b border-white/10 pb-2">Generated Images</h1>
          </div>
          <div className="space-y-6 relative">
            {/* GenerationGuard removed per request */}
            {isLoadingHistory ? (
              // Loading skeleton
              <div className="space-y-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-[#18181b] rounded-lg p-6 animate-pulse">
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-24 bg-white/10 rounded-full"></div>
                      </div>
                      <div className="h-6 w-20 bg-white/10 rounded-full"></div>
                    </div>
                    <div className="mb-3">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-16 bg-white/10 rounded-full"></div>
                        <div className="h-4 flex-1 bg-white/10 rounded"></div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[1, 2, 3].map((j) => (
                        <div key={j} className="aspect-square bg-white/5 rounded-lg"></div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (!isLoadingHistory && sessions.length === 0) ? (
              <div className="text-center py-12">
                <p className="text-gray-400">No images generated yet. Create your first image using the controls on the left!</p>
              </div>
             ) : sessions.length > 0 ? (
              sessions.map((session, index) => (
                <ImageHistoryCard 
                  key={`${session.clientKey || session.session_id || session.created_at}-${index}`} 
                  session={session} 
                  API_BASE={img.API_BASE} 
                  onReusePrompt={(prompt, session) => {
                    if (session) {
                      // Reuse all parameters from the session
                      img.setPrompt(prompt);
                      img.setModel(session.model || 'seedream-3-0-t2i-250415');
                      // Ensure non-null select value; derive from stored AR or resolution WxH
                      try {
                        let nextAR = session.aspect_ratio || session.aspectRatio || '';
                        if (!nextAR) {
                          const res = String(session.resolution || '').toLowerCase();
                          const m = res.match(/^(\d+)x(\d+)$/);
                          if (m) {
                            const w = parseInt(m[1], 10) || 0;
                            const h = parseInt(m[2], 10) || 0;
                            if (w > 0 && h > 0) {
                              const gcd = (a,b)=> b===0?a:gcd(b,a%b);
                              const g = gcd(w,h);
                              nextAR = `${Math.round(w/g)}:${Math.round(h/g)}`;
                            }
                          }
                        }
                        img.setAspectRatio(nextAR || '1:1');
                      } catch { img.setAspectRatio('1:1'); }
                      img.setOutputs(Number(session.expectedOutputs || session.outputs || 1));
                    } else {
                      // Fallback to just prompt
                      img.setPrompt(prompt);
                    }
                  }} 
                  estimateMs={avgEstimateMs} 
                                 />
               ))
             ) : null}
             
             {/* Load More Button */}
             {hasMore && sessions.length > 0 && (
               <div className="flex justify-center pt-4">
                 <button
                   onClick={loadMoreImages}
                   disabled={isLoadingMore}
                   className="px-6 py-2 bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                 >
                   {isLoadingMore ? (
                     <div className="flex items-center gap-2">
                       <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                       Loading...
                     </div>
                   ) : (
                     'Load More Images'
                   )}
                 </button>
               </div>
             )}
          </div>
        </>
      )}
    >
      <Suspense fallback={null}>
        <SeedreamTemplateApplier img={img} />
      </Suspense>
    </AppShell>
  );
}

// Removed duplicate default export


