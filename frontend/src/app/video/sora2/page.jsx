"use client";
import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import phFetch from "../../services/phFetch";
import AppShell from "../../components/AppShell";
import GenerationGuard from "../../components/GenerationGuard";
import Sora2Panel from "../../components/Sora2Panel";
import Sora2HistoryCard from "../../components/history/Sora2HistoryCard";
import { useAuth } from "../../contexts/AuthContext";
import { useVideoGenerationSora2 } from "../../hooks/useVideoGenerationSora2";

function Sora2TemplateApplier({ vid }) {
  const searchParams = useSearchParams();
  const appliedRef = useRef(false);
  
  useEffect(() => {
    if (appliedRef.current) return;
    
    const slug = String(searchParams?.get('template') || '').toLowerCase();
    if (!slug) return;
    const run = async () => {
      try {
        const res = await phFetch(`${vid.API_BASE}/api/templates/sora2/${encodeURIComponent(slug)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const t = await res.json();
        if (t && t.settings) {
          vid.applyTemplate?.(t.settings);
          appliedRef.current = true;
        }
      } catch {}
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  return null;
}

export default function Sora2Page() {
  const { user, checkAuth } = useAuth();
  const vid = useVideoGenerationSora2(user);
  const [videoSessions, setVideoSessions] = useState([]);
  const [buttonCooldown, setButtonCooldown] = useState(false);
  const [avgEstimateMs, setAvgEstimateMs] = useState(60000);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasConfirmedNoData, setHasConfirmedNoData] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);

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
      const merged = {
        ...old,
        ...inc,
        b2_url: inc.b2_url || old.b2_url || null,
        original_url: inc.original_url || old.original_url || null,
      };
      return merged;
    });
    const existingIds = new Set(existing.map(s => s && (s.session_id || s.id)));
    for (const s of incoming) {
      const id = s && (s.session_id || s.id);
      if (!id || existingIds.has(id)) continue;
      next.push(s);
    }
    return next;
  };

  const handleGenerateVideo = async () => {
    if (!vid.videoPrompt.trim()) return;
    const optimisticId = `temp-sora-${Date.now()}`;
    const optimistic = {
      session_id: optimisticId,
      prompt: vid.videoPrompt,
      model: vid.videoModel,
      credit_cost: (typeof vid.priceCredits === 'number' ? vid.priceCredits : 5),
      aspect_ratio: vid.videoAspectRatio,
      resolution: vid.videoResolution,
      video_duration: vid.videoDuration,
      status: 'processing',
      provider_status: 'processing', // Show 'processing' since API request has been sent
      created_at: new Date().toISOString(),
      completed_at: null,
      clientKey: optimisticId,
      isOptimistic: true
    };
    setVideoSessions(prev => [optimistic, ...prev]);
    setButtonCooldown(true);
    setTimeout(() => setButtonCooldown(false), 300);
    try {
      const result = await vid.generateVideo({ clientKey: optimisticId });
      if (result && result.sessionId) {
        setVideoSessions(prev => prev.map(s => s.session_id === optimisticId ? { ...s, session_id: result.sessionId, isOptimistic: false } : s));
      } else {
        setVideoSessions(prev => prev.filter(s => s.session_id !== optimisticId));
      }
    } catch {
      setVideoSessions(prev => prev.filter(s => s.session_id !== optimisticId));
    }
  };

  const loadMoreVideos = async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const res = await phFetch(`${vid.API_BASE}/api/sora2/history?limit=10&offset=${currentOffset}`);
      if (!res.ok) return;
      const data = await res.json();
      const rows = data.items || [];
      const uniq = [];
      const seen = new Set();
      for (const r of rows) { if (!seen.has(r.session_id)) { seen.add(r.session_id); uniq.push(r); } }
      setVideoSessions(prev => mergeStable(prev, uniq));
      setHasMore(data.pagination?.hasMore || false);
      setCurrentOffset(prev => prev + 10);
    } catch (e) {
      console.error('Failed to load more Sora videos:', e);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      if (!user) { setVideoSessions([]); setIsLoadingHistory(false); setHasConfirmedNoData(true); return; }
      setIsLoadingHistory(true);
      try {
        const res = await phFetch(`${vid.API_BASE}/api/sora2/history?limit=10&offset=0`);
        if (!res.ok) return;
        const data = await res.json();
        const rows = data.items || [];
        const uniq = [];
        const seen = new Set();
        for (const r of rows) { if (!seen.has(r.session_id)) { seen.add(r.session_id); uniq.push(r); } }
        setVideoSessions(prev => mergeStable(prev, uniq));
        setHasMore(data.pagination?.hasMore || false);
        setCurrentOffset(10);
        setHasConfirmedNoData(true);
      } catch (e) {
        console.error('Failed to load Sora history:', e);
        setHasConfirmedNoData(true);
      } finally {
        setIsLoadingHistory(false);
      }
    };
    run();
  }, [user, vid.API_BASE]);

  useEffect(() => {
    setHasConfirmedNoData(false);
    setHasMore(false);
    setIsLoadingMore(false);
    setCurrentOffset(0);
  }, [user]);

  // Polling logic for processing sessions
  const sessionsRef = useRef(videoSessions);
  useEffect(() => { sessionsRef.current = videoSessions; }, [videoSessions]);
  const hasProcessing = useMemo(() => videoSessions.some(s => s.status === 'processing'), [videoSessions]);

  useEffect(() => {
    if (!hasProcessing) return;
    const interval = setInterval(async () => {
      try {
        const res = await phFetch(`${vid.API_BASE}/api/sora2/history?limit=10&offset=0`);
        if (!res.ok) return;
        const data = await res.json();
        const rows = data.items || [];
        const uniq = [];
        const seen = new Set();
        for (const r of rows) { if (!seen.has(r.session_id)) { seen.add(r.session_id); uniq.push(r); } }
        
        // Detect newly completed sessions
        const prevList = sessionsRef.current || [];
        const prevStatusById = new Map(prevList.map(p => [p && (p.session_id || p.id), p && p.status]));
        const newlyCompleted = uniq.filter(s => 
          s.status === 'completed' && 
          prevStatusById.get(s.session_id) === 'processing' &&
          !s.isOptimistic
        );
        
        setVideoSessions(prev => mergeStable(prev, uniq));
        
        // Soft refresh credits if any sessions completed
        if (newlyCompleted.length > 0 && typeof checkAuth === 'function') {
          checkAuth(false);
        }
      } catch (e) {
        console.error('Sora polling error:', e);
      }
    }, 5000); // Poll every 5 seconds when there are processing sessions
    return () => clearInterval(interval);
  }, [hasProcessing, vid.API_BASE, checkAuth]);

  // Auto-recover stuck processing sessions every 30 seconds
  useEffect(() => {
    if (!hasProcessing) return;
    const interval = setInterval(async () => {
      try {
        const list = Array.isArray(sessionsRef.current) ? sessionsRef.current : [];
        const candidates = list.filter(s => {
          const ps = String(s.provider_status || '').toLowerCase();
          const st = String(s.status || '').toLowerCase();
          return (st === 'processing' || ['queued','processing','in_progress'].includes(ps)) && (s.session_id || s.id);
        });
        // Recover each candidate (best effort)
        for (const s of candidates) {
          const sid = s.session_id || s.id;
          if (!sid) continue;
          try {
            await phFetch(`${vid.API_BASE}/api/sora2/recover`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sid })
            }).catch(()=>{});
          } catch {}
        }
      } catch {}
    }, 60000);
    return () => clearInterval(interval);
  }, [hasProcessing, vid.API_BASE]);

  return (
    <AppShell
      selectedTool="sora2"
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
      mobileGenerateDisabled={!vid.videoPrompt.trim() || !!buttonCooldown}
      mobileCreditAmount={vid.priceCredits || 5}
      mobileSettingsContent={(
        <Sora2Panel
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
          onGenerateVideo={handleGenerateVideo}
          videoError={vid.videoError}
          videoSubmittingCount={vid.videoSubmittingCount}
          buttonCooldown={buttonCooldown}
          priceCredits={vid.priceCredits}
          priceLoading={vid.priceLoading}
          priceError={vid.priceError}
        />
      )}
      childrenLeft={(
        <Sora2Panel
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
          onGenerateVideo={handleGenerateVideo}
          videoError={vid.videoError}
          videoSubmittingCount={vid.videoSubmittingCount}
          buttonCooldown={buttonCooldown}
          priceCredits={vid.priceCredits}
          priceLoading={vid.priceLoading}
          priceError={vid.priceError}
        />
      )}
      childrenMain={(
        <>
          <div className="sticky top-0 z-10 -mx-6 px-6 pt-6 mb-4 bg-[#0a0a0a]">
            <h1 className="text-xl font-bold border-b border-white/10 pb-2">Generated Videos</h1>
          </div>
          <div className="space-y-6 relative">
            {/* GenerationGuard removed per request */}
            {isLoadingHistory ? (
              <div className="space-y-6">{[1,2,3].map(i => (
                <div key={i} className="bg-[#18181b] rounded-lg p-6 animate-pulse">
                  <div className="h-6 w-24 bg-white/10 rounded-full mb-2"></div>
                  <div className="h-48 bg-white/5 rounded-lg"></div>
                </div>
              ))}</div>
            ) : (!isLoadingHistory && videoSessions.length === 0) ? (
              <div className="text-center py-12"><p className="text-gray-400">No videos generated yet. Create your first video using the controls on the left!</p></div>
            ) : videoSessions.length > 0 ? (
              videoSessions.map((session) => (
                <Sora2HistoryCard
                  key={session.session_id}
                  session={session}
                  onManualCheck={() => {}}
                  onReusePrompt={(prompt, s) => {
                    vid.setVideoPrompt(prompt || '');
                    vid.setVideoModel('sora-2');
                    vid.setVideoAspectRatio(s?.aspect_ratio || '16:9');
                    vid.setVideoResolution(s?.resolution || '1080p');
                    vid.setVideoDuration(Number(s?.video_duration) || 5);
                  }}
                  estimateMs={avgEstimateMs}
                />
              ))
            ) : null}
            {hasMore && videoSessions.length > 0 && (
              <div className="flex justify-center pt-4">
                <button onClick={loadMoreVideos} disabled={isLoadingMore} className="px-6 py-2 bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:cursor-not-allowed text-white rounded-lg transition-colors">
                  {isLoadingMore ? 'Loading...' : 'Load More Videos'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    >
      <Suspense fallback={null}>
        <Sora2TemplateApplier vid={vid} />
      </Suspense>
    </AppShell>
  );
}


