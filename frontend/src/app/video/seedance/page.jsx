"use client";
import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "../../components/AppShell";
import GenerationGuard, { canGenerate } from "../../components/GenerationGuard";
import SeedancePanel from "../../components/SeedancePanel";
import VideoHistoryCard from "../../components/history/VideoHistoryCard";
import SeedanceHistoryCard from "../../components/history/SeedanceHistoryCard";
import { useAuth } from "../../contexts/AuthContext";
import { useVideoGenerationSeedance } from "../../hooks/useVideoGenerationSeedance";
import phFetch from "../../services/phFetch";

function SeedanceTemplateApplier({ vid, appliedTemplatesRef }) {
  const searchParams = useSearchParams();
  
  useEffect(() => {
    const slug = String(searchParams?.get('template') || '').toLowerCase();
    if (!slug) return;
    
    // Check if this template was already applied (survives component unmount/remount)
    if (appliedTemplatesRef.current.has(slug)) return;
    
    const run = async () => {
      try {
        const res = await phFetch(`${vid.API_BASE}/api/templates/seedance/${encodeURIComponent(slug)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const t = await res.json();
        if (t && t.settings) {
          vid.applyTemplate?.(t.settings);
          appliedTemplatesRef.current.add(slug);
        }
      } catch {}
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, appliedTemplatesRef]);
  return null;
}

export default function SeedancePage() {
  const { user, checkAuth } = useAuth();
  const vid = useVideoGenerationSeedance(user);
  const appliedTemplatesRef = useRef(new Set());
  const [videoSessions, setVideoSessions] = useState([]);
  const [buttonCooldown, setButtonCooldown] = useState(false);
  const [avgEstimateMs, setAvgEstimateMs] = useState(60000);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasConfirmedNoData, setHasConfirmedNoData] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);

  // Template application moved into Suspense-wrapped child

  // Merge arrays of sessions while preserving order and existing video URLs/status where new data is missing
  const mergeStable = (existing, incoming) => {
    const byIncoming = new Map();
    for (const s of incoming) {
      const id = s && (s.session_id || s.id);
      if (!id) continue;
      byIncoming.set(id, s);
    }
    const next = existing.map(old => {
      const id = old && (old.session_id || old.id);
      const inc = byIncoming.get(id);
      if (!inc) return old;
      // Preserve stored URLs if incoming row lacks them
      const merged = {
        ...old,
        ...inc,
        b2_url: inc.b2_url || old.b2_url || null,
        original_url: inc.original_url || old.original_url || null,
      };
      return merged;
    });
    // Append new ones not present previously
    const existingIds = new Set(existing.map(s => s && (s.session_id || s.id)));
    for (const s of incoming) {
      const id = s && (s.session_id || s.id);
      if (!id || existingIds.has(id)) continue;
      next.push(s);
    }
    return next;
  };

  const handleGenerateVideo = async () => {
    // Avoid immediate checkAuth so optimistic available_credits persists until SSE
    if (!vid.videoPrompt.trim()) return;
    
    // Quick credit check before creating optimistic card
    let creditsSufficient = false;
    
    try {
      const creditsRes = await phFetch(`${vid.API_BASE}/api/user/credits`);

      if (creditsRes.ok) {
        const creditsData = await creditsRes.json();
        const requiredCredits = 5; // Seedance costs 5 credits
        
        if (creditsData.credits >= requiredCredits) {
          creditsSufficient = true;
        } else {
          vid.setVideoError("Not enough credits");
          return;
        }
      } else {
        vid.setVideoError("Unable to verify credits. Please try again later.");
        return;
      }
    } catch (error) {
      vid.setVideoError("Unable to verify credits. Please try again later.");
      return;
    }
    
    if (!creditsSufficient) {
      return;
    }

    // Create a unique identifier for this optimistic session
    const optimisticId = `temp-${Date.now()}`;

    // Optimistic card
    const optimistic = {
      session_id: optimisticId,
      prompt: vid.videoPrompt,
      model: vid.videoModel,
      credit_cost: (typeof vid.priceCredits === 'number' ? vid.priceCredits : 5),
      aspect_ratio: vid.videoAspectRatio,
      resolution: vid.videoResolution,
      video_duration: vid.videoDuration,
      status: 'processing',
      provider_status: 'queued',
      created_at: new Date().toISOString(),
      completed_at: null,
      ref_image_url: vid.imageUrl || null,
      clientKey: optimisticId,
      isOptimistic: true // Mark as optimistic
    };

    // Add optimistic card immediately
    setVideoSessions(prev => [optimistic, ...prev]);

    setButtonCooldown(true);
    setTimeout(() => setButtonCooldown(false), 300);
    
    try {
      const result = await vid.generateVideo({ clientKey: optimisticId });
      if (result && result.sessionId) {
        // Replace optimistic card with real session
        setVideoSessions(prev => prev.map(s => 
          s.session_id === optimisticId 
            ? { ...s, session_id: result.sessionId, isOptimistic: false }
            : s
        ));
        // Credits now update via SSE; no additional polling needed
      } else {
        // Remove optimistic card on error
        setVideoSessions(prev => prev.filter(s => s.session_id !== optimisticId));
      }
    } catch (error) {
      // Remove optimistic card on error
      setVideoSessions(prev => prev.filter(s => s.session_id !== optimisticId));
    }
  };

  const loadMoreVideos = async () => {
    if (isLoadingMore || !hasMore) return;
    
    setIsLoadingMore(true);
    try {
      const res = await phFetch(`${vid.API_BASE}/api/video/seedance/history?limit=10&offset=${currentOffset}`);
      if (!res.ok) return;
      const data = await res.json();
      const rows = data.items || [];
      
      // Deduplicate by session_id
      const uniq = [];
      const seen = new Set();
      for (const r of rows) { if (!seen.has(r.session_id)) { seen.add(r.session_id); uniq.push(r); } }
      
      // Enrich with provider_status for Seedance processing rows
      const enriched = await Promise.all(uniq.map(async (s) => {
        try {
          const lowerModel = String(s.model || '').toLowerCase();
          if (s.status === 'processing' && lowerModel.includes('seedance')) {
            const r = await phFetch(`${vid.API_BASE}/api/seedance/status/${s.session_id}`);
            if (r.ok) {
              const data = await r.json();
              return { ...s, provider_status: data.provider_status || s.provider_status };
            }
          }
        } catch {}
        return s;
      }));
      const onlySeedance = enriched.filter(s => String(s.model || '').toLowerCase().includes('seedance'));
      
      setVideoSessions(prev => mergeStable(prev, onlySeedance));
      
      setHasMore(data.pagination?.hasMore || false);
      setCurrentOffset(prev => prev + 10);
    } catch (error) {
      console.error('Failed to load more videos:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Load history for this user (shared endpoint)
  useEffect(() => {
    const run = async () => {
             if (!user) { 
         setVideoSessions([]); 
         setIsLoadingHistory(false);
         setHasConfirmedNoData(true);
         return; 
       }
      
            setIsLoadingHistory(true);
      try {
        const res = await phFetch(`${vid.API_BASE}/api/video/seedance/history?limit=10&offset=0`);
        if (!res.ok) return;
        const data = await res.json();
        const rows = data.items || [];
        
        // Deduplicate by session_id
        const uniq = [];
        const seen = new Set();
        for (const r of rows) { if (!seen.has(r.session_id)) { seen.add(r.session_id); uniq.push(r); } }
        // Enrich with provider_status for Seedance processing rows
        const enriched = await Promise.all(uniq.map(async (s) => {
          try {
            const lowerModel = String(s.model || '').toLowerCase();
            if (s.status === 'processing' && lowerModel.includes('seedance')) {
              const r = await phFetch(`${vid.API_BASE}/api/seedance/status/${s.session_id}`);
              if (r.ok) {
                const data = await r.json();
                return { ...s, provider_status: data.provider_status || s.provider_status };
              }
            }
          } catch {}
          return s;
        }));
        const onlySeedance = enriched.filter(s => String(s.model || '').toLowerCase().includes('seedance'));
        
        setVideoSessions(prev => mergeStable(prev, onlySeedance));
        setHasMore(data.pagination?.hasMore || false);
        setCurrentOffset(10);
        setHasConfirmedNoData(true);
       } catch (error) {
         console.error('Failed to load video history:', error);
         setHasConfirmedNoData(true);
       } finally {
         setIsLoadingHistory(false);
       }
    };
    run();
     }, [user, vid.API_BASE]);

   // Reset confirmation state when user changes
   useEffect(() => {
     setHasConfirmedNoData(false);
     setHasMore(false);
     setIsLoadingMore(false);
     setCurrentOffset(0);
   }, [user]);

  // Fetch average estimate
  useEffect(() => {
    const loadEstimate = async () => {
      try {
        const res = await phFetch(`${vid.API_BASE}/api/video/estimate`);
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.averageMs === 'number' && data.averageMs > 0) setAvgEstimateMs(Math.round(data.averageMs));
      } catch {}
    };
    loadEstimate();
  }, [vid.API_BASE]);

  // Stable polling using refs and boolean dependency
  const sessionsRef = useRef(videoSessions);
  useEffect(() => { sessionsRef.current = videoSessions; }, [videoSessions]);
  const hasProcessing = useMemo(() => videoSessions.some(s => s.status === 'processing'), [videoSessions]);
  const completedNotifiedRef = useRef(new Set());

  useEffect(() => {
    if (!hasProcessing) return;
    const interval = setInterval(async () => {
      const res = await phFetch(`${vid.API_BASE}/api/video/seedance/history?limit=10&offset=0`);
      if (!res.ok) return;
      const data = await res.json();
      const rows = data.items || [];
      const uniq = [];
      const seen = new Set();
      for (const r of rows) { if (!seen.has(r.session_id)) { seen.add(r.session_id); uniq.push(r); } }
      const enriched = await Promise.all(uniq.map(async (s) => {
        try {
          const lowerModel = String(s.model || '').toLowerCase();
          if (s.status === 'processing' && lowerModel.includes('seedance')) {
            const r = await phFetch(`${vid.API_BASE}/api/seedance/status/${s.session_id}`);
            if (r.ok) {
              const data = await r.json();
              return { ...s, provider_status: data.provider_status || s.provider_status };
            }
          }
        } catch {}
        return s;
      }));
      const onlySeedance = enriched.filter(s => String(s.model || '').toLowerCase().includes('seedance'));
      // Detect newly completed sessions to trigger a single credits refresh
      try {
        const prevList = sessionsRef.current || [];
        const prevStatusById = new Map(prevList.map(p => [p && (p.session_id || p.id), p && p.status]));
        const newlyCompleted = onlySeedance
          .filter(s => s && s.session_id && s.status === 'completed' && prevStatusById.get(s.session_id) === 'processing' && !completedNotifiedRef.current.has(s.session_id))
          .map(s => s.session_id);
        if (newlyCompleted.length > 0) {
          newlyCompleted.forEach(id => completedNotifiedRef.current.add(id));
          try {
            const cr = await phFetch(`${vid.API_BASE}/api/user/credits`, { cache: 'no-store' });
            if (cr.ok) {
              const j = await cr.json().catch(() => ({}));
              const next = Number(j?.credits);
              const observed = Number(user?.credits || 0);
              if (Number.isFinite(next) && next !== observed) {
                try { await checkAuth?.(false); } catch {}
              }
            }
          } catch {}
        }
      } catch {}
      setVideoSessions(prev => mergeStable(prev, onlySeedance));
    }, 5000);
    return () => clearInterval(interval);
  }, [hasProcessing, vid.API_BASE, user, checkAuth]);

  // (Consolidated into the 5s history poll above to avoid duplicate requests)

  const [guardVisible, setGuardVisible] = useState(false);

  useEffect(() => {
    const handler = () => setGuardVisible(true);
    window.addEventListener('seedance-open-guard', handler);
    const requestHandler = async (e) => {
      const explicit = Number(e?.detail?.requiredCredits || 0);
      const need = explicit > 0 ? explicit : Number(vid.priceCredits || 0);
      try {
      const res = await phFetch(`${vid.API_BASE}/api/user/credits`, { cache: 'no-store' });
        if (!res.ok) { setGuardVisible(true); return; }
        const j = await res.json();
        const balance = Number(j?.credits || 0);
        if (balance <= 0 || (need > 0 && balance < need)) {
          // Redirect to billing page with returnTo parameter
          const currentPath = window.location.pathname;
          window.location.href = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
        } else {
          await handleGenerateVideo();
        }
      } catch {
        setGuardVisible(true);
      }
    };
    window.addEventListener('seedance-open-guard-request', requestHandler);
    return () => {
      window.removeEventListener('seedance-open-guard', handler);
      window.removeEventListener('seedance-open-guard-request', requestHandler);
    };
  }, [user, vid.priceCredits]);

  return (
    <AppShell
      selectedTool="seedance"
      mobilePromptNode={(
        <textarea
          className="w-full p-2 rounded bg-[#232326] text-white focus:outline-none focus:ring border border-white/10"
          rows={2}
          value={vid.videoPrompt}
          onChange={(e) => vid.setVideoPrompt(e.target.value)}
          placeholder="Describe the video you want to generate..."
        />
      )}
      onMobileGenerate={async () => {
        if (!user) {
          window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
          return;
        }
        // Check credits before generating
        try {
          const res = await fetch(`${vid.API_BASE}/api/user/credits`, { credentials: 'include', cache: 'no-store' });
          if (!res.ok) {
            window.location.href = `/billing?returnTo=${encodeURIComponent(window.location.pathname)}`;
            return;
          }
          const data = await res.json();
          const balance = Number((data?.available ?? data?.credits) || 0);
          const required = vid.priceCredits || 5;
          if (balance < required) {
            window.location.href = `/billing?returnTo=${encodeURIComponent(window.location.pathname)}`;
            return;
          }
          handleGenerateVideo();
        } catch {
          window.location.href = `/billing?returnTo=${encodeURIComponent(window.location.pathname)}`;
        }
      }}
      mobileGenerateDisabled={!vid.videoPrompt.trim() || !!buttonCooldown || (String(vid.videoModel || '').includes('i2v') && !vid.startFrameUrl && vid.endFrameUrl)}
      mobileCreditAmount={vid.priceCredits || 5}
      mobileSettingsContent={(
        <SeedancePanel
          videoPrompt={vid.videoPrompt}
          setVideoPrompt={vid.setVideoPrompt}
          videoModel={vid.videoModel}
          setVideoModel={vid.setVideoModel}
          videoAspectRatio={vid.videoAspectRatio}
          setVideoAspectRatio={vid.setVideoAspectRatio}
          videoResolution={vid.videoResolution}
          setVideoResolution={vid.setVideoResolution}
          videoDuration={vid.videoDuration}
          setVideoDuration={vid.setVideoDuration}
          imageUrl={vid.imageUrl}
          setImageUrl={vid.setImageUrl}
          startFrameUrl={vid.startFrameUrl}
          setStartFrameUrl={vid.setStartFrameUrl}
          endFrameUrl={vid.endFrameUrl}
          setEndFrameUrl={vid.setEndFrameUrl}
          onGenerateVideo={handleGenerateVideo}
          videoError={vid.videoError}
          videoSubmittingCount={vid.videoSubmittingCount}
          buttonCooldown={buttonCooldown}
          priceCredits={vid.priceCredits}
          priceExact={vid.priceExact}
          priceLoading={vid.priceLoading}
            priceError={vid.priceError}
            applyingReuseSettings={vid.applyingReuseSettings}
        />
      )}
      childrenLeft={(
        <SeedancePanel
          videoPrompt={vid.videoPrompt}
          setVideoPrompt={vid.setVideoPrompt}
          videoModel={vid.videoModel}
          setVideoModel={vid.setVideoModel}
          videoAspectRatio={vid.videoAspectRatio}
          setVideoAspectRatio={vid.setVideoAspectRatio}
          videoResolution={vid.videoResolution}
          setVideoResolution={vid.setVideoResolution}
          videoDuration={vid.videoDuration}
          setVideoDuration={vid.setVideoDuration}
          imageUrl={vid.imageUrl}
          setImageUrl={vid.setImageUrl}
          startFrameUrl={vid.startFrameUrl}
          setStartFrameUrl={vid.setStartFrameUrl}
          endFrameUrl={vid.endFrameUrl}
          setEndFrameUrl={vid.setEndFrameUrl}
          onGenerateVideo={handleGenerateVideo}
          videoError={vid.videoError}
          videoSubmittingCount={vid.videoSubmittingCount}
          buttonCooldown={buttonCooldown}
          priceCredits={vid.priceCredits}
          priceExact={vid.priceExact}
          priceLoading={vid.priceLoading}
            priceError={vid.priceError}
            applyingReuseSettings={vid.applyingReuseSettings}
        />
      )}
      childrenMain={(
        <>
          <Suspense fallback={null}>
            <SeedanceTemplateApplier vid={vid} appliedTemplatesRef={appliedTemplatesRef} />
          </Suspense>
          <div className="sticky top-0 z-10 -mx-6 px-6 pt-6 mb-4 bg-[#0a0a0a]">
            <h1 className="text-xl font-bold border-b border-white/10 pb-2">Generated Videos</h1>
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
                    <div className="h-48 bg-white/5 rounded-lg"></div>
                  </div>
                ))}
              </div>
            ) : (!isLoadingHistory && videoSessions.length === 0) ? (
              <div className="text-center py-12">
                <p className="text-gray-400">No videos generated yet. Create your first video using the controls on the left!</p>
              </div>
                         ) : videoSessions.length > 0 ? (
               videoSessions.map((session) => {
                 const isSeedance = String(session.model || '').toLowerCase().includes('seedance');
                 return isSeedance ? (
                                      <SeedanceHistoryCard
                     key={session.session_id}
                     session={session}
                     onManualCheck={() => {}}
                     onReusePrompt={(prompt, session) => {
                        if (session) {
                          // Reuse all parameters from the session with safe defaults (no nulls)
                          vid.setVideoPrompt(prompt || '');
                          // Map provider-specific model ids to generic dropdown values
                          const sm = String(session.model || '').toLowerCase();
                          const genericModel = sm.includes('lite') ? 'seedance-1-0-lite' : (sm.includes('pro') ? 'seedance-1-0-pro' : (vid.videoModel || 'seedance-1-0-lite'));
                      vid.setApplyingReuseSettings(true);
                      try {
                        vid.setVideoModel(genericModel);
                        vid.setVideoAspectRatio(session.aspect_ratio || session.aspectRatio || '16:9');
                        vid.setVideoResolution(session.resolution || '1080p');
                        vid.setVideoDuration(Number(session.video_duration) || 5);
                        // Replace ref image and frames from session
                        vid.setImageUrl(session.ref_image_url || '');
                        vid.setStartFrameUrl(session.start_frame_url || '');
                        vid.setEndFrameUrl(session.end_frame_url || '');
                      } finally {
                        // Allow effects to run after state settles
                        setTimeout(() => vid.setApplyingReuseSettings(false), 0);
                      }
                        } else {
                          // Fallback to just prompt
                          vid.setVideoPrompt(prompt || '');
                        }
                      }}
                     estimateMs={avgEstimateMs}
                   />
                ) : (
                                      <VideoHistoryCard
                     key={session.session_id}
                     session={session}
                     onManualCheck={() => {}}
                     onReusePrompt={(prompt, session) => {
                       if (session) {
                         // Reuse all parameters from the session
                         vid.setVideoPrompt(prompt);
                         vid.setVideoModel(session.model || 'veo3');
                         vid.setVideoAspectRatio(session.aspect_ratio || '16:9');
                       } else {
                         // Fallback to just prompt
                         vid.setVideoPrompt(prompt);
                       }
                     }}
                     estimateMs={avgEstimateMs}
                   />
                );
               })
             ) : null}
             
             {/* Load More Button */}
             {hasMore && videoSessions.length > 0 && (
               <div className="flex justify-center pt-4">
                 <button
                   onClick={loadMoreVideos}
                   disabled={isLoadingMore}
                   className="px-6 py-2 bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                 >
                   {isLoadingMore ? (
                     <div className="flex items-center gap-2">
                       <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                       Loading...
                     </div>
                   ) : (
                     'Load More Videos'
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


