"use client";
import { useEffect, useState } from "react";
import { useApiBase } from "./useApiBase";
import phFetch from "../services/phFetch";

export function useVideoGenerationVeo31(user) {
  const API_BASE = useApiBase();
  let applyDelta = null; // not used here (panel handles optimistic)
  let showCreditToast = null; // not used here (panel handles toast)
  let getLastReservedAmount = null; // not used here
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
  const [videoModel, setVideoModel] = useState("veo-3-1-quality");
  const [videoAspectRatio, setVideoAspectRatio] = useState("16:9");
  const [videoResolution, setVideoResolution] = useState("1080p");
  const [videoDuration, setVideoDuration] = useState(8);
  const [imageUrl, setImageUrl] = useState("");
  const [startFrameUrl, setStartFrameUrl] = useState("");
  const [endFrameUrl, setEndFrameUrl] = useState("");

  const [videoError, setVideoError] = useState("");
  const [videoSubmittingCount, setVideoSubmittingCount] = useState(0);
  const [buttonCooldown, setButtonCooldown] = useState(false);

  const [priceCredits, setPriceCredits] = useState(null);
  const [priceExact, setPriceExact] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPriceLoading(true);
      setPriceError("");
      try {
        const res = await phFetch(`${API_BASE}/api/veo31/price`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ model: videoModel, resolution: videoResolution, aspectRatio: videoAspectRatio, duration: Number(videoDuration) })
        });
        const j = await res.json();
        if (!cancelled) {
          setPriceCredits(j?.credits ?? null);
          setPriceExact(Boolean(j?.exact));
        }
      } catch (e) {
        if (!cancelled) setPriceError('Failed to load price');
      } finally {
        if (!cancelled) setPriceLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [API_BASE, videoModel, videoResolution, videoAspectRatio, videoDuration]);

  async function onGenerateVideo() {
    setVideoError("");
    setButtonCooldown(true);
    setTimeout(() => setButtonCooldown(false), 2000);
    setVideoSubmittingCount(c => c + 1);
    try {
      const clientKey = `veo31-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await phFetch(`${API_BASE}/api/veo31/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: videoPrompt, model: videoModel, aspectRatio: videoAspectRatio, resolution: videoResolution, duration: Number(videoDuration), imageUrl: imageUrl || null, startFrameUrl: startFrameUrl || null, endFrameUrl: endFrameUrl || null, clientKey })
      });
      const j = await res.json();
      if (!res.ok) {
        throw new Error(j?.error || 'Failed to start');
      }
      return j;
    } catch (e) {
      setVideoError(e?.message || 'Failed to generate');
      return null;
    } finally {
      setVideoSubmittingCount(c => Math.max(0, c - 1));
    }
  }

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
    onGenerateVideo,
    videoError,
    videoSubmittingCount,
    buttonCooldown,
    priceCredits,
    priceExact,
    priceLoading,
    priceError
  };
}


