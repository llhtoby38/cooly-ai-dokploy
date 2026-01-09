"use client";
import React, { useRef, useState } from "react";
import { useApiBase } from "../hooks/useApiBase";
import phFetch from "../services/phFetch";
import { useAuth } from "../contexts/AuthContext";
import { toErrorText } from "../utils/toErrorText";

export default function SeedreamPanel({
  prompt,
  setPrompt,
  model,
  setModel,
  outputs,
  setOutputs,
  aspectRatio,
  setAspectRatio,
  loading,
  error,
  onGenerate,
  submittingCount = 0,
  buttonCooldown = false,
  priceCredits,
  priceLoading,
  priceError,
  canGenerate
}) {
  const API_BASE = useApiBase();
  const { applyOptimisticAvailableDelta, showCreditToast, getLastReservedAmount, checkAuth, user } = useAuth();
  const [checkingCredits, setCheckingCredits] = useState(false);
  const [clickCooldown, setClickCooldown] = useState(false);
  const debounceRef = useRef(0);

  const handleGenerate = async (e) => {
    const now = Date.now();
    if (now < debounceRef.current) return;
    debounceRef.current = now + 2000; // 2s gap
    if (!clickCooldown) {
      setClickCooldown(true);
      setTimeout(() => setClickCooldown(false), 2000);
    }

    if (canGenerate === false) {
      if (!user) {
        window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
      } else {
        // Redirect to billing page with returnTo parameter
        const currentPath = window.location.pathname;
        window.location.href = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
      }
      return;
    }

    try {
      setCheckingCredits(true);
      // Require a valid computed price; never fall back to 1
      if (!(typeof priceCredits === 'number' && priceCredits > 0) || priceLoading) {
        return;
      }
      const required = priceCredits;
      const res = await phFetch(`${API_BASE}/api/user/credits`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      const have = Number((data && (data.available ?? data.credits)) ?? NaN);
      if (res.ok && Number.isFinite(have) && have >= required) {
        try {
          if (typeof applyOptimisticAvailableDelta === 'function') applyOptimisticAvailableDelta(-required);
          if (typeof showCreditToast === 'function') showCreditToast('reserved', required);
        } catch {}
        onGenerate(e);
      } else {
        // Redirect to billing page with returnTo parameter
        const currentPath = window.location.pathname;
        window.location.href = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
      }
    } catch (_) {
      // Redirect to billing page with returnTo parameter
      const currentPath = window.location.pathname;
      window.location.href = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
      // Panel-level catch: do not emit refund toast here to avoid duplicates; hook handles it
      try { if (typeof checkAuth === 'function') setTimeout(() => checkAuth(false), 400); } catch {}
    } finally {
      setCheckingCredits(false);
    }
  };
  return (
    <>
      <h2 className="text-xl font-bold mb-4 border-b border-white/10 pb-2">Seedream 3.0</h2>
      <div>
        <label className="block mb-2 font-semibold">Prompt</label>
        <textarea
          className="w-full p-2 rounded bg-[#232326] text-white focus:outline-none focus:ring border border-white/10"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your image..."
        />
      </div>
      <div>
        <label className="block mb-2 font-semibold">Model</label>
        <select
          className="w-full p-2 rounded bg-[#232326] text-white border border-white/10"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="seedream-3-0-t2i-250415">Seedream 3.0</option>
        </select>
      </div>
      <div>
        <label className="block mb-2 font-semibold">Aspect Ratio</label>
        <select
          className="w-full p-2 rounded bg-[#232326] text-white border border-white/10"
          value={aspectRatio}
          onChange={(e) => setAspectRatio(e.target.value)}
        >
          <option value="1:1">1:1 Square</option>
          <option value="16:9">16:9 Widescreen</option>
          <option value="9:16">9:16 Social story</option>
          <option value="2:3">2:3 Portrait</option>
          <option value="3:4">3:4 Traditional</option>
          <option value="1:2">1:2 Vertical</option>
          <option value="2:1">2:1 Horizontal</option>
          <option value="4:5">4:5 Social post</option>
          <option value="3:2">3:2 Standard</option>
          <option value="4:3">4:3 Classic</option>
        </select>
      </div>
      <div>
        <label className="block mb-2 font-semibold">Outputs</label>
        <select
          className="w-full p-2 rounded bg-[#232326] text-white border border-white/10"
          value={outputs}
          onChange={(e) => setOutputs(Number(e.target.value))}
        >
          {[...Array(8)].map((_, i) => (
            <option key={i + 1} value={i + 1}>{i + 1}</option>
          ))}
        </select>
      </div>
      <button
        onClick={handleGenerate}
        disabled={checkingCredits || clickCooldown || !prompt.trim() || buttonCooldown || priceLoading || !(typeof priceCredits === 'number' && priceCredits > 0)}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 mt-4"
        title={canGenerate === false ? 'Sign in or buy credits to generate' : undefined}
      >
        {(buttonCooldown || checkingCredits || clickCooldown) ? (
          <>
            <span className="inline-block h-5 w-5 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
            <span>{checkingCredits ? 'Checking credits…' : (clickCooldown ? 'Cooling down…' : 'Generating...')}</span>
          </>
        ) : (
          <span>{priceLoading ? 'Generate (…)' : (typeof priceCredits === 'number' ? `Generate (${priceCredits} credits)` : 'Generate')}</span>
        )}
      </button>
      {priceError && <div className="text-yellow-400 mt-1 text-xs text-center">{toErrorText(priceError)}</div>}
      {error && (
        <div className="text-red-400 mt-2">{toErrorText(error)}</div>
      )}
    </>
  );
}


