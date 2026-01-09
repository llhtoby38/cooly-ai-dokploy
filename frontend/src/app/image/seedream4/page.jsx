"use client";
import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "../../components/AppShell";
import Seedream4Panel from "../../components/Seedream4Panel";
import GenerationGuard, { canGenerate } from "../../components/GenerationGuard";
import { useAuth } from "../../contexts/AuthContext";
import { useSeedream4Generation } from "../../hooks/useSeedream4Generation";
import ImageHistoryCard from "../../components/history/ImageHistoryCard";
import phFetch from "../../services/phFetch";

function Seedream4TemplateApplier({ img, appliedTemplatesRef }) {
  const searchParams = useSearchParams();
  
  useEffect(() => {
    const slug = String(searchParams?.get('template') || '').toLowerCase();
    console.log('🔍 [TemplateApplier] Effect running, slug:', slug);
    
    if (!slug) {
      console.log('⏭️  [TemplateApplier] No slug, skipping');
      return;
    }
    
    // Check if this template was already applied (survives component unmount/remount)
    if (appliedTemplatesRef.current.has(slug)) {
      console.log('✅ [TemplateApplier] Template already applied, skipping:', slug);
      return;
    }
    
    console.log('📥 [TemplateApplier] Fetching template:', slug);
    const run = async () => {
      try {
        const res = await phFetch(`${img.API_BASE}/api/templates/seedream4/${encodeURIComponent(slug)}`, { cache: 'no-store' });
        if (!res.ok) {
          console.log('❌ [TemplateApplier] Fetch failed:', res.status);
          return;
        }
        const t = await res.json();
        console.log('📦 [TemplateApplier] Template data received:', t);
        if (t && t.settings) {
          console.log('✨ [TemplateApplier] Applying template with', Object.keys(t.settings).length, 'settings');
          img.applyTemplate?.(t.settings, { lockResolution: true });
          appliedTemplatesRef.current.add(slug);
          console.log('✅ [TemplateApplier] Template marked as applied');
        }
      } catch (e) {
        console.error('❌ [TemplateApplier] Error:', e);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, appliedTemplatesRef]);
  return null;
}

export default function Seedream4Page() {
  const { user, checkAuth, logout } = useAuth();
  const img = useSeedream4Generation(user);
  const appliedTemplatesRef = useRef(new Set());
  const imageSyncRef = useRef({ lastSynced: null, lastSyncedUrls: '' });
  const DEFAULT_PAGE_SIZE = 10;
  const MAX_PAGE_SIZE = 100;
  const [sessions, setSessions] = useState([]);
  const [buttonCooldown, setButtonCooldown] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasConfirmedNoData, setHasConfirmedNoData] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);
  const isFetchingRef = useRef(false);

  // Template application moved into Suspense-wrapped child

  const fetchAndSetHistory = async (showLoading = true) => {
    // Prevent concurrent calls
    if (isFetchingRef.current) {
      console.log("⏭️ Already fetching, skipping concurrent call");
      return;
    }
    isFetchingRef.current = true;
    console.log(`🔍 Starting fetchAndSetHistory (showLoading: ${showLoading})`);
    console.log(`🔍 Current sessions count: ${sessions?.length || 0}`);
    
    if (!user) { 
      setSessions([]); 
      if (showLoading) setIsLoadingHistory(false);
      setHasConfirmedNoData(true);
      isFetchingRef.current = false;
      return; 
    }
    if (showLoading) setIsLoadingHistory(true);
    try {
      const existingCount = Array.isArray(sessions) ? sessions.length : 0;
      const dynamicLimitBase = Math.max(DEFAULT_PAGE_SIZE, existingCount);
      const normalizedLimit = Math.min(MAX_PAGE_SIZE, Math.ceil(dynamicLimitBase / DEFAULT_PAGE_SIZE) * DEFAULT_PAGE_SIZE);
      const res = await phFetch(`${img.API_BASE}/api/images/seedream4/history?limit=${normalizedLimit}&offset=0`);
      if (!res.ok) return;
      const data = await res.json();
      const rows = data.items || [];
     
        console.log("📥 Fetched Seedream 4.0 history rows:", rows.length);
        console.log("📥 Sample row with client_key info:", rows.slice(0, 2).map(r => ({
          session_id: r.session_id,
          client_key: r.client_key || 'NULL',
          image_client_key: r.image_client_key || 'NULL',
          prompt: r.prompt?.slice(0, 20),
          url: r.url ? 'has_url' : 'no_url'
        })));
        
        // Check if any rows have client_key values
        const hasClientKeys = rows.some(r => r.client_key || r.image_client_key);
        console.log(`🔍 Database has client_key values: ${hasClientKeys ? 'YES' : 'NO'}`);
        if (!hasClientKeys) {
          console.log('⚠️ All existing sessions have NULL client_key - only NEW generations will work properly');
        } else {
          // Count sessions with client_key
          const sessionsWithClientKey = rows.filter(r => r.client_key).length;
          const imagesWithClientKey = rows.filter(r => r.image_client_key).length;
          console.log(`✅ Found ${sessionsWithClientKey} sessions with client_key, ${imagesWithClientKey} images with client_key`);
        }
      
      const grouped = {};
      rows.forEach(r => {
        const key = r.session_id || r.created_at;
        if (!grouped[key]) {
          grouped[key] = {
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
            ref_image_url: r.ref_image_url || null,
            ref_image_urls: r.ref_image_urls || null,
            input_settings: r.input_settings || null,
            client_key: r.client_key || null, // Add client_key from session
            error_details: r.error_details || null,
            images: [],
            progress: []
          };
        }
        const imgUrl = r.b2_url || r.url;
        if (imgUrl) {
          // Store image as object with URL and client_key for proper matching
          grouped[key].images.push({
            url: imgUrl,
            image_client_key: r.image_client_key || null
          });
        }
      });
      const databaseSessions = Object.values(grouped);
      
      console.log("🗂️ Final grouped sessions:", databaseSessions.map(s => ({
        session_id: s.session_id,
        prompt: s.prompt?.slice(0, 30) + "...",
        images_count: s.images.length,
        status: s.status
      })));

      // Position-preserving merge with optimistic replacement to avoid duplicates/flicker
      setSessions(prev => {
        console.log("🔄 Merge: Previous:", prev.length, "DB:", databaseSessions.length);
        console.log("🔄 Previous sessions:", prev.map(s => ({ 
          session_id: s.session_id, 
          clientKey: s.clientKey, 
          isOptimistic: s.isOptimistic, 
          status: s.status,
          prompt: s.prompt?.slice(0, 20) 
        })));
        console.log("🔄 DB sessions:", databaseSessions.map(s => ({ 
          session_id: s.session_id, 
          client_key: s.client_key, 
          status: s.status,
          prompt: s.prompt?.slice(0, 20) 
        })));
        
        // Early return if no database sessions and no previous sessions
        if (databaseSessions.length === 0 && prev.length === 0) {
          return [];
        }
        
        const byPrevKey = new Map();
        // Use clientKey for optimistic sessions, session_id for completed sessions
        prev.forEach(s => {
          const key = s.isOptimistic ? s.clientKey : (s.session_id || s.clientKey || s.created_at);
          byPrevKey.set(key, s);
        });

        const arraysEqual = (a, b) => {
          if (a === b) return true;
          const aa = Array.isArray(a) ? a : [];
          const bb = Array.isArray(b) ? b : [];
          if (aa.length !== bb.length) return false;
          for (let i = 0; i < aa.length; i++) {
            // Handle image objects vs URLs
            const aItem = typeof aa[i] === 'object' ? aa[i].url : aa[i];
            const bItem = typeof bb[i] === 'object' ? bb[i].url : bb[i];
            if (aItem !== bItem) return false;
          }
          return true;
        };

        const shallowEqualCore = (x, y) => {
          if (x === y) return true;
          const fields = ['session_id','status','prompt','model','aspectRatio','resolution','created_at','completed_at','expectedOutputs','error_details'];
          for (const f of fields) {
            if ((x[f] || null) !== (y[f] || null)) return false;
          }
          if (!arraysEqual(x.images, y.images)) return false;
          if (!arraysEqual(x.progress, y.progress)) return false;
          return true;
        };

        const dbById = new Map(databaseSessions.map(s => [s.session_id, s]));
        // Also create a map by clientKey for optimistic session matching
        const dbByClientKey = new Map();
        databaseSessions.forEach(s => {
          // Prefer session-level client_key, otherwise search all images for first non-null image_client_key
          const sessionClientKey = s.client_key;
          let firstImageClientKey = null;
          if (Array.isArray(s.images)) {
            for (let i = 0; i < s.images.length; i++) {
              const im = s.images[i];
              if (im && typeof im === 'object' && im.image_client_key) {
                firstImageClientKey = im.image_client_key;
                break;
              }
            }
          }
          const clientKey = sessionClientKey || firstImageClientKey;
          
          if (clientKey) {
            dbByClientKey.set(clientKey, s);
            console.log(`🔑 DB session ${s.session_id} mapped to clientKey: ${clientKey} (session: ${sessionClientKey}, image_first: ${firstImageClientKey})`);
          } else {
            console.log(`❌ DB session ${s.session_id} has NO clientKey (session: ${sessionClientKey}, image_first: ${firstImageClientKey})`);
          }
        });
        
        console.log(`📊 Total DB sessions: ${databaseSessions.length}, Sessions with clientKey: ${dbByClientKey.size}`);
        const processedDbIds = new Set();

        // Build next by iterating previous order and merging/replacing in place
        const next = prev.map(old => {
          // If already real and present in DB by id, merge
          if (old.session_id && dbById.has(old.session_id)) {
            const db = dbById.get(old.session_id);
            processedDbIds.add(old.session_id);
            console.log(`🔄 Merging existing session ${old.session_id} (clientKey: ${old.clientKey}): ${old.images?.length || 0} → ${db.images?.length || 0} images`);
            
            // Always prioritize database data as the source of truth
            const merged = {
              ...old,
              ...db,
              credit_cost: (db.credit_cost != null ? db.credit_cost : old.credit_cost),
              // Preserve optimistic aspect ratio if DB hasn't populated it yet
              aspectRatio: db.aspect_ratio || old.aspectRatio || null,
              clientKey: old.clientKey || db.client_key,
              isOptimistic: false,
              // CRITICAL: Always use DB images if they exist, regardless of old session state
              images: db.images || old.images || [],
              // Preserve ref images if backend temporarily omits them
              ref_image_url: db.ref_image_url || old.ref_image_url || null,
              ref_image_urls: (db.ref_image_urls && db.ref_image_urls.length ? db.ref_image_urls : (old.ref_image_urls || null)),
              // Use DB status if available, otherwise keep old status
              status: db.status || old.status,
              // Use DB completion time if available
              completed_at: db.completed_at || old.completed_at,
              progress: old.progress
            };
            
            return shallowEqualCore(old, merged) ? old : merged;
          }

          // If optimistic, try to find a matching real DB session by clientKey first
          if (old.isOptimistic) {
            console.log(`🔍 [OPTIMISTIC] Looking for match for session ${old.session_id} with clientKey: ${old.clientKey}`);
            
            // First try to match by clientKey (most reliable)
            let match = old.clientKey ? dbByClientKey.get(old.clientKey) : null;
            
            if (match) {
              console.log(`✅ [OPTIMISTIC] Found clientKey match: ${old.clientKey} -> DB session ${match.session_id} with ${match.images?.length || 0} images`);
              // Mark this DB session as processed
              processedDbIds.add(match.session_id);
              
              // CRITICAL: Always prioritize database data as the source of truth
              const replaced = {
                ...old,
                ...match,
                clientKey: old.clientKey || match.client_key, // Preserve original clientKey
                isOptimistic: false,
                // Always use DB images if they exist, as they are the source of truth
                images: match.images || old.images || [],
                // Use DB status if available
                status: match.status || old.status,
                // Use DB completion time if available
                completed_at: match.completed_at || old.completed_at,
                progress: old.progress
              };
              
              console.log(`✅ [OPTIMISTIC] Replaced optimistic session ${old.clientKey} with DB session ${replaced.session_id} (${replaced.images?.length || 0} images)`);
              return replaced;
            } else {
              console.log(`❌ [OPTIMISTIC] No clientKey match found for: ${old.clientKey} - keeping optimistic session`);
              // Keep the optimistic session - it might match in the next fetch
              return old;
            }
          }

          // No matching DB entry; keep old reference
          console.log(`➡️ Keeping existing session ${old.session_id || old.clientKey} as-is`);
          return old;
        });

        // Append any brand-new DB sessions not matched/processed
        console.log(`\n📦 [APPEND] Checking for unprocessed DB sessions...`);
        for (const db of databaseSessions) {
          if (processedDbIds.has(db.session_id)) {
            console.log(`⏭️ [APPEND] Skipping already processed DB session ${db.session_id}`);
            continue;
          }
          
          console.log(`✅ [APPEND] Adding new DB session ${db.session_id} (clientKey: ${db.client_key}, ${db.images?.length || 0} images, prompt: "${db.prompt?.slice(0, 30)}...")`);
          next.push({ ...db, clientKey: db.client_key, isOptimistic: false });
        }
        
        console.log(`\n🔄 [DEDUP] Starting deduplication with ${next.length} sessions in next array`);
        console.log(`🔄 [DEDUP] Sessions breakdown:`, {
          total: next.length,
          optimistic: next.filter(s => s.isOptimistic).length,
          real: next.filter(s => !s.isOptimistic).length
        });

        // Enhanced deduplication: prioritize completed sessions over optimistic ones
        const seenIds = new Set(); // session_id
        const seenClientKeys = new Set(); // clientKey
        const finalList = [];
        
        // First pass: add all completed/real sessions
        console.log(`\n🔄 [DEDUP-PASS1] Adding real sessions...`);
        for (const s of next) {
          // Ensure all sessions with session_id are marked as non-optimistic
          if (s.session_id && s.isOptimistic !== false) {
            console.warn(`⚠️ [DEDUP-PASS1] Fixing session ${s.session_id} - has session_id but isOptimistic=${s.isOptimistic}`);
            s.isOptimistic = false;
          }
          
          if (!s.isOptimistic && s.session_id) {
            const idKey = s.session_id;
            const ck = s.clientKey || null;
            if (!seenIds.has(idKey) && (!ck || !seenClientKeys.has(ck))) {
              seenIds.add(idKey);
              if (ck) seenClientKeys.add(ck);
              finalList.push(s);
              console.log(`✅ [DEDUP-PASS1] Added real session ${idKey} (clientKey: ${ck}, ${s.images?.length || 0} images, prompt: "${s.prompt?.slice(0, 30)}...")`);
            } else {
              console.log(`🚫 [DEDUP-PASS1] Skipped duplicate real session ${idKey} (clientKey collision: ${ck || 'none'})`);
            }
          }
        }
        
        // Second pass: add optimistic sessions only if not already seen by clientKey
        console.log(`\n🔄 [DEDUP-PASS2] Adding optimistic sessions...`);
        for (const s of next) {
          if (s.isOptimistic) {
            const key = s.clientKey || `${s.prompt}-${s.created_at}`;
            
            // Only add if we don't already have a real session with same clientKey
            if (s.clientKey && seenClientKeys.has(s.clientKey)) {
              console.log(`🚫 [DEDUP-PASS2] Skipped optimistic ${s.clientKey} - real with same clientKey already present`);
            } else if (!s.clientKey && seenIds.size > 0) {
              // If no clientKey, rely on composite key fallback
              finalList.push(s);
              console.log(`✅ [DEDUP-PASS2] Added optimistic session (no clientKey) (prompt: "${s.prompt?.slice(0, 30)}...")`);
            } else {
              // Track added optimistic by clientKey to avoid duplicates among optimistics
              if (s.clientKey && !seenClientKeys.has(s.clientKey)) {
                seenClientKeys.add(s.clientKey);
                finalList.push(s);
                console.log(`✅ [DEDUP-PASS2] Added optimistic session ${s.clientKey} (prompt: "${s.prompt?.slice(0, 30)}...")`);
              } else {
                console.log(`🚫 [DEDUP-PASS2] Skipped duplicate optimistic session ${s.clientKey}`);
              }
            }
          }
        }
        
        console.log(`\n✅ [DEDUP] Final result: ${finalList.length} sessions (${finalList.filter(s => !s.isOptimistic).length} real, ${finalList.filter(s => s.isOptimistic).length} optimistic)`);
        
        // Sort final list by creation time (most recent first) to maintain proper order
        finalList.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        
        console.log("✅ Final result:", finalList.length, "sessions");
        
        // Debug: Check for any sessions with the same prompt that might be split
        const hasOptimisticInFinal = finalList.some(s => s.isOptimistic);
        if (hasOptimisticInFinal) {
          console.log(`\n🔍 [SPLIT-CHECK] Checking for split sessions (optimistic present)...`);
          const promptGroups = {};
          finalList.forEach(session => {
            if (session.prompt) {
              const key = session.prompt;
              if (!promptGroups[key]) promptGroups[key] = [];
              promptGroups[key].push(session);
            }
          });
          Object.entries(promptGroups).forEach(([prompt, sessions]) => {
            if (sessions.length > 1) {
              console.warn(`\n⚠️ [SPLIT DETECTED] ${sessions.length} sessions with same prompt: "${prompt.slice(0, 40)}..."`);
              sessions.forEach((s, idx) => {
                console.warn(`   ${idx + 1}. session_id: ${s.session_id || 'NONE'} | clientKey: ${s.clientKey || 'NONE'} | optimistic: ${s.isOptimistic} | images: ${s.images?.length || 0} | created: ${s.created_at}`);
              });
            }
          });
        }
        
        // Check if the final result is actually different from the previous state
        // to prevent unnecessary re-renders
        if (prev.length === finalList.length) {
          const isEqual = prev.every((prevSession, index) => {
            const finalSession = finalList[index];
            if (!finalSession) return false;
            
            // Compare key properties
            return prevSession.session_id === finalSession.session_id &&
                   prevSession.status === finalSession.status &&
                   prevSession.isOptimistic === finalSession.isOptimistic &&
                   prevSession.clientKey === finalSession.clientKey &&
                   prevSession.created_at === finalSession.created_at &&
                   JSON.stringify(prevSession.images) === JSON.stringify(finalSession.images);
          });
          
          if (isEqual) {
            return prev;
          }
        }
        
        return finalList;
      });
      setHasMore(data.pagination?.hasMore || false);
      setCurrentOffset(normalizedLimit);
      setHasConfirmedNoData(true);
    } catch (error) {
      console.error('Failed to load Seedream 4.0 history:', error);
      setHasConfirmedNoData(true);
    } finally {
      if (showLoading) setIsLoadingHistory(false);
      isFetchingRef.current = false;
    }
  };

  // Get average estimate (global last 32) for countdowns
  const [avgEstimateMs, setAvgEstimateMs] = useState(10000);
  useEffect(() => {
    const loadEstimate = async () => {
      try {
        const url = new URL(`${img.API_BASE}/api/images/seedream4/estimate`);
        if (img.outputs) url.searchParams.set('outputs', String(img.outputs));
        const res = await phFetch(url.toString());
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.averageMs === 'number' && data.averageMs > 0) setAvgEstimateMs(Math.round(data.averageMs));
      } catch {}
    };
    loadEstimate();
  }, [img.API_BASE, img.outputs]);

  useEffect(() => { 
    // Add a small delay to prevent rapid successive calls
    const timeoutId = setTimeout(() => {
      fetchAndSetHistory(); 
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, [user]);

  // Reset confirmation state when user changes
  useEffect(() => {
    setHasConfirmedNoData(false);
    setHasMore(false);
    setIsLoadingMore(false);
    setCurrentOffset(0);
  }, [user]);

  // SSE event handling for real-time updates
  useEffect(() => {
    if (!user) return;

    // Throttle SSE-triggered fetches to prevent race conditions
    let sseFetchTimeout = null;
    const throttledFetch = () => {
      if (sseFetchTimeout) return; // Already scheduled
      sseFetchTimeout = setTimeout(() => {
        sseFetchTimeout = null;
        fetchAndSetHistory(false);
      }, 100); // 100ms throttle
    };

    const handleSessionCreated = (event) => {
      const data = event.detail;
      if (process.env.NODE_ENV === 'development') {
        console.log("🎯 Seedream 4.0 SSE session_created received:", data);
        console.log("📊 Current sessions count before throttledFetch:", sessions.length);
      }
      throttledFetch();
    };

    const handleSessionCompleted = (event) => {
      const data = event.detail;
      if (process.env.NODE_ENV === 'development') {
        console.log("🎯 Seedream 4.0 SSE session_completed received:", data);
        console.log("📊 Current sessions count before throttledFetch:", sessions.length);
      }
      throttledFetch();
    };

    const handleImagesAttached = (event) => {
      const data = event.detail;
      if (process.env.NODE_ENV === 'development') {
        console.log("🎯 Seedream 4.0 SSE images_attached received:", data);
        console.log("📊 Current sessions count before throttledFetch:", sessions.length);
      }
      throttledFetch();
    };

    // Listen for SSE events
    window.addEventListener('session_created', handleSessionCreated);
    window.addEventListener('session_completed', handleSessionCompleted);
    window.addEventListener('images_attached', handleImagesAttached);

    return () => {
      if (sseFetchTimeout) {
        clearTimeout(sseFetchTimeout);
        sseFetchTimeout = null;
      }
      window.removeEventListener('session_created', handleSessionCreated);
      window.removeEventListener('session_completed', handleSessionCompleted);
      window.removeEventListener('images_attached', handleImagesAttached);
    };
  }, [user]);

  // Track latest sessions for stable intervals
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => {
    const handler = () => setGuardVisible(true);
    window.addEventListener('seedream4-open-guard', handler);
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
          // also surface inline error for immediate user feedback
          img.setError && img.setError('Not enough credits');
        } else {
          // enough credits: proceed if generate was blocked by the panel
          await handleOptimisticGenerate();
        }
      } catch {
        setGuardVisible(true);
      }
    };
    window.addEventListener('seedream4-open-guard-request', requestHandler);
    return () => {
      window.removeEventListener('seedream4-open-guard', handler);
      window.removeEventListener('seedream4-open-guard-request', requestHandler);
    };
  }, [img.API_BASE, img.priceCredits]);

  const hasProcessing = useMemo(() => sessions.some(s => s.status === 'processing'), [sessions]);
  const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const PROGRESS_TTL_MS = 30 * 60 * 1000; // 30 minutes
  const lastImmediateRefreshRef = useRef(0);
  const sseConnectedRef = useRef(false);
  const fallbackTimerRef = useRef(null);

  useEffect(() => {
    if (!hasProcessing) return;

    // Very light safety refresh; terminal events from SSE will fetch immediately
    const historyInterval = setInterval(() => fetchAndSetHistory(false), 30000);

    // SSE stream
    let es;
    let backoffMs = 3000; // start 3s, exponential backoff up to 30s
    const MAX_BACKOFF = 30000;
    const STARTUP_GRACE_MS = 3000;

    const startFallback = () => {
      if (fallbackTimerRef.current) return; // already scheduled
      const poll = async () => {
        try {
          const current = sessionsRef.current || [];
          const updates = await Promise.all(
            current
              .filter(s => {
                if (s.status !== 'processing' || s.isOptimistic) return false;
                if (!s.session_id || !UUID_V4_RE.test(String(s.session_id))) return false;
                if (s.created_at) {
                  const age = Date.now() - new Date(s.created_at).getTime();
                  if (age > PROGRESS_TTL_MS) return false;
                }
                return true;
              })
              .map(async (s) => {
                const res = await phFetch(`${img.API_BASE}/api/images/seedream4/progress/id/${s.session_id}`);
                if (!res.ok) return { id: s.session_id, progress: [] };
                const data = await res.json();
                return { id: s.session_id, progress: Array.isArray(data.progress) ? data.progress : [] };
              })
          );
          if (updates.length > 0) {
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
              return anyChanged ? next : prev;
            });
            if (needsRefresh) {
              const now = Date.now();
              if (now - lastImmediateRefreshRef.current > 2000) {
                lastImmediateRefreshRef.current = now;
                fetchAndSetHistory(false);
              }
            }
          }
          // success: keep backoff stable
        } catch {
          backoffMs = Math.min(MAX_BACKOFF, backoffMs * 2);
        } finally {
          if (!sseConnectedRef.current && hasProcessing) {
            fallbackTimerRef.current = setTimeout(poll, backoffMs);
          } else {
            if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
          }
        }
      };
      // schedule first run
      fallbackTimerRef.current = setTimeout(poll, backoffMs);
    };

    try {
      const url = new URL(`${img.API_BASE}/api/images/seedream4/progress/stream`);
      es = new EventSource(url.toString(), { withCredentials: true });
      es.addEventListener('open', () => {
        sseConnectedRef.current = true;
        if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
        backoffMs = 3000; // reset on success
      });
      es.addEventListener('progress', (e) => {
        try {
          const { sessionId, progress } = JSON.parse(e.data || '{}');
          if (!sessionId || !Array.isArray(progress)) return;
          setSessions(prev => prev.map(s => (s.session_id === sessionId ? { ...s, progress } : s)));
        } catch {}
      });
      es.addEventListener('failed', (e) => {
        try {
          const { sessionId, error_details: errorDetails } = JSON.parse(e.data || '{}');
          if (!sessionId) return;
          // Debounce transient failure flashes: wait briefly to see if 'done' arrives
          setTimeout(() => {
            setSessions(prev => prev.map((s) => {
              if (s.session_id !== sessionId || s.status === 'completed') return s;
              return {
                ...s,
                status: 'failed',
                error_details: errorDetails ?? s.error_details ?? null
              };
            }));
          }, 800);
        } catch {}
      });
      es.addEventListener('done', (e) => {
        try {
          const { sessionId } = JSON.parse(e.data || '{}');
          if (!sessionId) return;
          setSessions(prev => prev.map(s => (s.session_id === sessionId ? { ...s, status: 'completed' } : s)));
          fetchAndSetHistory(false);
        } catch {}
      });
      es.addEventListener('error', () => {
        sseConnectedRef.current = false;
        if (!fallbackTimerRef.current) startFallback();
      });
      // If SSE fails to connect quickly, start fallback
      setTimeout(() => {
        if (!sseConnectedRef.current && !fallbackTimerRef.current) startFallback();
      }, STARTUP_GRACE_MS);
    } catch {
      // If EventSource construction fails, start fallback immediately
      startFallback();
    }

    return () => {
      clearInterval(historyInterval);
      if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
      try { es && es.close(); } catch {}
    };
  }, [hasProcessing]);

  const handleOptimisticGenerate = async () => {
    // Skip immediate checkAuth to avoid overriding optimistic available_credits; SSE will update
    
    // Quick credit check before creating optimistic card
    let creditsSufficient = false;
    
    try {
      const creditsRes = await phFetch(`${img.API_BASE}/api/user/credits`);

      if (creditsRes.ok) {
        const creditsData = await creditsRes.json();
        const requiredCredits = (typeof img.priceCredits === 'number' && img.priceCredits > 0)
          ? img.priceCredits
          : (img.outputs || 1);
        
        if (creditsData.credits >= requiredCredits) {
          creditsSufficient = true;
        } else {
          img.setError("Not enough credits");
          try { await checkAuth?.(); } catch {}
          setGuardVisible(true);
          return;
        }
      } else {
        img.setError("Unable to verify credits. Please try again later.");
        setGuardVisible(true);
        return;
      }
    } catch (error) {
      img.setError("Unable to verify credits. Please try again later.");
      setGuardVisible(true);
      return;
    }
    
    if (!creditsSufficient) {
      return;
    }

    // Create a unique identifier for this optimistic session
    const optimisticId = `temp-seedream4-${Date.now()}`;

    // Optimistic card
    // Compute optimistic aspect ratio from current UI state
    const computeAspect = () => {
      if (img.aspectRatio && img.aspectRatio !== 'match_input') return img.aspectRatio;
      const s = String(img.size || '').toLowerCase();
      if (/^\d+x\d+$/i.test(s)) {
        const [w, h] = s.split('x').map(n => parseInt(n, 10) || 0);
        if (w > 0 && h > 0) {
          const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
          const g = gcd(w, h);
          return `${Math.round(w / g)}:${Math.round(h / g)}`;
        }
      }
      return null;
    };

    // Compute final size for placeholders based on current UI
    const computeOptimisticFinalSize = () => {
      const token = String(img.size || '').toUpperCase();
      const explicit = String(img.computedSize || '').toLowerCase();
      if (/^\d{2,5}x\d{2,5}$/i.test(explicit)) return explicit;
      const arStr = (img.aspectRatio === 'match_input')
        ? (img.refImageAspectRatio || '')
        : (img.aspectRatio || '');
      const m = arStr.match(/^(\d+)\s*[:/]\s*(\d+)$/);
      if (!m) return '';
      const aw = Math.max(1, parseInt(m[1], 10));
      const ah = Math.max(1, parseInt(m[2], 10));
      // simplify
      const gcd = (a,b)=> b===0?a:gcd(b,a%b);
      const g = gcd(aw, ah);
      const sw = Math.round(aw / g);
      const sh = Math.round(ah / g);
      const key = `${sw}:${sh}`;
      const PRESETS = {
        '1:1': { '1K': '1280x1280', '2K': '1920x1920', '4K': '3840x3840' },
        '16:9': { '1K': '1280x720', '2K': '1920x1080', '4K': '3840x2160' },
        '9:16': { '1K': '720x1280', '2K': '1080x1920', '4K': '2160x3840' },
        '2:3': { '1K': '853x1280', '2K': '1280x1920', '4K': '2560x3840' },
        '3:4': { '1K': '960x1280', '2K': '1440x1920', '4K': '2880x3840' },
        '1:2': { '2K': '960x1920', '4K': '1920x3840' },
        '2:1': { '2K': '1920x960', '4K': '3840x1920' },
        '4:5': { '1K': '1024x1280', '2K': '1536x1920', '4K': '3072x3840' },
        '3:2': { '1K': '1280x853', '2K': '1920x1280', '4K': '3840x2560' },
        '4:3': { '1K': '1280x960', '2K': '1920x1440', '4K': '3840x2880' }
      };
      if (PRESETS[key] && PRESETS[key][token]) return PRESETS[key][token];
      // Fallback compute by long edge
      const base = token === '4K' ? 3840 : token === '2K' ? 1920 : 1280;
      if (sw >= sh) {
        const h = Math.round(base * (sh / sw));
        return `${base}x${h}`;
      } else {
        const w = Math.round(base * (sw / sh));
        return `${w}x${base}`;
      }
    };

    const optimistic = {
      prompt: img.prompt,
      images: [],
      expectedOutputs: img.outputs,
      credit_cost: (typeof img.priceCredits === 'number' ? img.priceCredits : null),
      aspectRatio: computeAspect() || img.aspectRatio,
      aspect_ratio: computeAspect() || img.aspectRatio, // Also include backend field name
      created_at: new Date().toISOString(),
      completed_at: null,
      status: 'processing',
      model: img.model,
      clientKey: optimisticId,
      isOptimistic: true,
      progress: Array(Math.max(1, img.outputs || 1)).fill(0),
      // Use final size (explicit WxH) for correct placeholder ratio
      resolution: computeOptimisticFinalSize(),
      // Include reference images immediately for modal display
      ref_image_url: img.refImageUrl || null,
      ref_image_urls: Array.isArray(img.refImageUrls) ? img.refImageUrls.slice(0, 10) : null
    };

    console.log("🎴 Creating optimistic card:", optimisticId);
    setSessions(prev => {
      const newSessions = [optimistic, ...prev];
      return newSessions;
    });

    // Add 300ms cooldown to prevent rapid clicking
    setButtonCooldown(true);
    setTimeout(() => {
      setButtonCooldown(false);
    }, 300);

    try {
      // Freeze the exact Final size at click time to avoid any subsequent state drift
      const frozenFinal = (typeof img.computedSize === 'string' && /^(\d{2,5})x(\d{2,5})$/i.test(img.computedSize)) ? img.computedSize : undefined;
      const result = await img.generate({ 
        forceSize: frozenFinal, 
        clientKey: optimisticId 
      });
      console.log("🎯 Generation result:", { sessionId: result?.sessionId, clientKey: result?.clientKey, optimisticId });
      if (result && result.sessionId) {
        // Attach server sessionId but preserve clientKey to avoid remount
        setSessions(prev => prev.map(s => {
          if (s.clientKey === optimisticId) {
            console.log(`🔄 Updating optimistic session ${optimisticId} → ${result.sessionId} with clientKey: ${result.clientKey || optimisticId}`);
            return { ...s, session_id: result.sessionId, isOptimistic: false, clientKey: result.clientKey || optimisticId };
          }
          return s;
        }));
        // Credits now update via SSE; no additional polling needed
      }
    } catch (error) {
      // Remove optimistic card on error
      setSessions(prev => prev.filter(s => s.clientKey !== optimisticId));
    }
  };

  const loadMoreImages = async () => {
    if (isLoadingMore || !hasMore) return;
    
    setIsLoadingMore(true);
    try {
      const pageSize = DEFAULT_PAGE_SIZE;
      const res = await phFetch(`${img.API_BASE}/api/images/seedream4/history?limit=${pageSize}&offset=${currentOffset}`);
      if (!res.ok) return;
      const data = await res.json();
      const rows = data.items || [];
      
      const grouped = {};
      rows.forEach(r => {
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
          resolution: r.resolution || null,
          ref_image_url: r.ref_image_url || null,
          ref_image_urls: r.ref_image_urls || null,
          error_details: r.error_details || null,
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
      setCurrentOffset(prev => prev + pageSize);
    } catch (error) {
      console.error('Failed to load more Seedream 4.0 images:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const authed = !!user;
  const allowGenerate = canGenerate({ isAuthenticated: authed, userCredits: user?.credits || 0, requiredCredits: img.priceCredits });
  const [guardVisible, setGuardVisible] = useState(false);

  // Memoize panel to prevent recreation on every render (prevents infinite loop with dual desktop/mobile panels)
  const panelContent = useMemo(() => (
    <Seedream4Panel
      prompt={img.prompt}
      setPrompt={img.setPrompt}
      model={img.model}
      setModel={img.setModel}
      outputs={img.outputs}
      setOutputs={img.setOutputs}
      aspectRatio={img.aspectRatio}
      setAspectRatio={img.setAspectRatio}
      size={img.size}
      setSize={img.setSize}
      computedSize={img.computedSize}
      setComputedSize={img.setComputedSize}
      derivedSizes={img.derivedSizes}
      guidanceScale={img.guidanceScale}
      setGuidanceScale={img.setGuidanceScale}
      negativePrompt={img.negativePrompt}
      setNegativePrompt={img.setNegativePrompt}
      refImageUrl={img.refImageUrl}
      setRefImageUrl={img.setRefImageUrl}
      refImageUrls={img.refImageUrls}
      setRefImageUrls={img.setRefImageUrls}
      isReuseMode={img.isReuseMode}
      setReuseMode={img.setReuseMode}
      applyingReuseSettings={img.applyingReuseSettings}
      setApplyingReuseSettings={img.setApplyingReuseSettings}
      resolutionIsMatchFirst={img.resolutionIsMatchFirst}
      setResolutionIsMatchFirst={img.setResolutionIsMatchFirst}
      setSeed={img.setSeed}
      watermark={img.watermark}
      setWatermark={img.setWatermark}
      loading={img.loading}
      error={img.error}
      onGenerate={handleOptimisticGenerate}
      submittingCount={0}
      buttonCooldown={buttonCooldown}
      priceCredits={img.priceCredits}
      priceLoading={img.priceLoading}
      priceError={img.priceError}
      canGenerate={allowGenerate}
      lockResolutionFromTemplate={img.lockResolutionFromTemplate}
      imageSyncRef={imageSyncRef}
    />
  ), [buttonCooldown, allowGenerate, handleOptimisticGenerate, imageSyncRef]);

  return (
    <AppShell
      selectedTool="seedream4"
      onSignInClick={() => {}}
      onSignUpClick={() => {}}
      onBuyCreditsClick={() => {}}
      mobilePromptNode={(
        <textarea
          className="w-full p-2 rounded bg-[#232326] text-white focus:outline-none focus:ring border border-white/10"
          rows={2}
          value={img.prompt}
          onChange={(e) => img.setPrompt(e.target.value)}
          placeholder="Describe your Seedream 4.0 image..."
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
          const balance = Number((data?.available ?? data?.credits) || 0);
          const required = img.priceCredits || img.outputs || 1;
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
      mobileSettingsContent={panelContent}
      childrenLeft={panelContent}
      childrenMain={(
        <>
          <Suspense fallback={null}>
            <Seedream4TemplateApplier img={img} appliedTemplatesRef={appliedTemplatesRef} />
          </Suspense>
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
              sessions.map((session, index) => {
                // Convert image objects back to URLs for the component
                const sessionWithUrls = {
                  ...session,
                  images: session.images ? session.images.map(img => typeof img === 'object' ? img.url : img) : []
                };
                return (
                <ImageHistoryCard 
                  key={`${session.session_id ? `real:${session.session_id}` : `opt:${session.clientKey || session.created_at || 'row'}`}`} 
                  session={sessionWithUrls} 
                  API_BASE={img.API_BASE} 
                  onReusePrompt={(prompt, session) => {
                    if (session) {
                      // Reuse all parameters from the session
                      img.setPrompt(prompt);
                      img.setModel(session.model || 'seedream-4-0-250828');
                      const settings = (() => {
                        try {
                          if (!session.input_settings) return null;
                          if (typeof session.input_settings === 'string') return JSON.parse(session.input_settings);
                          return session.input_settings;
                        } catch { return null; }
                      })();
                      if (settings) {
                        try {
                          // Reference images in saved order
                          const refs = Array.isArray(settings.ref_image_urls) ? settings.ref_image_urls.filter(Boolean).slice(0, 10) : [];
                          img.setRefImageUrls(refs);
                          img.setRefImageUrl(refs[0] || '');
                        } catch {}
                        try {
                          // Precompute resolution-related values ONCE for reuse across AR + Resolution blocks
                          const resMode = settings.resolution_mode;
                          const resVal = settings.resolution_value;
                          const computedForAR = settings.computed_size || resVal;
                          const derivedSizes = settings.derived_sizes || {};

                          // Aspect Ratio
                          const arMode = settings.aspect_ratio_mode;
                          const arVal = settings.aspect_ratio_value;
                          const PRESET_AR = new Set(['1:1','16:9','9:16','3:2','2:3','4:3','3:4','4:5','5:4','21:9','1:2','2:1']);
                          if (arMode === 'fixed' && arVal) {
                            img.setAspectRatio(arVal);
                          } else if (arMode === 'match_input') {
                            // Always restore match_input mode when it was originally selected
                            img.setAspectRatio('match_input');
                            // Also restore the reference aspect ratio for proper calculations
                            if (arVal) {
                              img.setRefImageAspectRatio(arVal);
                            } else if (computedForAR && /^\d{2,5}x\d{2,5}$/i.test(String(computedForAR))) {
                              // Derive aspect ratio from computed_size if arVal is not available
                              const [w, h] = String(computedForAR).toLowerCase().split('x').map(n => parseInt(n, 10));
                              if (w > 0 && h > 0) {
                                const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
                                const g = gcd(w, h);
                                const aspectRatio = `${Math.round(w / g)}:${Math.round(h / g)}`;
                                img.setRefImageAspectRatio(aspectRatio);
                              }
                            }
                          } else {
                            img.setAspectRatio(arVal || '1:1');
                          }
                        } catch { img.setAspectRatio('1:1'); }
                        let appliedResolution = false;
                        try {
                          // Resolution — restore the exact mode and values from saved settings
                          const resMode = settings.resolution_mode;
                          const resVal = settings.resolution_value;
                          const computed = settings.computed_size || resVal;
                          const derivedSizes = settings.derived_sizes || {};
                          console.log('[seedream4][reuse] parsed settings:', { resMode, resVal, computed, derivedSizes });
                          
                          // Match previous behavior: prefer exact when a valid computed size exists,
                          // regardless of whether resMode was recorded as 'exact' or missing.
                          if (computed && /^\d{2,5}x\d{2,5}$/i.test(String(computed))) {
                            // Map exact WxH to nearest token for the dropdown, but keep computedSize exact
                            const [cw, ch] = String(computed).toLowerCase().split('x').map(n => parseInt(n, 10) || 0);
                            const longEdge = Math.max(cw, ch);
                            const token = longEdge >= 3840 ? '4K' : longEdge >= 1920 ? '2K' : '1K';
                            console.log('[reuse] applying exact size -> token:', { computed, token });
                            img.setSize(token);
                            if (typeof img.setComputedSize === 'function') img.setComputedSize(String(computed).toLowerCase());
                            img.setResolutionIsMatchFirst(false);
                            appliedResolution = true;
                          } else if (resMode === 'token') {
                            // This was a token selection (1K/2K/4K)
                            console.log('[reuse] applying token size:', resVal || '1K');
                            img.setSize(String(resVal || '1K'));
                            // Use saved derived size for the selected token
                            const tokenSize = derivedSizes[String(resVal || '1K').toUpperCase()];
                            if (tokenSize && typeof img.setComputedSize === 'function') {
                              img.setComputedSize(tokenSize);
                            } else if (typeof img.setComputedSize === 'function') {
                              img.setComputedSize('');
                            }
                            img.setResolutionIsMatchFirst(false);
                            appliedResolution = true;
                          } else {
                            // Default to a safe token if no exact size exists
                            console.log('[reuse] applying default token 1K');
                            img.setSize('1K');
                            if (typeof img.setComputedSize === 'function') img.setComputedSize('');
                            img.setResolutionIsMatchFirst(false);
                          }
                        } catch {}
                        try { img.setOutputs(settings.outputs || session.outputs || 1); } catch {}
                        try { img.setGuidanceScale(settings.guidance_scale || session.guidance_scale || 3); } catch {}
                        try { if (typeof settings.watermark === 'boolean') img.setWatermark(settings.watermark); } catch {}
                        try { if (settings.seed != null) img.setSeed(String(settings.seed)); } catch {}
                        try { img.setNegativePrompt(settings.negative_prompt || ''); } catch {}
                        
                        // Pass saved derived sizes to the panel for immediate display
                        if (settings.derived_sizes && typeof img.setDerivedSizes === 'function') {
                          img.setDerivedSizes(settings.derived_sizes);
                        }
                        
                        // Set reuse mode flags to prevent automatic size override
                        img.setReuseMode(true);
                        img.setApplyingReuseSettings(true);
                        
                        // Clear the applying flag after a short delay to allow all state updates to complete
                        setTimeout(() => {
                          img.setApplyingReuseSettings(false);
                        }, 100);
                        
                        // Only short-circuit when we actually applied a resolution from settings
                        if (appliedResolution) {
                          return; // done via input_settings
                        }
                      }
                      // Aspect ratio must never be null (selects don't accept null)
                      try {
                        let nextAR = session.aspect_ratio || session.aspectRatio || '';
                        if (!nextAR && session.resolution && /^(\d+)x(\d+)$/i.test(session.resolution)) {
                          const [w, h] = session.resolution.toLowerCase().split('x').map(n => parseInt(n, 10));
                          if (w > 0 && h > 0) {
                            const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
                            const g = gcd(w, h);
                            nextAR = `${Math.round(w / g)}:${Math.round(h / g)}`;
                          }
                        }
                        img.setAspectRatio(nextAR || '1:1');
                      } catch { img.setAspectRatio('1:1'); }
                      // Legacy fallback when input_settings is absent
                      const res = String(session.resolution || '').toLowerCase();
                      if (res) console.log('[reuse][legacy] session.resolution:', res);
                      if (/^\d+x\d+$/i.test(res)) {
                        // Map exact WxH to nearest token for the dropdown, keep computed exact
                        try {
                          const [w, h] = res.split('x').map(n => parseInt(n, 10) || 0);
                          const token = Math.max(w, h) >= 3840 ? '4K' : Math.max(w, h) >= 1920 ? '2K' : '1K';
                          console.log('[reuse][legacy] applying exact -> token:', { res, token });
                          img.setSize(token);
                          if (typeof img.setComputedSize === 'function') img.setComputedSize(res);
                        } catch {
                          img.setSize('1K');
                          if (typeof img.setComputedSize === 'function') img.setComputedSize('');
                        }
                      } else {
                        // Otherwise map by width to token
                        const w = parseInt(res.split('x')[0], 10) || 0;
                        const token = w >= 3840 ? '4K' : w >= 1920 ? '2K' : '1K';
                        img.setSize(token);
                        if (typeof img.setComputedSize === 'function') img.setComputedSize('');
                      }
                      img.setGuidanceScale(session.guidance_scale || 3);
                      img.setOutputs(session.outputs || 1);
                      // Apply reference images in the same order
                      try {
                        const arr = Array.isArray(session.ref_image_urls)
                          ? session.ref_image_urls
                          : (typeof session.ref_image_urls === 'string' ? JSON.parse(session.ref_image_urls) : []);
                        const refs = Array.isArray(arr) ? arr.filter(Boolean).slice(0, 10) : [];
                        const single = (!refs.length && session.ref_image_url) ? [session.ref_image_url] : [];
                        const allRefs = [...refs, ...single];
                        img.setRefImageUrls(allRefs);
                        img.setRefImageUrl(allRefs[0] || '');
                        // Do not force match_input here; we already applied saved settings or legacy mapping above
                      } catch {}
                    } else {
                      // Fallback to just prompt
                      img.setPrompt(prompt);
                    }
                  }} 
                  estimateMs={avgEstimateMs} 
                />
                );
              })
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
    />
  );
}
