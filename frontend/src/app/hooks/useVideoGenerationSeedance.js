"use client";
import { useEffect, useState } from "react";
import { useApiBase } from "./useApiBase";
import { getDistinctId } from "../analytics/analyticsClient";

export function useVideoGenerationSeedance(user) {
  const API_BASE = useApiBase();
  let applyDelta = null;
  let showCreditToast = null;
  let getLastReservedAmount = null;
  let checkAuth = null;
  try {
    const ctx = require('../contexts/AuthContext');
    if (ctx && typeof ctx.useAuth === 'function') {
      const { applyOptimisticAvailableDelta, showCreditToast: sct, getLastReservedAmount: glra, checkAuth: ca } = ctx.useAuth();
      applyDelta = applyOptimisticAvailableDelta;
      showCreditToast = sct;
      getLastReservedAmount = glra;
      checkAuth = ca;
    }
  } catch {}
  const [videoPrompt, setVideoPrompt] = useState("");
  // Generic model selection; backend maps to provider-specific based on inputs
  const [videoModel, setVideoModel] = useState("seedance-1-0-pro");
  const [videoAspectRatio, setVideoAspectRatio] = useState("16:9");
  const [videoResolution, setVideoResolution] = useState("1080p");
  const [videoDuration, setVideoDuration] = useState(5);
  const [imageUrl, setImageUrl] = useState("");
  const [startFrameUrl, setStartFrameUrl] = useState("");
  const [endFrameUrl, setEndFrameUrl] = useState("");
  const [videoSubmittingCount, setVideoSubmittingCount] = useState(0);
  const [videoError, setVideoError] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const [priceCredits, setPriceCredits] = useState(null);
  const [priceExact, setPriceExact] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState("");
  const [applyingReuseSettings, setApplyingReuseSettings] = useState(false);

  // Fetch exact price whenever inputs change
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!videoModel || !videoResolution || !videoAspectRatio || !videoDuration) {
        setPriceCredits(null); setPriceExact(false); setPriceLoading(false); setPriceError("");
        return;
      }
      setPriceLoading(true); setPriceError("");
      try {
        const phId = (typeof window !== 'undefined') ? (getDistinctId() || undefined) : undefined;
        const res = await fetch(`${API_BASE}/api/seedance/price`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(phId ? { 'X-PostHog-Distinct-Id': phId } : {}) },
          credentials: 'include',
          body: JSON.stringify({
            model: videoModel,
            resolution: videoResolution,
            aspectRatio: videoAspectRatio,
            duration: Number(videoDuration) || undefined,
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (res.ok && typeof data.credits === 'number') {
            setPriceCredits(data.credits);
            setPriceExact(!!data.exact);
            setPriceError("");
          } else {
            setPriceCredits(null);
            setPriceExact(false);
            setPriceError(data.error || 'Price unavailable');
          }
        }
      } catch (e) {
        if (!cancelled) { setPriceCredits(null); setPriceExact(false); setPriceError('Price unavailable'); }
      } finally {
        if (!cancelled) setPriceLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [API_BASE, videoModel, videoResolution, videoAspectRatio, videoDuration]);

  const generateVideo = async (options = {}) => {
    if (!user) {
      window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
      return;
    }
    setVideoSubmittingCount(c => c + 1);
    setVideoError('');
    try {
      const phId = (typeof window !== 'undefined') ? (getDistinctId() || undefined) : undefined;
      const response = await fetch(`${API_BASE}/api/seedance/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(phId ? { 'X-PostHog-Distinct-Id': phId } : {}) },
        credentials: 'include',
        body: JSON.stringify({
          prompt: videoPrompt,
          model: videoModel,
          aspectRatio: videoAspectRatio,
          resolution: videoResolution,
          duration: Number(videoDuration) || undefined,
          imageUrl: imageUrl || null,
          startFrameUrl: startFrameUrl || null,
          endFrameUrl: endFrameUrl || null,
          clientKey: options.clientKey || undefined
        })
      });
      const data = await response.json();
      if (response.ok) {
        setSessionId(data.sessionId);
        // Success path: already deducted in panel; nothing to do here
        return data;
      } else {
        setVideoError(data.error || 'Failed to start video generation');
        // Refund immediately using known/estimated price + soft refresh on HTTP error
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
      // Network error: local refund using estimated price + soft refresh
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

  return {
    API_BASE,
    videoPrompt, setVideoPrompt,
    videoModel, setVideoModel,
    videoAspectRatio, setVideoAspectRatio,
    videoResolution, setVideoResolution,
    videoDuration, setVideoDuration,
    imageUrl, setImageUrl,
    startFrameUrl, setStartFrameUrl,
    endFrameUrl, setEndFrameUrl,
    videoSubmittingCount, videoError, sessionId,
    generateVideo,
    setVideoError,
    priceCredits, priceExact, priceLoading, priceError,
    applyingReuseSettings, setApplyingReuseSettings,
    applyTemplate: (settings = {}) => {
      try {
        if (!settings || typeof settings !== 'object') return;
        if (typeof settings.prompt === 'string') setVideoPrompt(settings.prompt);
        if (typeof settings.model === 'string') setVideoModel(settings.model);
        if (typeof settings.aspectRatio === 'string') setVideoAspectRatio(settings.aspectRatio);
        if (typeof settings.resolution === 'string') setVideoResolution(settings.resolution);
        if (typeof settings.duration !== 'undefined') setVideoDuration(Number(settings.duration) || 0);
        if (typeof settings.imageUrl === 'string') setImageUrl(settings.imageUrl);
        if (typeof settings.startFrameUrl === 'string') setStartFrameUrl(settings.startFrameUrl);
        if (typeof settings.endFrameUrl === 'string') setEndFrameUrl(settings.endFrameUrl);
      } catch {}
    }
  };
}


