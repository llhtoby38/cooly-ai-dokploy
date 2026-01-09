"use client";
import React from "react";
import { useApiBase } from "../hooks/useApiBase";
import phFetch from "../services/phFetch";
import { useAuth } from "../contexts/AuthContext";

export default function Sora2Panel({
  videoPrompt,
  setVideoPrompt,
  videoModel,
  setVideoModel,
  videoAspectRatio,
  setVideoAspectRatio,
  videoResolution,
  setVideoResolution,
  videoDuration,
  setVideoDuration,
  onGenerateVideo,
  videoError,
  videoSubmittingCount,
  buttonCooldown,
  priceCredits,
  priceLoading,
  priceError
}) {
  const [checkingCredits, setCheckingCredits] = React.useState(false);
  const [clickCooldown, setClickCooldown] = React.useState(false);
  const debounceRef = React.useRef(0);
  const API_BASE = useApiBase();
  const { applyOptimisticAvailableDelta, showCreditToast, getLastReservedAmount, checkAuth, user } = useAuth();

  const hidePro = String(process.env.NEXT_PUBLIC_SORA2_HIDE_PRO || process.env.NEXT_PUBLIC_SORA_HIDE_PRO || '').toLowerCase() === 'true';

  // Allow 1080p only for Pro model; base model supports 720p only
  const isProModel = String(videoModel || '').toLowerCase().includes('pro');
  const allowedResolutions = isProModel ? ['720p', '1080p'] : ['720p'];
  React.useEffect(() => {
    try {
      const current = String(videoResolution || '').toLowerCase();
      const ok = allowedResolutions.includes(current);
      if (!ok) setVideoResolution(allowedResolutions[0]);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoModel]);

  // If Pro is hidden but pro is selected (from persisted state), switch to base model
  React.useEffect(() => {
    if (hidePro && String(videoModel || '').toLowerCase().includes('pro')) {
      try { setVideoModel('sora-2'); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidePro]);

  const handleGenerateClick = async () => {
    const now = Date.now();
    if (now < debounceRef.current) return;
    debounceRef.current = now + 2000; // 2s gap
    if (!clickCooldown) { setClickCooldown(true); setTimeout(() => setClickCooldown(false), 2000); }

    try {
      setCheckingCredits(true);
      if (!(typeof priceCredits === 'number' && priceCredits > 0) || priceLoading) return;
      const required = priceCredits;
      const res = await phFetch(`${API_BASE}/api/user/credits`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      const have = Number((data && (data.available ?? data.credits)) ?? NaN);
      if (res.ok && Number.isFinite(have) && have >= required) {
        try {
          if (typeof applyOptimisticAvailableDelta === 'function') applyOptimisticAvailableDelta(-required);
          if (typeof showCreditToast === 'function') showCreditToast('reserved', required);
        } catch {}
        onGenerateVideo?.();
      } else {
        if (!user) {
          window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
        } else {
          // Redirect to billing page with returnTo parameter
          const currentPath = window.location.pathname;
          window.location.href = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
        }
      }
    } catch (_) {
      if (!user) {
        window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
      } else {
        // Redirect to billing page with returnTo parameter
        const currentPath = window.location.pathname;
        window.location.href = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
      }
      try {
        const hold = typeof getLastReservedAmount === 'function' ? Number(getLastReservedAmount()) : 0;
        const amount = hold > 0 ? hold : (typeof priceCredits === 'number' && priceCredits > 0 ? priceCredits : 0);
        if (typeof showCreditToast === 'function' && amount > 0) showCreditToast('released', amount);
        if (typeof checkAuth === 'function') setTimeout(() => checkAuth(false), 400);
      } catch {}
    } finally {
      setCheckingCredits(false);
    }
  };

  return (
    <>
      <h2 className="text-xl font-bold mb-4 border-b border-white/10 pb-2">Sora 2</h2>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="font-semibold">Prompt</label>
          <a
            href="https://platform.openai.com/docs/guides/sora"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-2 py-1 rounded transition-colors"
          >
            About Sora 2
          </a>
        </div>
        <textarea
          className="w-full p-2 rounded bg-[#232326] text-white focus:outline-none focus:ring border border-white/10"
          rows={4}
          value={videoPrompt}
          onChange={(e) => setVideoPrompt(e.target.value)}
          placeholder="Describe the video you want to generate..."
        />
      </div>
      <div>
        <label className="block mb-2 font-semibold">Model</label>
        <select
          className="w-full p-2 rounded bg-[#232326] text-white border border-white/10"
          value={videoModel}
          onChange={(e) => setVideoModel(e.target.value)}
        >
          <option value="sora-2">Sora 2</option>
          {!hidePro && (<option value="sora-2-pro">Sora 2 Pro</option>)}
        </select>
      </div>
      <div>
        <label className="block mb-2 font-semibold">Aspect Ratio</label>
        <select
          className="w-full p-2 rounded bg-[#232326] text-white border border-white/10"
          value={videoAspectRatio}
          onChange={(e) => setVideoAspectRatio(e.target.value)}
        >
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
        </select>
        <div className="text-xs text-white/50 mt-1">Only 16:9 and 9:16 are supported.</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block mb-2 font-semibold">Resolution</label>
          <select
            className="w-full p-2 rounded bg-[#232326] text-white border border-white/10"
            value={videoResolution}
            onChange={(e) => setVideoResolution(e.target.value)}
          >
            {allowedResolutions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block mb-2 font-semibold">Duration (s)</label>
          <select
            className="w-full p-2 rounded bg-[#232326] text-white border border-white/10"
            value={videoDuration}
            onChange={(e) => setVideoDuration(e.target.value)}
          >
            <option value={4}>4</option>
            <option value={8}>8</option>
            <option value={12}>12</option>
          </select>
        </div>
      </div>
      <button
        onClick={handleGenerateClick}
        disabled={checkingCredits || clickCooldown || !videoPrompt.trim() || !!buttonCooldown || priceLoading || !(typeof priceCredits === 'number' && priceCredits > 0)}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        {(videoSubmittingCount > 0 || checkingCredits || clickCooldown) && (
          <span className="inline-block h-5 w-5 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
        )}
        <span>{checkingCredits ? 'Checking credits…' : (buttonCooldown ? 'Generating…' : (clickCooldown ? 'Cooling down…' : (priceLoading ? 'Generate (…)': (typeof priceCredits === 'number' ? `Generate (${priceCredits} credits)` : 'Generate Video'))))}</span>
      </button>
      {priceError && (
        <div className="text-yellow-400 text-xs text-center mt-1">{priceError}</div>
      )}
      {videoError && (
        <div className="text-red-400 text-sm text-center">{videoError}</div>
      )}
    </>
  );
}


