import { useState, useCallback, useEffect } from 'react';
import { useApiBase, useMockMode } from './useApiBase';
import apiService from '../services/apiService';
import phFetch from '../services/phFetch';
import { getDistinctId } from '../analytics/analyticsClient';

export function useSeedream4Generation(user) {
  const API_BASE = useApiBase();
  const applyDeltaRef = { current: null };
  const showToastRef = { current: null };
  const checkAuthRef = { current: null };
  const getLastReservedRef = { current: null };
  try {
    // lazy import to avoid bundler cycles
    const ctx = require('../contexts/AuthContext');
    if (ctx && typeof ctx.useAuth === 'function') {
      const { applyOptimisticAvailableDelta, showCreditToast, checkAuth, getLastReservedAmount } = ctx.useAuth();
      applyDeltaRef.current = applyOptimisticAvailableDelta;
      showToastRef.current = showCreditToast;
      checkAuthRef.current = checkAuth;
      getLastReservedRef.current = getLastReservedAmount;
    }
  } catch {}
  
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(process.env.NEXT_PUBLIC_SEEDREAM4_MODEL_ID || 'seedream-4-0-250828');
  const [outputs, setOutputs] = useState(4);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [size, setSize] = useState('1K');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [guidanceScale, setGuidanceScale] = useState(3);
  const [refImageUrl, setRefImageUrl] = useState('');
  const [refImageUrls, setRefImageUrls] = useState([]); // New: array for multiple reference images
  const [refImageAspectRatio, setRefImageAspectRatio] = useState('');
  const [seed, setSeed] = useState('');
  const [watermark, setWatermark] = useState(false);
  const [computedSize, setComputedSize] = useState('');
  const [derivedSizes, setDerivedSizes] = useState({});
  const [isReuseMode, setIsReuseMode] = useState(false);
  const [applyingReuseSettings, setApplyingReuseSettings] = useState(false);
  const [resolutionIsMatchFirst, setResolutionIsMatchFirst] = useState(false);
  const [lockResolutionFromTemplate, setLockResolutionFromTemplate] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [priceCredits, setPriceCredits] = useState(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState('');

  const generate = useCallback(async (options = {}) => {
    if (!user) {
      window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
      return null;
    }

    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      // Always prefer the explicit Final size shown in UI (computedSize) if available or an override
      const overrideSize = typeof options.forceSize === 'string' ? options.forceSize : null;
      const sizeToken = typeof size === 'string' ? size.toUpperCase() : '';
      const isToken = sizeToken === '1K' || sizeToken === '2K' || sizeToken === '4K';
      const isExactWxH = typeof computedSize === 'string' && /^(\d{2,5})x(\d{2,5})$/i.test(computedSize);
      const payloadSize = overrideSize || (isExactWxH ? computedSize : (isToken ? sizeToken : sizeToken || size));

      const payload = {
        prompt: prompt.trim(),
        model,
        outputs,
        // Explicitly communicate the user's AR intent for accurate reuse later
        aspect_ratio_mode: (aspectRatio === 'match_input' ? 'match_input' : (aspectRatio ? 'fixed' : 'none')),
        aspect_ratio: (aspectRatio === 'match_input' ? (refImageAspectRatio || undefined) : aspectRatio),
        size: payloadSize,
        guidance_scale: guidanceScale,
        negative_prompt: negativePrompt || undefined,
        ref_image_url: refImageUrl || undefined,
        ref_image_urls: refImageUrls || undefined, // New: array of multiple reference images
        seed: seed ? Number(seed) : undefined,
        watermark,
        // Include clientKey for proper session matching
        clientKey: options.clientKey || undefined,
      };

      const response = await apiService.post(`${API_BASE}/api/images/seedream4/generate`, payload);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Generation failed');
      }

      return data;
    } catch (err) {
      const errorMessage = err.message || 'Failed to generate image';
      setError(errorMessage);
      // On failure, do not mutate available directly (SSE 'released' will restore it).
      // Show a refund toast and force a server refresh as fallback.
      try {
        const lastHold = getLastReservedRef.current ? Number(getLastReservedRef.current()) : 0;
        const toShow = (lastHold > 0 ? lastHold : ((typeof priceCredits === 'number' && priceCredits > 0) ? priceCredits : (typeof outputs === 'number' ? outputs : 1)));
        if (showToastRef.current && Number.isFinite(toShow) && toShow > 0) {
          showToastRef.current('released', toShow);
        }
        // Soft resync in case SSE is interrupted by network/db issues
        setTimeout(() => { try { checkAuthRef.current && checkAuthRef.current(false); } catch {} }, 400);
      } catch {}
      throw err;
    } finally {
      setLoading(false);
    }
  }, [prompt, model, outputs, aspectRatio, size, guidanceScale, negativePrompt, refImageUrl, refImageUrls, seed, watermark, API_BASE, computedSize]);

  // Price lookup: same endpoint as Seedream 3 (per-output)
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!model || !outputs) { setPriceCredits(null); setPriceError(''); return; }
      setPriceLoading(true); setPriceError('');
      try {
        const res = await phFetch(`${API_BASE}/api/image/price`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, outputs })
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (res.ok && typeof data.credits === 'number') {
            setPriceCredits(data.credits);
          } else { setPriceCredits(null); setPriceError(data.error || 'Price unavailable'); }
        }
      } catch {
        if (!cancelled) { setPriceCredits(null); setPriceError('Price unavailable'); }
      } finally { if (!cancelled) setPriceLoading(false); }
    };
    run();
    return () => { cancelled = true; };
  }, [API_BASE, model, outputs]);

  return {
    prompt,
    setPrompt,
    model,
    setModel,
    outputs,
    setOutputs,
    aspectRatio,
    setAspectRatio,
    size,
    setSize,
    negativePrompt,
    setNegativePrompt,
    guidanceScale,
    setGuidanceScale,
    refImageUrl,
    setRefImageUrl,
    refImageUrls,
    setRefImageUrls,
    refImageAspectRatio,
    setRefImageAspectRatio,
    seed,
    setSeed,
    watermark,
    setWatermark,
    computedSize,
    setComputedSize,
    derivedSizes,
    setDerivedSizes,
    isReuseMode,
    setReuseMode: setIsReuseMode,
    applyingReuseSettings,
    setApplyingReuseSettings,
    resolutionIsMatchFirst,
    setResolutionIsMatchFirst,
    lockResolutionFromTemplate,
    loading,
    error,
    setError,
    generate,
    API_BASE,
    priceCredits,
    priceLoading,
    priceError,
    applyTemplate: (settings = {}, options = {}) => {
      try {
        if (!settings || typeof settings !== 'object') return;
        setApplyingReuseSettings(true);

        // Core fields
        if (typeof settings.prompt === 'string') setPrompt(settings.prompt);
        if (typeof settings.negative_prompt === 'string') setNegativePrompt(settings.negative_prompt);
        if (typeof settings.model === 'string') setModel(settings.model);
        if (typeof settings.outputs === 'number') setOutputs(settings.outputs);
        if (typeof settings.aspect_ratio === 'string') setAspectRatio(settings.aspect_ratio);
        if (typeof settings.guidance_scale === 'number') setGuidanceScale(settings.guidance_scale);
        if (typeof settings.ref_image_url === 'string') setRefImageUrl(settings.ref_image_url);
        if (Array.isArray(settings.ref_image_urls)) setRefImageUrls(settings.ref_image_urls);
        if (typeof settings.seed !== 'undefined') setSeed(String(settings.seed));
        if (typeof settings.watermark === 'boolean') setWatermark(settings.watermark);

        // Preserve the exact intended final size for display/export
        if (typeof settings.computed_size === 'string') setComputedSize(settings.computed_size);

        // Resolution selection handling
        const lockResolution = !!options.lockResolution;
        if (lockResolution) setLockResolutionFromTemplate(true);
        const val = typeof settings.size === 'string' ? settings.size : (typeof settings.computed_size === 'string' ? settings.computed_size : '');
        if (val) {
          const v = String(val).toLowerCase();
          const wxh = /^\d{2,5}x\d{2,5}$/i.test(v);
          if (lockResolution) {
            // Ensure UI does not render the Match First sentinel
            try { setResolutionIsMatchFirst(false); } catch {}
            // During template apply, prefer token selection to avoid selecting the "Match First Image" sentinel
            if (wxh) {
              try {
                const [w, h] = v.split('x').map(n => parseInt(n, 10));
                const maxSide = Math.max(w || 0, h || 0);
                const token = maxSide >= 3840 ? '4K' : (maxSide >= 1920 ? '2K' : '1K');
                setSize(token);
              } catch {
                setSize('2K');
              }
            } else {
              setSize(val.toUpperCase()); // 1K/2K/4K
            }
          } else {
            // Legacy behavior: set the provided value directly
            setSize(wxh ? v : val.toUpperCase());
          }
        }
      } catch {}
      finally {
        setTimeout(() => setApplyingReuseSettings(false), 0);
      }
    }
  };
}
