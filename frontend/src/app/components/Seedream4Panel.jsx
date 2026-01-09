"use client";
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { toErrorText } from "../utils/toErrorText";
import { createPortal } from "react-dom";
import { DndContext, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApiBase } from "../hooks/useApiBase";
import { useAuth } from "../contexts/AuthContext";
import phFetch from "../services/phFetch";

function HoverInfo({ text }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const anchorRef = useRef(null);

  const show = () => {
    try {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pad = 8;
      const maxWidth = 220;
      let left = rect.left;
      if (left + maxWidth > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pad - maxWidth);
      if (left < pad) left = pad;
      const top = Math.min(window.innerHeight - pad, rect.bottom + 8);
      setPos({ top, left });
      setVisible(true);
    } catch {}
  };

  const hide = () => setVisible(false);

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex items-center justify-center cursor-help text-white/60 hover:text-white/80"
        onMouseEnter={show}
        onMouseLeave={hide}
        aria-label="Info"
        role="img"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="block"
        >
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 7.25v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="4.75" r="0.9" fill="currentColor" />
        </svg>
      </span>
      {visible && createPortal(
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, maxWidth: 220, zIndex: 9999 }}
          className="p-2 text-xs bg-black/80 text-gray-200 rounded shadow-lg border border-white/10 pointer-events-none whitespace-normal break-words leading-snug"
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
}

export default function Seedream4Panel({
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
  // expose computed size to ensure payload matches UI
  computedSize,
  setComputedSize,
  derivedSizes = {},
  guidanceScale,
  setGuidanceScale,
  negativePrompt,
  setNegativePrompt,
  refImageUrl,
  setRefImageUrl,
  refImageUrls,
  setRefImageUrls,
  refImageAspectRatio,
  setRefImageAspectRatio,
  isReuseMode = false,
  setReuseMode,
  applyingReuseSettings = false,
  setApplyingReuseSettings,
  resolutionIsMatchFirst = false,
  setResolutionIsMatchFirst,
  seed,
  setSeed,
  watermark,
  setWatermark,
  loading,
  error,
  onGenerate,
  submittingCount = 0,
  buttonCooldown = false,
  priceCredits,
  priceLoading,
  priceError,
  canGenerate,
  lockResolutionFromTemplate = false,
  imageSyncRef  // Parent-level ref to track synced state across unmounts
}) {
  // Debug: Log when component mounts/unmounts
  useEffect(() => {
    console.log('🎨 [Seedream4Panel] Component MOUNTED');
    return () => console.log('💀 [Seedream4Panel] Component UNMOUNTING');
  }, []);
  
  const [refUploading, setRefUploading] = useState(false);
  const [refImages, setRefImages] = useState([]);
  const [loadingImageIds, setLoadingImageIds] = useState(() => new Set());
  const loadedOnceRef = useRef(new Set());
  const [firstDims, setFirstDims] = useState(null); // { w, h }
  const [detectingDimensions, setDetectingDimensions] = useState(false); // Loading state for dimension detection
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [insertionIndex, setInsertionIndex] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const API_BASE = useApiBase();
  const { applyOptimisticAvailableDelta, showCreditToast, user } = useAuth();
  const reorderPendingRef = useRef(false);
  const [checkingCredits, setCheckingCredits] = useState(false);
  const [clickCooldown, setClickCooldown] = useState(false);
  const debounceRef = useRef(0);
  
  // Flag to prevent child→parent sync when change came from parent→child sync
  const isSyncingFromParentRef = useRef(false);
  
  // Ref for file input to trigger file picker on click
  const fileInputRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const sortableItems = useMemo(() => refImages.map(img => img.id), [refImages]);

  // Compute derived WxH for tokens (1K/2K/4K) given first image aspect
  const lastAspectRef = useRef('');
  useEffect(() => {
    if (refImageAspectRatio && /\d+\s*[:/]\s*\d+/.test(refImageAspectRatio)) {
      lastAspectRef.current = refImageAspectRatio;
    }
  }, [refImageAspectRatio]);

  const derivedSizeForToken = useMemo(() => {
    // Always recalculate when in "Match First Image" mode to ensure current first image is used
    // This handles cases where images may have been reordered since the original generation
    if (aspectRatio === 'match_input') {
      // Effective aspect for derivation: prefer live ref aspect, fallback to cached, else selected ratio
      const source = (aspectRatio === 'match_input'
        ? ((firstDims ? `${firstDims.w}:${firstDims.h}` : '') || refImageAspectRatio || lastAspectRef.current || '')
        : (aspectRatio || '')).trim();
      const m = source.match(/^(\d+)\s*[:/]\s*(\d+)$/);
      if (!m) return null;
      let aw = Math.max(1, parseInt(m[1], 10));
      let ah = Math.max(1, parseInt(m[2], 10));
      // simplify ratio for preset matching
      const gcd = (a,b)=> b===0?a:gcd(b,a%b);
      const g = gcd(aw, ah);
      const sw = Math.round(aw / g);
      const sh = Math.round(ah / g);
      const key = `${sw}:${sh}`;
      const PRESETS = {
        '1:1': { '1K': '1280×1280', '2K': '1920×1920', '4K': '3840×3840' },
        '16:9': { '1K': '1280×720', '2K': '1920×1080', '4K': '3840×2160' },
        '9:16': { '1K': '720×1280', '2K': '1080×1920', '4K': '2160×3840' },
        '21:9': { '1K': '—', '2K': '1920×823', '4K': '3840×1646' },
        '2:3': { '1K': '853×1280', '2K': '1280×1920', '4K': '2560×3840' },
        '3:4': { '1K': '960×1280', '2K': '1440×1920', '4K': '2880×3840' },
        '1:2': { '1K': '—', '2K': '960×1920', '4K': '1920×3840' },
        '2:1': { '1K': '—', '2K': '1920×960', '4K': '3840×1920' },
        '4:5': { '1K': '1024×1280', '2K': '1536×1920', '4K': '3072×3840' },
        '3:2': { '1K': '1280×853', '2K': '1920×1280', '4K': '3840×2560' },
        '4:3': { '1K': '1280×960', '2K': '1920×1440', '4K': '3840×2880' }
      };
      if (PRESETS[key]) {
        return PRESETS[key];
      }
      const calc = (token) => {
        const baseWidth = token === '4K' ? 3840 : token === '2K' ? 1920 : 1280;
        let w, h;
        if (sw >= sh) {
          w = baseWidth;
          h = Math.round(baseWidth * (sh / sw));
        } else {
          h = baseWidth;
          w = Math.round(baseWidth * (sw / sh));
        }
        return `${w}×${h}`;
      };
      return { '1K': calc('1K'), '2K': calc('2K'), '4K': calc('4K') };
    }
    
    // For non-"Match First Image" modes, use saved derived sizes if available
    if (Object.keys(derivedSizes).length > 0) {
      return derivedSizes;
    }
    
    // Fallback calculation for other aspect ratios
    const source = (aspectRatio || '').trim();
    const m = source.match(/^(\d+)\s*[:/]\s*(\d+)$/);
    if (!m) return null;
    let aw = Math.max(1, parseInt(m[1], 10));
    let ah = Math.max(1, parseInt(m[2], 10));
    // simplify ratio for preset matching
    const gcd = (a,b)=> b===0?a:gcd(b,a%b);
    const g = gcd(aw, ah);
    const sw = Math.round(aw / g);
    const sh = Math.round(ah / g);
    const key = `${sw}:${sh}`;
    const PRESETS = {
      '1:1': { '1K': '1280×1280', '2K': '1920×1920', '4K': '3840×3840' },
      '16:9': { '1K': '1280×720', '2K': '1920×1080', '4K': '3840×2160' },
      '9:16': { '1K': '720×1280', '2K': '1080×1920', '4K': '2160×3840' },
      '21:9': { '1K': '—', '2K': '1920×823', '4K': '3840×1646' },
      '2:3': { '1K': '853×1280', '2K': '1280×1920', '4K': '2560×3840' },
      '3:4': { '1K': '960×1280', '2K': '1440×1920', '4K': '2880×3840' },
      // 1K not provided for 1:2 and 2:1 per latest table
      '1:2': { '1K': '—', '2K': '960×1920', '4K': '1920×3840' },
      '2:1': { '1K': '—', '2K': '1920×960', '4K': '3840×1920' },
      '4:5': { '1K': '1024×1280', '2K': '1536×1920', '4K': '3072×3840' },
      '3:2': { '1K': '1280×853', '2K': '1920×1280', '4K': '3840×2560' },
      '4:3': { '1K': '1280×960', '2K': '1920×1440', '4K': '3840×2880' }
    };
    if (PRESETS[key]) {
      return PRESETS[key];
    }
    const calc = (token) => {
      const baseWidth = token === '4K' ? 3840 : token === '2K' ? 1920 : 1280;
      let w, h;
      if (sw >= sh) {
        w = baseWidth;
        h = Math.round(baseWidth * (sh / sw));
      } else {
        h = baseWidth;
        w = Math.round(baseWidth * (sw / sh));
      }
      return `${w}×${h}`;
    };
    return { '1K': calc('1K'), '2K': calc('2K'), '4K': calc('4K') };
  }, [aspectRatio, refImageAspectRatio, derivedSizes, firstDims]);

  const finalSizeText = useMemo(() => {
    const s = String(size || '').toUpperCase();
    const isWxH = /^\d{2,5}x\d{2,5}$/i.test(String(size || ''));
    if (isWxH) return String(size).toLowerCase().replace('x', '×');
    // Prefer computedSize text if present (exact), otherwise derived label
    if (derivedSizeForToken) return derivedSizeForToken[s] || '';
    return '';
  }, [size, derivedSizeForToken]);

  // When aspectRatio changes to 'match_input', set refImageAspectRatio from firstDims
  useEffect(() => {
    if (aspectRatio === 'match_input' && firstDims && firstDims.w && firstDims.h) {
      if (typeof setRefImageAspectRatio === 'function') {
        setRefImageAspectRatio(`${firstDims.w}:${firstDims.h}`);
      }
    }
  }, [aspectRatio, firstDims, setRefImageAspectRatio]);

  // Keep computedSize (sent to backend) in sync with UI selection
  useEffect(() => {
    if (typeof setComputedSize !== 'function') return;
    const s = String(size || '').toUpperCase();
    if (/^\d{2,5}x\d{2,5}$/i.test(String(size || ''))) {
      setComputedSize(String(size));
    } else if (derivedSizeForToken && derivedSizeForToken[s]) {
      setComputedSize(derivedSizeForToken[s].replace('×','x'));
    } else {
      setComputedSize('');
    }
  }, [size, derivedSizeForToken, setComputedSize]);

  // If AR = Match First Image but the first image dims aren’t ready yet, block generate
  const matchFirstPending = useMemo(() => {
    return String(aspectRatio) === 'match_input' && (!firstDims || !firstDims.w || !firstDims.h);
  }, [aspectRatio, firstDims]);

  // Microcopy to explain whether the size is derived or exact
  const finalSizeNote = useMemo(() => {
    if (!finalSizeText) return 'Resolution will be applied using the selected aspect ratio.';
    const isWxH = /^\d{2,5}x\d{2,5}$/i.test(String(size || ''));
    const isExactMatchFirst = isWxH && firstDims && String(size).toLowerCase() === `${firstDims.w}x${firstDims.h}`;
    if (isExactMatchFirst) return `Final size: ${finalSizeText} · exact from first image`;
    if (isWxH) return `Final size: ${finalSizeText} · exact`;
    const effAr = (aspectRatio === 'match_input' ? (refImageAspectRatio || 'first image') : aspectRatio || 'aspect');
    return `Final size: ${finalSizeText} · derived from ${effAr}`;
  }, [finalSizeText, size, firstDims, aspectRatio, refImageAspectRatio]);

  // Helpers for lock state
  const isExplicitWxH = useMemo(() => /^(\d{2,5})x(\d{2,5})$/i.test(String(size || '')), [size]);
  const isARLocked = useMemo(() => {
    // Lock whenever user selected the Match First Image option, even if size was mutated elsewhere
    if (resolutionIsMatchFirst) return true;
    if (!isExplicitWxH || !firstDims) return false;
    return String(size).toLowerCase() === `${firstDims.w}x${firstDims.h}`;
  }, [resolutionIsMatchFirst, isExplicitWxH, firstDims, size]);

  // Note: resolutionIsMatchFirst is now controlled by parent component during reuse

  // Disable 1K when the current AR has no 1K size (21:9, 1:2, 2:1)
  const oneKDisabled = useMemo(() => {
    const ar = String(aspectRatio || '').trim();
    if (ar === '21:9' || ar === '1:2' || ar === '2:1') return true;
    const label = derivedSizeForToken?.['1K'];
    return !!derivedSizeForToken && (!label || label === '—');
  }, [derivedSizeForToken, aspectRatio]);

  // Disable 1K when derived 1K WxH area is below provider minimum (921,600 px)
  const is1KTooSmall = useMemo(() => {
    const txt = derivedSizeForToken?.['1K'];
    if (!txt || txt === '—') return false; // handled by oneKDisabled
    const m = String(txt).replace('×','x').toLowerCase().match(/^(\d{2,5})x(\d{2,5})$/);
    if (!m) return false;
    const w = parseInt(m[1], 10) || 0;
    const h = parseInt(m[2], 10) || 0;
    return w > 0 && h > 0 && (w * h) < 921600;
  }, [derivedSizeForToken]);

  // Disable Match First Image when first image WxH is under BytePlus minimum (921,600 px)
  const matchFirstTooSmall = useMemo(() => {
    if (!firstDims || !firstDims.w || !firstDims.h) return false;
    return (Number(firstDims.w) * Number(firstDims.h)) < 921600;
  }, [firstDims]);

  // Disable Match First Image when first image WxH exceeds provider max (16,777,216 px)
  const matchFirstTooBig = useMemo(() => {
    if (!firstDims || !firstDims.w || !firstDims.h) return false;
    return (Number(firstDims.w) * Number(firstDims.h)) > 16777216;
  }, [firstDims]);

  // If Match First Image becomes invalid (too small/too big) and is selected, auto-pick the next valid option
  useEffect(() => {
    if (!firstDims || !firstDims.w || !firstDims.h) return;
    if (!(matchFirstTooSmall || matchFirstTooBig)) return;
    const exact = `${firstDims.w}x${firstDims.h}`.toLowerCase();
    const current = String(size || '').toLowerCase();
    const isMatchFirstSelected = resolutionIsMatchFirst || current === exact;
    if (!isMatchFirstSelected) return;

    const nextToken = (!oneKDisabled && !is1KTooSmall) ? '1K' : '2K';
    setSize(nextToken);
    if (derivedSizeForToken && typeof setComputedSize === 'function') {
      const label = nextToken.toUpperCase();
      const derived = derivedSizeForToken[label] ? derivedSizeForToken[label].replace('×','x') : '';
      setComputedSize(derived);
    }
    setResolutionIsMatchFirst(false);
  }, [matchFirstTooSmall, matchFirstTooBig, firstDims, size, resolutionIsMatchFirst, oneKDisabled, is1KTooSmall, derivedSizeForToken, setComputedSize, setSize, setResolutionIsMatchFirst]);

  // If 1K is invalid under current AR and selected, bump to 2K
  useEffect(() => {
    if (String(size).toUpperCase() === '1K' && (oneKDisabled || is1KTooSmall)) {
      setSize('2K');
      if (derivedSizeForToken && typeof setComputedSize === 'function') {
        const next = derivedSizeForToken['2K'] ? derivedSizeForToken['2K'].replace('×', 'x') : '';
        setComputedSize(next);
      }
    }
  }, [oneKDisabled, is1KTooSmall, size, derivedSizeForToken, setComputedSize]);

  const Tile = ({ value, labelTop, labelBottom, iconAR }) => {
    const selected = String(aspectRatio) === value;
    const disabled = isARLocked || (value === 'match_input' && !firstDims);
    const handleClick = () => {
      if (disabled) return;
      const next = value;
      const isExplicit = /^(\d{2,5})x(\d{2,5})$/i.test(String(size || ''));
      if (next !== 'match_input' && isExplicit) {
        try {
          const [w, h] = String(size).toLowerCase().split('x').map(n => parseInt(n, 10));
          const token = Math.max(w, h) >= 3840 ? '4K' : Math.max(w, h) >= 1920 ? '2K' : '1K';
          setSize(token);
        } catch { setSize('1K'); }
      }
      setAspectRatio(next);
    };
    let iconNode = null;
    if (value !== 'match_input' && iconAR && /\d+:\d+/.test(iconAR)) {
      const [w, h] = iconAR.split(':').map(n => parseInt(n, 10) || 1);
      const landscape = w >= h;
      const innerStyle = {
        aspectRatio: `${w} / ${h}`,
        width: landscape ? '100%' : undefined,
        height: landscape ? undefined : '100%'
      };
      iconNode = (
        <div className="w-6 h-6 flex items-center justify-center">
          <div style={innerStyle} className="border border-white/60 bg-transparent"></div>
        </div>
      );
    }
    return (
      <button
        type="button"
        disabled={disabled}
        title={disabled ? 'Locked by Resolution: Match First Image' : undefined}
        onClick={handleClick}
        className={`h-16 rounded border flex flex-col items-center justify-center ${iconNode ? 'gap-1' : 'gap-0'} text-xs ${selected ? 'border-blue-400 bg-blue-400/10 text-white' : 'border-white/10 text-white/80 hover:border-white/20 hover:text-white'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {iconNode}
        <div className="leading-tight text-center">
          <div>{labelTop}</div>
          {labelBottom ? <div>{labelBottom}</div> : null}
        </div>
      </button>
    );
  };

  // Normalize selection: if Resolution holds an explicit WxH that is NOT the first image's exact size,
  // convert it to the nearest token (1K/2K/4K) so the dropdown reflects only allowed choices.
  useEffect(() => {
    // Do not normalize while reuse is actively applying settings
    if (applyingReuseSettings) return;
    const s = String(size || '').toLowerCase();
    const m = s.match(/^(\d{2,5})x(\d{2,5})$/);
    if (!m) return;
    const w = parseInt(m[1], 10) || 0;
    const h = parseInt(m[2], 10) || 0;
    // If first image dims are not ready yet, don't normalize — this could be a Match First Image reuse
    if (!firstDims) return;
    const matchFirst = s === `${firstDims.w}x${firstDims.h}`;
    if (matchFirst) return; // keep exact for Match First Image
    const longEdge = Math.max(w, h);
    const token = longEdge >= 3840 ? '4K' : longEdge >= 1920 ? '2K' : '1K';
    // Avoid loops: only update if currently explicit
    setSize(token);
    if (derivedSizeForToken && typeof setComputedSize === 'function') {
      const label = token.toUpperCase();
      const derived = derivedSizeForToken[label] ? derivedSizeForToken[label].replace('×','x') : '';
      setComputedSize(derived);
    }
  }, [size, firstDims, derivedSizeForToken, setComputedSize]);

  // Ensure when AR = Match First Image and firstDims are known, we force size to exact WxH
  useEffect(() => {
    if (String(aspectRatio) !== 'match_input') return;
    if (!firstDims || !firstDims.w || !firstDims.h) return;
    if (isReuseMode || applyingReuseSettings || lockResolutionFromTemplate) {
      console.log('[Seedream4Panel] Skipping auto-override during reuse:', { isReuseMode, applyingReuseSettings, aspectRatio, firstDims, size });
      return; // Don't override during reuse
    }
    const exact = `${firstDims.w}x${firstDims.h}`;
    const current = String(size || '').toLowerCase();
    // Only auto-force when current size is an explicit WxH (e.g., from reuse). If user picked a token (1K/2K/4K), do not override.
    if (/^\d{2,5}x\d{2,5}$/i.test(current) && current !== exact) {
      console.log('[Seedream4Panel] Auto-overriding size:', { current, exact, aspectRatio, firstDims });
      try {
        setSize(exact);
        if (typeof setComputedSize === 'function') setComputedSize(exact);
        setResolutionIsMatchFirst(true);
      } catch {}
    }
  }, [aspectRatio, firstDims, size, setComputedSize, isReuseMode, applyingReuseSettings]);

  // When parent provides refImageUrls (e.g., via Reuse), reflect them in local thumbnails
  const lastRefUrlsRef = useRef('');
  useEffect(() => {
    console.log('📥 [Parent→Child] Effect triggered, parent refImageUrls length:', refImageUrls?.length);
    
    if (!Array.isArray(refImageUrls)) {
      console.log('⏭️ [Parent→Child] refImageUrls not array, skipping');
      return;
    }
    const next = refImageUrls.filter(Boolean);
    const urlsKey = next.join('|');
    
    console.log('📥 [Parent→Child] Parent URLs:', urlsKey.substring(0, 100) + '...');
    console.log('📥 [Parent→Child] Last synced:', lastRefUrlsRef.current.substring(0, 100) + '...');
    
    // Skip if URLs haven't actually changed (prevents re-syncing on every render)
    if (lastRefUrlsRef.current === urlsKey) {
      console.log('⏭️ [Parent→Child] Parent URLs unchanged, skipping');
      return;
    }
    
    // CRITICAL: Also check if child already HAS these exact URLs (prevents ping-pong loop)
    const current = refImages.map(i => i.url);
    const currentKey = current.join('|');
    
    console.log('📥 [Parent→Child] Child URLs:', currentKey.substring(0, 100) + '...');
    
    if (currentKey === urlsKey) {
      // Child already has these URLs, just update the ref tracker and skip
      console.log('✅ [Parent→Child] Child already has these URLs, updating tracker and skipping');
      lastRefUrlsRef.current = urlsKey;
      return;
    }
    
    console.log('🔄 [Parent→Child] URLs different, will sync parent→child');
    lastRefUrlsRef.current = urlsKey;
    
    const same = next.length === current.length && next.every((u, i) => u === current[i]);
    if (!same) {
      console.log('🚨 [Parent→Child] CALLING setRefImages() with', next.length, 'images');
      // Mark that this change is from parent sync (prevents child→parent from syncing back)
      isSyncingFromParentRef.current = true;
      const mapped = next.map((url) => ({ id: url, url }));
      setRefImages(mapped);
      // Mark only new/changed images as loading until <img> fires onLoad/onError
      try {
        const currentIds = new Set(refImages.map(i => i.id));
        const ids = new Set();
        for (const m of mapped) { if (!currentIds.has(m.id)) ids.add(m.id); }
        if (ids.size > 0) setLoadingImageIds(prev => { const nextSet = new Set(prev); ids.forEach(id => nextSet.add(id)); return nextSet; });
      } catch {}
      if (typeof setRefImageUrl === 'function') setRefImageUrl(next[0] || '');
    } else {
      console.log('⏭️ [Parent→Child] Arrays are same, skipping setRefImages');
    }
  }, [refImageUrls]);

  // Effect to auto-set aspectRatio to 'match_input' when resolution equals first image exact WxH
  useEffect(() => {
    if (!lockResolutionFromTemplate && firstDims && String(size).toLowerCase() === `${firstDims.w}x${firstDims.h}`) {
      setAspectRatio('match_input');
    }
  }, [firstDims, size, setAspectRatio, lockResolutionFromTemplate]);

  // Helper functions for managing multiple images
  const addRefImage = async (file) => {
    if (refImages.length >= 10) {
      alert('Maximum 10 images allowed');
      return;
    }

    const MAX_MB = 10;
    if (file.size > MAX_MB * 1024 * 1024) {
      alert(`Reference image must be ≤ ${MAX_MB} MB`);
      return;
    }

    try {
      setRefUploading(true);
      const buf = await file.arrayBuffer();
      const res = await phFetch(`${API_BASE}/api/images/seedream4/upload-ref`, {
        method: 'POST',
        body: new Blob([buf]),
        cache: 'no-store'
      });
      const data = await res.json();
      
      if (res.ok && data?.url) {
        const newImage = {
          id: Date.now() + Math.random(),
          url: data.url,
          file: file
        };
        setRefImages(prev => [...prev, newImage]);
        setLoadingImageIds(prev => { const next = new Set(prev); next.add(newImage.id); return next; });
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setRefUploading(false);
    }
  };

  const removeRefImage = (id) => {
    setRefImages(prev => {
      const newImages = prev.filter(img => img.id !== id);
      return newImages;
    });
    setLoadingImageIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  const reorderImages = (fromIndex, toIndex) => {
    setRefImages(prev => {
      const newImages = [...prev];
      const [movedImage] = newImages.splice(fromIndex, 1);
      newImages.splice(toIndex, 0, movedImage);
      
      // If the first image changed (either moved to or from index 0), detect new first and mark as reorder
      const firstChanged = (toIndex === 0) || (fromIndex === 0);
      if (firstChanged && newImages[0]) {
        reorderPendingRef.current = true;
        if (!detectingDimensions && !lockResolutionFromTemplate) {
          const first = newImages[0];
          detectAspectFromUrl(first.url || first);
        }
      }
      
      return newImages;
    });
    // Clear drag states
    setDraggedIndex(null);
    setDragOverIndex(null);
    setInsertionIndex(null);
    setActiveId(null);
  };

  const handleImageLoaded = useCallback((imgId) => {
    // Avoid repeated state updates if the image load event fires more than once
    if (loadedOnceRef.current.has(imgId)) return;
    loadedOnceRef.current.add(imgId);
    // Defer state update to next tick to avoid chaining synchronous renders
    setTimeout(() => {
      setLoadingImageIds(prev => {
        if (!prev || !prev.has(imgId)) return prev;
        const next = new Set(prev);
        next.delete(imgId);
        return next;
      });
    }, 0);
  }, []);

  // Detect exact aspect ratio from a dropped image (no rounding)
  const detectExactAspectRatio = (file) => {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const w = img.naturalWidth || 0;
          const h = img.naturalHeight || 0;
          URL.revokeObjectURL(url);
          if (!w || !h) return resolve('');
          // Set exact aspect ratio AND resolution from the image pixels
          try {
            // Always set firstDims when image dimensions are detected
            setFirstDims({ w, h });
            if (!applyingReuseSettings && !lockResolutionFromTemplate) {
              if (reorderPendingRef.current) {
                // Exit reuse on reorder only
                if (isReuseMode && typeof setReuseMode === 'function') setReuseMode(false);
                if (typeof setAspectRatio === 'function') setAspectRatio('match_input');
                const exact = `${w}x${h}`.toLowerCase();
                if (typeof setSize === 'function') setSize(exact);
                if (typeof setComputedSize === 'function') setComputedSize(exact);
                if (typeof setResolutionIsMatchFirst === 'function') setResolutionIsMatchFirst(true);
              } else if (!isReuseMode) {
                // Manual upload outside reuse
                if (typeof setAspectRatio === 'function') setAspectRatio('match_input');
                const exact = `${w}x${h}`.toLowerCase();
                if (typeof setSize === 'function') setSize(exact);
                if (typeof setComputedSize === 'function') setComputedSize(exact);
                if (typeof setResolutionIsMatchFirst === 'function') setResolutionIsMatchFirst(true);
              }
            }
            // Keep a snapshot of the exact AR from the first image for derivations
            if (typeof setRefImageAspectRatio === 'function') setRefImageAspectRatio(`${w}:${h}`);
          } catch (e) {
            console.error('Error setting firstDims from file:', e);
          }
          reorderPendingRef.current = false;
          resolve(`${w}:${h}`);
        };
        img.onerror = () => resolve('');
        img.src = url;
      } catch {
        resolve('');
      }
    });
  };

  // Detect dimensions/aspect from a URL (for reused sessions without File objects)
  const detectAspectFromUrl = (url) => {
    return new Promise((resolve) => {
      try {
        // Set loading state
        setDetectingDimensions(true);
        
        const img = new Image();
        // Load via backend proxy to avoid cross-origin tainting and ensure naturalWidth/Height are available
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const w = img.naturalWidth || 0;
          const h = img.naturalHeight || 0;
          if (!w || !h) {
            setDetectingDimensions(false);
            return resolve('');
          }
          try {
            // Always set firstDims when image dimensions are detected
            setFirstDims({ w, h });
            if (!applyingReuseSettings && !lockResolutionFromTemplate) {
              if (reorderPendingRef.current) {
                // Exit reuse on reorder only
                if (isReuseMode && typeof setReuseMode === 'function') setReuseMode(false);
                if (typeof setAspectRatio === 'function') setAspectRatio('match_input');
                const exact = `${w}x${h}`.toLowerCase();
                if (typeof setSize === 'function') setSize(exact);
                if (typeof setComputedSize === 'function') setComputedSize(exact);
                if (typeof setResolutionIsMatchFirst === 'function') setResolutionIsMatchFirst(true);
              } else if (!isReuseMode) {
                // Manual upload outside reuse
                if (typeof setAspectRatio === 'function') setAspectRatio('match_input');
                const exact = `${w}x${h}`.toLowerCase();
                if (typeof setSize === 'function') setSize(exact);
                if (typeof setComputedSize === 'function') setComputedSize(exact);
                if (typeof setResolutionIsMatchFirst === 'function') setResolutionIsMatchFirst(true);
              }
            }
            // Keep a snapshot of the exact AR from the first image for derivations
            if (typeof setRefImageAspectRatio === 'function') setRefImageAspectRatio(`${w}:${h}`);
          } catch (e) {
            console.error('Error setting firstDims from URL:', e);
          }
          // Clear loading state
          setDetectingDimensions(false);
          reorderPendingRef.current = false;
          resolve(`${w}:${h}`);
        };
        img.onerror = () => {
          setDetectingDimensions(false);
          resolve('');
        };
        const proxied = `${API_BASE}/api/image/proxy?url=${encodeURIComponent(url)}`;
        img.src = proxied;
      } catch {
        setDetectingDimensions(false);
        resolve('');
      }
    });
  };

  // Sync images to parent-visible fields without touching state during render
  // Use parent-level ref if provided, fallback to local refs for backward compatibility
  const localSyncRef = useRef({ lastSynced: null, lastSyncedUrls: '' });
  const syncRef = imageSyncRef || localSyncRef;
  
  useEffect(() => {
    const first = refImages[0];
    const currentKey = first ? first.url || first.id : 'empty';
    
    console.log('🖼️ [Child→Parent] Effect triggered, refImages:', refImages.length, 'isSyncingFromParent:', isSyncingFromParentRef.current);
    
    // CRITICAL: Skip if this change came from parent→child sync (prevents ping-pong loop)
    if (isSyncingFromParentRef.current) {
      console.log('⏭️  [Child→Parent] Change came from parent sync, skipping child→parent sync');
      isSyncingFromParentRef.current = false;  // Reset flag for next time
      // Update tracking refs so next user interaction will sync properly
      syncRef.current.lastSynced = currentKey;
      syncRef.current.lastSyncedUrls = refImages.map(img => img.url).join('|');
      return;
    }
    
    console.log('🖼️ [Child→Parent] Checking if sync needed, currentKey:', currentKey, 'lastSynced:', syncRef.current.lastSynced);
    
    // CRITICAL FIX: Don't sync when going from images to empty and back
    // Only sync when there's an actual change in image content
    const currentUrls = refImages.map(img => img.url).join('|');
    if (syncRef.current.lastSyncedUrls === currentUrls) {
      console.log('⏭️  [Child→Parent] URLs haven\'t changed, skipping all sync');
      return;
    }
    
    console.log('🔄 [Child→Parent] Syncing images to parent, URLs changed from:', syncRef.current.lastSyncedUrls.substring(0, 50), 'to:', currentUrls.substring(0, 50));
    syncRef.current.lastSynced = currentKey;
    syncRef.current.lastSyncedUrls = currentUrls;
    
          if (first) {
      try {
        if (typeof setRefImageUrl === 'function') setRefImageUrl(first.url);
        
        // Update parent refImageUrls (already checked for changes at top of effect)
        if (typeof setRefImageUrls === 'function') {
          const newUrls = refImages.map(img => img.url);
          console.log('📤 [Panel] Updating parent refImageUrls');
          setRefImageUrls(newUrls);
        }
        
        // Always derive from the FIRST image only
            if (!applyingReuseSettings && !lockResolutionFromTemplate) {
          if (first.file) detectExactAspectRatio(first.file);
          else if (first.url) detectAspectFromUrl(first.url);
        }
      } catch {}
    } else {
      // Clear parent refImageUrls (already checked for changes at top of effect)
      if (typeof setRefImageUrl === 'function') setRefImageUrl('');
      if (typeof setRefImageUrls === 'function') {
        console.log('📤 [Panel] Clearing parent refImageUrls');
        setRefImageUrls([]);
      }
      
      // Avoid clobbering Reuse-applied values while applying
      if (!applyingReuseSettings && !lockResolutionFromTemplate) {
        if (typeof setAspectRatio === 'function') setAspectRatio('1:1');
        try {
          setSize('1K');
          if (typeof setComputedSize === 'function') setComputedSize('');
        } catch {}
      }
      setFirstDims(null);
    }
  }, [refImages, setRefImageUrl, setRefImageUrls, setAspectRatio, applyingReuseSettings, lockResolutionFromTemplate, refImageUrls]);
  
  function SortableThumb({ id, index, image, isDragging, isOver, insertionIndex, onRemove, isLoading, onImageLoaded }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging: kitDragging } = useSortable({ id });
    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: kitDragging ? 50 : 'auto'
    };
    return (
      <div ref={setNodeRef} style={style} {...attributes} {...listeners}
        className={`relative aspect-square rounded-lg border overflow-hidden bg-[#1a1a1e] group cursor-move transition-all duration-200 ${
          isDragging ? 'opacity-50 scale-95 border-blue-400 shadow-lg' : 'border-white/10 hover:border-white/20'
        }`}
      >
        {/* live slot indicator inside tile */}
        {insertionIndex === index && (
          <div className="pointer-events-none absolute left-0 right-0 h-0.5 bg-blue-400 z-20 top-0 -translate-y-1/2"></div>
        )}
        {insertionIndex === index + 1 && (
          <div className="pointer-events-none absolute left-0 right-0 h-0.5 bg-blue-400 z-20 bottom-0 translate-y-1/2"></div>
        )}
        <img src={image.url} alt={`Reference ${index + 1}`} className="w-full h-full object-cover pointer-events-none"
          onLoad={() => onImageLoaded && onImageLoaded(id)}
          onError={() => onImageLoaded && onImageLoaded(id)}
        />
        {isLoading && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
          </div>
        )}
        <div className="absolute bottom-1 left-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center text-xs text-white font-medium pointer-events-none">{index + 1}</div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/90 hover:bg-red-500 flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        >
          ×
        </button>
      </div>
    );
  }
  return (
    <>
      <h2 className="text-xl font-bold mb-4 border-b border-white/10 pb-2">Seedream 4.0</h2>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="font-semibold">Prompt</label>
          <a
            href="https://seed.bytedance.com/en/seedream4_0"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-2 py-1 rounded transition-colors"
          >
            About Seedream 4.0
          </a>
        </div>
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
          <option value="seedream-4-0-250828">Seedream 4.0</option>
        </select>
      </div>
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="font-semibold">Images (Optional)</label>
          {refImages.length > 0 && (
            <span className="text-xs text-white/40">Drag to reorder images</span>
          )}
        </div>
        
        {/* Drag & Drop Area */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={async (e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer?.files || []);
            for (const file of files) {
              await addRefImage(file);
            }
          }}
          className="w-full h-28 rounded border border-dashed border-white/20 bg-[#1a1a1e] text-white/70 mb-3 flex flex-col items-center justify-center relative cursor-pointer hover:border-white/30 hover:bg-[#1f1f23] transition-colors"
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <span className="text-sm font-medium">Add more Images</span>
          </div>
          <div className="text-xs text-white/50 mt-2 text-center px-4">
            Click or drag & drop • PNG, JPG, JPEG or WEBP (max 10MB each, up to 10 images)
          </div>
          
          {refUploading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded">
              <div className="flex items-center gap-2 text-white">
                <span className="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
                <span className="text-sm">Uploading...</span>
              </div>
            </div>
          )}
          
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              for (const file of files) {
                await addRefImage(file);
              }
              e.target.value = '';  // Reset so same file can be selected again
            }}
          />
        </div>

        {/* Image Thumbnails Grid with smooth sortable dragging */}
        {refImages.length > 0 && (
          <DndContext
            sensors={sensors}
            onDragStart={({active}) => {
              setActiveId(active?.id ?? null);
              const idx = refImages.findIndex(i => i.id === active?.id);
              setDraggedIndex(idx >= 0 ? idx : null);
            }}
            onDragOver={({over}) => {
              if (!over) return;
              const overIndex = refImages.findIndex(i => i.id === over.id);
              setInsertionIndex(overIndex >= 0 ? overIndex : null);
              setDragOverIndex(overIndex >= 0 ? overIndex : null);
            }}
            onDragEnd={({active, over}) => {
              const activeIdLocal = active?.id;
              const overIdLocal = over?.id;
              setActiveId(null);
              setInsertionIndex(null);
              setDragOverIndex(null);
              if (!activeIdLocal || !overIdLocal || activeIdLocal === overIdLocal) return;
              const oldIndex = refImages.findIndex(i => i.id === activeIdLocal);
              const newIndex = refImages.findIndex(i => i.id === overIdLocal);
              if (oldIndex === -1 || newIndex === -1) return;
              const moved = arrayMove(refImages, oldIndex, newIndex);
              // Apply reorder through existing helper for side-effects
              reorderImages(oldIndex, newIndex);
            }}
            onDragCancel={() => {
              setActiveId(null);
              setInsertionIndex(null);
              setDragOverIndex(null);
            }}
          >
            <SortableContext items={sortableItems} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-5 gap-2 mb-4">
                {refImages.map((image, index) => (
                  <SortableThumb
                    key={image.id}
                    id={image.id}
                    index={index}
                    image={image}
                    isDragging={draggedIndex === index}
                    isOver={dragOverIndex === index}
                    insertionIndex={insertionIndex}
                    onRemove={() => removeRefImage(image.id)}
                    isLoading={loadingImageIds.has(image.id)}
                    onImageLoaded={handleImageLoaded}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeId ? (
                <div className="w-20 h-20 rounded-lg overflow-hidden shadow-xl ring-2 ring-blue-400">
                  <img src={refImages.find(i => i.id === activeId)?.url} className="w-full h-full object-cover" />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
      <div>
        <label className="block mb-2 font-semibold flex items-center gap-1">
          Aspect Ratio
          <HoverInfo text={"Controls the shape/proportions of your image. 'Match First Image' uses the exact proportions of your reference image."} />
        </label>
        <div className={"grid grid-cols-4 gap-3"}>
          <Tile value="match_input" labelTop="Match First" labelBottom="Image" />
          <Tile value="16:9" labelTop="16:9" iconAR="16:9" />
          <Tile value="3:2" labelTop="3:2" iconAR="3:2" />
          <Tile value="4:3" labelTop="4:3" iconAR="4:3" />
          <Tile value="1:1" labelTop="1:1" iconAR="1:1" />
          <Tile value="3:4" labelTop="3:4" iconAR="3:4" />
          <Tile value="2:3" labelTop="2:3" iconAR="2:3" />
          <Tile value="9:16" labelTop="9:16" iconAR="9:16" />
          <Tile value="2:1" labelTop="2:1" iconAR="2:1" />
          <Tile value="1:2" labelTop="1:2" iconAR="1:2" />
          <Tile value="4:5" labelTop="4:5" iconAR="4:5" />
          <Tile value="21:9" labelTop="21:9" iconAR="21:9" />
        </div>
        {isARLocked && (
          <div className="text-xs text-white/50 mt-1">Aspect Ratio locked by Resolution (Match First Image)</div>
        )}
      </div>

      <div>
        <label className="block mb-2 font-semibold flex items-center gap-1">
          Resolution
          <HoverInfo text={"Controls the output size. May slightly adjust aspect ratio due to rounding. 'Match First Image (WxH)' preserves exact dimensions."} />
          {detectingDimensions && (
            <span className="text-xs text-blue-400 animate-pulse">Detecting dimensions...</span>
          )}
        </label>
        <select
          className="w-full p-2 rounded bg-[#232326] text-white border border-white/10"
          value={((resolutionIsMatchFirst && firstDims && !applyingReuseSettings) ? `${firstDims.w}x${firstDims.h}` : size)}
          onChange={(e) => {
            const v = e.target.value;
            setSize(v);
            
            // Only clear reuse mode for actual user interactions, not programmatic changes during reuse
            if (typeof setReuseMode === 'function' && isReuseMode && !applyingReuseSettings) {
              setReuseMode(false);
            }
            
            // Keep computedSize in sync: if user picks token, compute WxH; if picks WxH, use it
            const label = String(v).toUpperCase();
            if (/^\d{2,5}x\d{2,5}$/i.test(v)) {
              if (typeof setComputedSize === 'function') setComputedSize(v);
              // If user selected Match First Image exact WxH, lock AR to match_input
              if (firstDims && String(v).toLowerCase() === `${firstDims.w}x${firstDims.h}`) {
                setResolutionIsMatchFirst(true);
                if (typeof setAspectRatio === 'function') setAspectRatio('match_input');
              } else {
                setResolutionIsMatchFirst(false);
              }
            } else if (derivedSizeForToken && typeof setComputedSize === 'function') {
              setComputedSize(derivedSizeForToken[label] ? derivedSizeForToken[label].replace('×','x') : '');
              setResolutionIsMatchFirst(false);
            }
          }}
        >
          <option value={firstDims ? `${firstDims.w}x${firstDims.h}` : ''} disabled={!firstDims || matchFirstTooSmall || matchFirstTooBig}>
            {firstDims ? `Match First Image (${firstDims.w}×${firstDims.h}${matchFirstTooSmall ? ' · too small' : matchFirstTooBig ? ' · too big' : ''})` : 'Match First Image' }
          </option>
          <option value="1K" disabled={oneKDisabled || is1KTooSmall}>
            {derivedSizeForToken
              ? `1K (${oneKDisabled ? '— · too small' : (is1KTooSmall ? `${derivedSizeForToken['1K']} · too small` : (derivedSizeForToken['1K'] || '—'))})`
              : '1K'}
          </option>
          <option value="2K">{derivedSizeForToken ? `2K (${derivedSizeForToken['2K']})` : '2K'}</option>
          <option value="4K">{derivedSizeForToken ? `4K (${derivedSizeForToken['4K']})` : '4K'}</option>
        </select>
        <div className="text-xs text-white/50 mt-1">{finalSizeNote}</div>

        {/* mismatch helper removed per request */}
      </div>
      <div>
        <label className="block mb-2 font-semibold">Negative Prompt</label>
        <textarea
          className="w-full p-2 rounded bg-[#232326] text-white focus:outline-none focus:ring border border-white/10"
          rows={3}
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          placeholder="Things to avoid..."
        />
      </div>
      {/* Reference Image URL field removed per request; drag & drop remains above */}
      {/* Seed input removed per request */}
      
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
        onClick={async (e) => {
          const now = Date.now();
          if (now < debounceRef.current) return;
          debounceRef.current = now + 2000;
          if (!clickCooldown) { setClickCooldown(true); setTimeout(() => setClickCooldown(false), 2000); }

          // Require a valid computed price; never fall back to outputs or 1
          if (!(typeof priceCredits === 'number' && priceCredits > 0) || priceLoading) {
            // Price not ready; show checking state but do not deduct or proceed
            return;
          }
          const required = priceCredits;
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
          } finally {
            setCheckingCredits(false);
          }
        }}
        disabled={
          checkingCredits || clickCooldown || !prompt.trim() || buttonCooldown || refUploading || matchFirstPending ||
          priceLoading || !(typeof priceCredits === 'number' && priceCredits > 0)
        }
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 mt-4"
        title={canGenerate === false ? 'Sign in or buy credits to generate' : undefined}
      >
        {matchFirstPending ? (
          <>
            <span>Detecting first image size…</span>
          </>
        ) : (buttonCooldown || refUploading || checkingCredits || clickCooldown) ? (
          <>
            <span className="inline-block h-5 w-5 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
            <span>{refUploading ? 'Uploading...' : (checkingCredits ? 'Checking credits…' : (clickCooldown ? 'Cooling down…' : 'Generating...'))}</span>
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


