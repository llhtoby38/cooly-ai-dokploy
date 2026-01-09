"use client";
import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "../../components/AppShell";
import GenerationGuard from "../../components/GenerationGuard";
import Veo31Panel from "../../components/Veo31Panel";
import VideoHistoryCard from "../../components/history/VideoHistoryCard";
import { useAuth } from "../../contexts/AuthContext";
import { useVideoGenerationVeo31 } from "../../hooks/useVideoGenerationVeo31";
import phFetch from "../../services/phFetch";

function Veo31TemplateApplier({ vid }) {
  const searchParams = useSearchParams();
  const appliedRef = useRef(false);
  
  useEffect(() => {
    if (appliedRef.current) return;
    
    const slug = String(searchParams?.get('template') || '').toLowerCase();
    if (!slug) return;
    const run = async () => {
      try {
        const res = await phFetch(`${vid.API_BASE}/api/templates/veo31/${encodeURIComponent(slug)}`, { cache: 'no-store' });
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

export default function Veo31Page() {
  const { user, checkAuth } = useAuth();
  const vid = useVideoGenerationVeo31(user);

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
      return {
        ...old,
        ...inc,
        b2_url: inc.b2_url || old.b2_url || null,
        original_url: inc.original_url || old.original_url || null,
      };
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
    const optimisticId = `temp-${Date.now()}`;
    const optimistic = {
      session_id: optimisticId,
      prompt: vid.videoPrompt,
      model: vid.videoModel,
      credit_cost: (typeof vid.priceCredits === 'number' ? vid.priceCredits : null),
      aspect_ratio: vid.videoAspectRatio,
      resolution: vid.videoResolution,
      video_duration: vid.videoDuration,
      status: 'processing',
      provider_status: 'queued',
      created_at: new Date().toISOString(),
      completed_at: null,
      ref_image_url: vid.imageUrl || null,
      clientKey: optimisticId,
      isOptimistic: true
    };
    setVideoSessions(prev => [optimistic, ...prev]);
    setButtonCooldown(true);
    setTimeout(() => setButtonCooldown(false), 300);
    try {
      const result = await vid.onGenerateVideo();
      if (result && result.sessionId) {
        setVideoSessions(prev => prev.map(s => s.session_id === optimisticId ? { ...s, session_id: result.sessionId, isOptimistic: false } : s));
        // Force an early refresh right after successful start
        try {
          const res = await phFetch(`${vid.API_BASE}/api/veo31/history?limit=10&offset=0`, { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            const rows = (data.items || []).map(r => ({ ...r, provider_status: r.provider_status || r.status }));
            const uniq = [];
            const seen = new Set();
            for (const r of rows) { const id = r && (r.session_id || r.id); if (id && !seen.has(id)) { seen.add(id); uniq.push(r); } }
            setVideoSessions(prev => mergeStable(prev, uniq));
          }
        } catch {}
      } else {
        setVideoSessions(prev => prev.filter(s => s.session_id !== optimisticId));
      }
    } catch {
      setVideoSessions(prev => prev.filter(s => s.session_id !== optimisticId));
    }
  };

  // Initial history load (mirror Seedance/Sora)
  useEffect(() => {
    const run = async () => {
      if (!user) { setVideoSessions([]); setIsLoadingHistory(false); setHasConfirmedNoData(true); return; }
      setIsLoadingHistory(true);
      try {
        const res = await phFetch(`${vid.API_BASE}/api/veo31/history?limit=10&offset=0`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const rows = (data.items || []).map(r => ({ ...r, provider_status: r.provider_status || r.status }));
        const uniq = [];
        const seen = new Set();
        for (const r of rows) { const id = r && (r.session_id || r.id); if (id && !seen.has(id)) { seen.add(id); uniq.push(r); } }
        setVideoSessions(prev => mergeStable(prev, uniq));
        setHasMore(data.pagination?.hasMore || false);
        setCurrentOffset(10);
        setHasConfirmedNoData(true);
      } catch {
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

  // Polling for processing sessions
  const sessionsRef = useRef(videoSessions);
  useEffect(() => { sessionsRef.current = videoSessions; }, [videoSessions]);
  const hasProcessing = useMemo(() => videoSessions.some(s => s && (s.status === 'processing' || String(s.provider_status || '').toLowerCase() === 'queued' || String(s.provider_status || '').toLowerCase() === 'processing')), [videoSessions]);

  useEffect(() => {
    if (!hasProcessing) return;
    const interval = setInterval(async () => {
      try {
        const res = await phFetch(`${vid.API_BASE}/api/veo31/history?limit=10&offset=0`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const rows = data.items || [];
        const uniq = [];
        const seen = new Set();
        for (const r of rows) { const id = r && (r.session_id || r.id); if (id && !seen.has(id)) { seen.add(id); uniq.push(r); } }

        // Detect newly completed sessions for soft credit refresh
        const prevList = sessionsRef.current || [];
        const prevStatusById = new Map(prevList.map(p => [p && (p.session_id || p.id), p && p.status]));
        const newlyCompleted = uniq.filter(s => s && s.session_id && s.status === 'completed' && prevStatusById.get(s.session_id) === 'processing');

        setVideoSessions(prev => mergeStable(prev, uniq));
        if (newlyCompleted.length > 0 && typeof checkAuth === 'function') {
          checkAuth(false);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [hasProcessing, vid.API_BASE, checkAuth]);

  return (
    <AppShell
      selectedTool="veo31"
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
        try {
          const res = await fetch(`${vid.API_BASE}/api/user/credits`, { credentials: 'include', cache: 'no-store' });
          if (!res.ok) { window.location.href = `/billing?returnTo=${encodeURIComponent(window.location.pathname)}`; return; }
          const data = await res.json();
          const balance = Number((data?.available ?? data?.credits) || 0);
          const required = vid.priceCredits || 5;
          if (balance < required) { window.location.href = `/billing?returnTo=${encodeURIComponent(window.location.pathname)}`; return; }
          handleGenerateVideo();
        } catch { window.location.href = `/billing?returnTo=${encodeURIComponent(window.location.pathname)}`; }
      }}
      mobileGenerateDisabled={!vid.videoPrompt.trim() || !!buttonCooldown}
      mobileCreditAmount={vid.priceCredits || 5}
      childrenLeft={(
        <Veo31Panel
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
          title="Google Veo 3.1"
          aboutLabel="About Veo 3.1"
        />
      )}
      childrenMain={(
        <>
          <div className="sticky top-0 z-10 -mx-6 px-6 pt-6 mb-4 bg-[#0a0a0a]">
            <h1 className="text-xl font-bold border-b border-white/10 pb-2">Generated Videos</h1>
          </div>
          <div className="space-y-6 relative">
            {isLoadingHistory ? (
              <div className="space-y-6">
                {[1,2,3].map(i => (
                  <div key={i} className="bg-[#18181b] rounded-lg p-6 animate-pulse">
                    <div className="flex justify-between items-center mb-2">
                      <div className="h-6 w-24 bg-white/10 rounded-full" />
                      <div className="h-6 w-20 bg-white/10 rounded-full" />
                    </div>
                    <div className="h-48 bg-white/5 rounded-lg" />
                  </div>
                ))}
              </div>
            ) : (!isLoadingHistory && videoSessions.length === 0) ? (
              <div className="text-center py-12">
                <p className="text-gray-400">No videos generated yet. Create your first video using the controls on the left!</p>
              </div>
            ) : (
              videoSessions.map((session, idx) => (
                <VideoHistoryCard key={session.session_id || idx} session={session} estimateMs={avgEstimateMs} />
              ))
            )}
          </div>
        </>
      )}
    >
      <Suspense fallback={null}>
        <Veo31TemplateApplier vid={vid} />
      </Suspense>
    </AppShell>
  );
}


