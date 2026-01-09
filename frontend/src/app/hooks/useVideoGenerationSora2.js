"use client";
import { useEffect, useState } from "react";
import { useApiBase } from "./useApiBase";
import phFetch from "../services/phFetch";

export function useVideoGenerationSora2(user) {
  const API_BASE = useApiBase();
  let applyDelta = null;
  let showCreditToast = null;
  let checkAuth = null;
  try {
    const ctx = require('../contexts/AuthContext');
    if (ctx && typeof ctx.useAuth === 'function') {
      const { applyOptimisticAvailableDelta, showCreditToast: sct, checkAuth: ca } = ctx.useAuth();
      applyDelta = applyOptimisticAvailableDelta;
      showCreditToast = sct;
      checkAuth = ca;
    }
  } catch {}

  const [videoPrompt, setVideoPrompt] = useState("");
  const hidePro = String(process.env.NEXT_PUBLIC_SORA2_HIDE_PRO || process.env.NEXT_PUBLIC_SORA_HIDE_PRO || '').toLowerCase() === 'true';
  const [videoModel, setVideoModel] = useState(hidePro ? "sora-2" : "sora-2-pro");
  const [videoAspectRatio, setVideoAspectRatio] = useState("16:9");
  const [videoResolution, setVideoResolution] = useState(hidePro ? "720p" : "1080p");
  const [videoDuration, setVideoDuration] = useState(8);
  const [videoSubmittingCount, setVideoSubmittingCount] = useState(0);
  const [videoError, setVideoError] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const [priceCredits, setPriceCredits] = useState(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState("");

  // Generate via Sora 2 API
  const generateVideo = async (options = {}) => {
    if (!user) {
      window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
      return null;
    }
    setVideoSubmittingCount(c => c + 1);
    setVideoError('');
    try {
      const response = await phFetch(`${API_BASE}/api/sora2/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: videoPrompt,
          model: videoModel,
          aspectRatio: videoAspectRatio,
          resolution: videoResolution,
          duration: Number(videoDuration) || undefined,
          clientKey: options.clientKey || undefined
        })
      });
      const data = await response.json();
      if (response.ok) {
        setSessionId(data.sessionId);
        return data;
      } else {
        setVideoError(data.error || 'Failed to start video generation');
        // Refund locally using known/estimated price + soft refresh
        try {
          const amount = (typeof priceCredits === 'number' && priceCredits > 0) ? priceCredits : 5;
          if (applyDelta && Number.isFinite(amount)) applyDelta(amount);
          if (typeof showCreditToast === 'function' && amount > 0) showCreditToast('released', amount);
          if (typeof checkAuth === 'function') setTimeout(() => checkAuth(false), 400);
        } catch {}
        return null;
      }
    } catch (e) {
      setVideoError(e.message || 'Network error');
      // Refund locally + soft refresh
      try {
        const amount = (typeof priceCredits === 'number' && priceCredits > 0) ? priceCredits : 5;
        if (applyDelta && Number.isFinite(amount)) applyDelta(amount);
        if (typeof showCreditToast === 'function' && amount > 0) showCreditToast('released', amount);
        if (typeof checkAuth === 'function') setTimeout(() => checkAuth(false), 400);
      } catch {}
      return null;
    } finally {
      setVideoSubmittingCount(c => Math.max(0, c - 1));
    }
  };

  // Fetch price whenever inputs change
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!videoModel || !videoResolution || !videoDuration) { setPriceCredits(null); setPriceError(""); return; }
      setPriceLoading(true); setPriceError("");
      try {
        const res = await phFetch(`${API_BASE}/api/sora2/price`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: videoModel, resolution: videoResolution, duration: Number(videoDuration) || 0 })
        });
        const data = await res.json().catch(()=>({}));
        if (!cancelled) {
          if (res.ok && typeof data.credits === 'number') setPriceCredits(data.credits);
          else { setPriceCredits(null); setPriceError(data.error || 'Price unavailable'); }
        }
      } catch (_) { if (!cancelled) { setPriceCredits(null); setPriceError('Price unavailable'); } }
      finally { if (!cancelled) setPriceLoading(false); }
    };
    run();
    return () => { cancelled = true; };
  }, [API_BASE, videoModel, videoResolution, videoDuration]);

  return {
    API_BASE,
    videoPrompt, setVideoPrompt,
    videoModel, setVideoModel,
    videoAspectRatio, setVideoAspectRatio,
    videoResolution, setVideoResolution,
    videoDuration, setVideoDuration,
    videoSubmittingCount, videoError, sessionId,
    generateVideo,
    setVideoError,
    priceCredits, priceLoading, priceError
  };
}


