"use client";
import React, { useRef, useState } from "react";
import { useApiBase } from "../hooks/useApiBase";
import phFetch from "../services/phFetch";
import { useAuth } from "../contexts/AuthContext";

export default function Veo3Panel({
  videoPrompt,
  setVideoPrompt,
  videoModel,
  setVideoModel,
  videoAspectRatio,
  setVideoAspectRatio,
  onGenerateVideo,
  videoError,
  videoSubmittingCount,
  buttonCooldown
}) {
  const API_BASE = useApiBase();
  const { applyOptimisticAvailableDelta, showCreditToast } = useAuth();
  const [checkingCredits, setCheckingCredits] = useState(false);
  const [clickCooldown, setClickCooldown] = useState(false);
  const debounceRef = useRef(0);
  return (
    <>
      <h2 className="text-xl font-bold mb-4 border-b border-white/10 pb-2">Google Veo 3</h2>
      <div>
        <label className="block mb-2 font-semibold">Prompt</label>
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
          <option value="veo3_fast">Veo 3 Fast</option>
          <option value="veo3_quality">Veo 3 Quality</option>
        </select>
      </div>
      <div>
        <label className="block mb-2 font-semibold">Aspect Ratio</label>
        <select
          className="w-full p-2 rounded bg-[#232326] text-white border border-white/10"
          value={videoAspectRatio}
          onChange={(e) => setVideoAspectRatio(e.target.value)}
        >
          <option value="16:9">16:9 Widescreen</option>
        </select>
        <div className="text-xs text-white/50 mt-1">Other aspect ratios are not supported for this model yet.</div>
      </div>
      <button
        onClick={async () => {
          const now = Date.now();
          if (now < debounceRef.current) return;
          debounceRef.current = now + 2000;
          if (!clickCooldown) { setClickCooldown(true); setTimeout(() => setClickCooldown(false), 2000); }

          try {
            setCheckingCredits(true);
            // Require a known price before deduction; Veo3 currently fixed 5, but guard on any future changes
            const required = 5;
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
              // Redirect to billing page with returnTo parameter
              const currentPath = window.location.pathname;
              window.location.href = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
            }
          } catch (_) {
            // Redirect to billing page with returnTo parameter
            const currentPath = window.location.pathname;
            window.location.href = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
          } finally {
            setCheckingCredits(false);
          }
        }}
        disabled={checkingCredits || clickCooldown || !videoPrompt.trim() || !!buttonCooldown}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        {(videoSubmittingCount > 0 || checkingCredits || clickCooldown) && (
          <span className="inline-block h-5 w-5 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
        )}
        <span>{checkingCredits ? 'Checking credits…' : (clickCooldown ? 'Cooling down…' : (buttonCooldown ? 'Generating…' : 'Generate Video (5 Credits)'))}</span>
      </button>
      {videoError && (
        <div className="text-red-400 text-sm text-center">{videoError}</div>
      )}
    </>
  );
}


