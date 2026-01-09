"use client";
import React, { useState } from "react";
import { useApiBase } from "../hooks/useApiBase";
import phFetch from "../services/phFetch";
import { useAuth } from "../contexts/AuthContext";

// This is a near-identical duplicate of SeedancePanel to match the UX 1:1
export default function Veo31Panel({
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
  imageUrl,
  setImageUrl,
  startFrameUrl,
  setStartFrameUrl,
  endFrameUrl,
  setEndFrameUrl,
  onGenerateVideo,
  videoError,
  videoSubmittingCount,
  buttonCooldown,
  priceCredits,
  priceExact,
  priceLoading,
  priceError,
  applyingReuseSettings = false,
  title = 'Google Veo 3.1',
  aboutHref = 'https://blog.google/technology/ai/veo-updates-flow/',
  aboutLabel = 'About Veo 3.1',
  modelOptions = null,
  disableRefInputs = false
}) {
  const [uploadingRef, setUploadingRef] = useState(false);
  const [uploadingStartFrame, setUploadingStartFrame] = useState(false);
  const [uploadingEndFrame, setUploadingEndFrame] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [startFramePreview, setStartFramePreview] = useState("");
  const [endFramePreview, setEndFramePreview] = useState("");
  const [loadingRefFromReuse, setLoadingRefFromReuse] = useState(false);
  const [loadingStartFromReuse, setLoadingStartFromReuse] = useState(false);
  const [loadingEndFromReuse, setLoadingEndFromReuse] = useState(false);
  const [checkingCredits, setCheckingCredits] = useState(false);
  const [clickCooldown, setClickCooldown] = useState(false);
  const [optimisticReserved, setOptimisticReserved] = useState(0);
  const debounceRef = React.useRef(0);
  const API_BASE = useApiBase();
  const { user, applyOptimisticAvailableDelta, showCreditToast, getLastReservedAmount, checkAuth } = useAuth();
  
  // Refs for file inputs to trigger file picker on click
  const startFrameInputRef = React.useRef(null);
  const endFrameInputRef = React.useRef(null);

  // Match Seedance behavior; treat 'fast' as I2V equivalent if needed
  const lowerModel = String(videoModel || '').toLowerCase();
  const isLiteSelected = lowerModel.includes('lite') || lowerModel.includes('fast');
  const isProSelected = lowerModel.includes('pro') || lowerModel.includes('quality');
  // Start/End frames should always be available; treat presence of frames as I2V mode
  const isI2VModel = !disableRefInputs && (isLiteSelected || startFrameUrl || endFrameUrl);

  const prevModelRef = React.useRef(videoModel);
  React.useEffect(() => {
    const prevModel = prevModelRef.current;
    const currentModel = videoModel;
    if (!disableRefInputs && !applyingReuseSettings && isProSelected && prevModel && prevModel !== currentModel && !prevModel.includes('pro')) {
      if (imageUrl || previewUrl || startFrameUrl || endFrameUrl || startFramePreview || endFramePreview) {
        setImageUrl("");
        setPreviewUrl("");
        setStartFrameUrl("");
        setEndFrameUrl("");
        setStartFramePreview("");
        setEndFramePreview("");
      }
    }
    prevModelRef.current = currentModel;
  }, [videoModel, isProSelected, imageUrl, previewUrl, startFrameUrl, endFrameUrl, startFramePreview, endFramePreview, setImageUrl, setStartFrameUrl, setEndFrameUrl, applyingReuseSettings]);

  React.useEffect(() => {
    if (!disableRefInputs && isI2VModel && (startFrameUrl || endFrameUrl) && imageUrl) {
      setImageUrl("");
      setPreviewUrl("");
    }
  }, [disableRefInputs, isI2VModel, startFrameUrl, endFrameUrl, imageUrl, setImageUrl]);

  React.useEffect(() => {
    if (imageUrl && previewUrl !== imageUrl) {
      setPreviewUrl(imageUrl);
      setLoadingRefFromReuse(true);
    } else if (!imageUrl) {
      setLoadingRefFromReuse(false);
    }
  }, [imageUrl, previewUrl]);

  React.useEffect(() => {
    if (startFrameUrl && startFramePreview !== startFrameUrl) {
      setStartFramePreview(startFrameUrl);
      setLoadingStartFromReuse(true);
    } else if (!startFrameUrl) {
      setLoadingStartFromReuse(false);
    }
  }, [startFrameUrl, startFramePreview]);

  React.useEffect(() => {
    if (endFrameUrl && endFramePreview !== endFrameUrl) {
      setEndFramePreview(endFrameUrl);
      setLoadingEndFromReuse(true);
    } else if (!endFrameUrl) {
      setLoadingEndFromReuse(false);
    }
  }, [endFrameUrl, endFramePreview]);

  // Allow 1080p for I2V (start/end frames) per Google Veo 3.1 docs

  const detectAspectRatio = (file) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      const ratio = width / height;
      // Only allow 16:9 or 9:16; pick nearest
      const diff169 = Math.abs(ratio - 16/9);
      const diff916 = Math.abs(ratio - 9/16);
      resolve(diff169 <= diff916 ? "16:9" : "9:16");
    };
    img.onerror = () => resolve("16:9");
    img.src = URL.createObjectURL(file);
  });

  const uploadFrame = async (file, setUploading, setPreview, setUrl) => {
    try {
      const MAX_MB = 10;
      if (file.size > MAX_MB * 1024 * 1024) {
        alert(`Image must be ≤ ${MAX_MB} MB`);
        return;
      }
      setUploading(true);
      try { setPreview(URL.createObjectURL(file)); } catch {}
      const detectedRatio = await detectAspectRatio(file);
      setVideoAspectRatio(detectedRatio);
      const buf = await file.arrayBuffer();
      // Reuse Seedance upload endpoint for reference frames
      const res = await phFetch(`${API_BASE}/api/seedance/upload-ref`, {
        method: 'POST',
        body: new Blob([buf]),
        cache: 'no-store'
      });
      const data = await res.json();
      if (res.ok && data?.url) setUrl(data.url);
    } catch {}
    finally { setUploading(false); }
  };

  const handleGenerateClick = async () => {
    const now = Date.now();
    if (now < debounceRef.current) return;
    debounceRef.current = now + 2000;
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
          setOptimisticReserved(required);
          if (typeof showCreditToast === 'function') showCreditToast('reserved', required);
        } catch {}
        onGenerateVideo?.();
      } else {
        if (!user) {
          window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
        } else {
          const currentPath = window.location.pathname;
          window.location.href = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
        }
      }
    } catch (_) {
      const currentPath = window.location.pathname;
      window.location.href = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
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
      <h2 className="text-xl font-bold mb-4 border-b border-white/10 pb-2">{title}</h2>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="font-semibold">Prompt</label>
          <a href={aboutHref} target="_blank" rel="noopener noreferrer" className="text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-2 py-1 rounded transition-colors">{aboutLabel}</a>
        </div>
        <textarea className="w-full p-2 rounded bg-[#232326] text-white focus:outline-none focus:ring border border-white/10" rows={4} value={videoPrompt} onChange={(e) => setVideoPrompt(e.target.value)} placeholder="Describe the video you want to generate..." />
      </div>
      <div>
        <label className="block mb-2 font-semibold">Model</label>
        <select className="w-full p-2 rounded bg-[#232326] text-white border border-white/10" value={videoModel} onChange={(e) => setVideoModel(e.target.value)}>
          {Array.isArray(modelOptions) && modelOptions.length > 0 ? (
            modelOptions.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))
          ) : (
            <>
              <option value="veo-3-1-quality">Veo 3.1 Quality</option>
              <option value="veo-3-1-fast">Veo 3.1 Fast</option>
            </>
          )}
        </select>
      </div>
      {disableRefInputs ? null : (
        (
          <div>
            <label className="block mb-2 font-semibold">Start & End Frames</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div onClick={() => startFrameInputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={async (e) => { e.preventDefault(); const file = e.dataTransfer?.files?.[0]; if (!file) return; await uploadFrame(file, setUploadingStartFrame, setStartFramePreview, setStartFrameUrl); }} className="w-full h-24 rounded border border-dashed border-white/20 bg-[#1a1a1e] text-white/70 text-sm flex flex-col items-center justify-center relative overflow-hidden cursor-pointer hover:border-white/30 hover:bg-[#1f1f23] transition-colors">
                  {uploadingStartFrame ? (
                    <div className="flex items-center gap-2 text-white/70"><span className="inline-block h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true"></span><span className="text-xs">Uploading…</span></div>
                  ) : (startFramePreview || startFrameUrl) ? (
                    <>
                      <img src={startFramePreview || startFrameUrl} alt="Start Frame" className="absolute inset-0 w-full h-full object-contain p-1" onLoad={() => setLoadingStartFromReuse(false)} onError={() => setLoadingStartFromReuse(false)} />
                      {(loadingStartFromReuse && !uploadingStartFrame) && (<div className="absolute inset-0 bg-black/40 flex items-center justify-center"><span className="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span></div>)}
                      <button type="button" onClick={(e) => { e.stopPropagation(); setStartFrameUrl(""); setStartFramePreview(""); }} className="absolute top-0.5 right-0.5 px-1 py-0.5 text-xs rounded bg-black/60 hover:bg-black text-white border border-white/10">×</button>
                    </>
                  ) : (
                    <div className="text-center"><div className="text-xs text-white/70 mb-1">Upload</div><div className="text-xs text-white/70 mb-1">Start Frame</div><div className="text-xs text-white/50">Click or drag</div></div>
                  )}
                  <input ref={startFrameInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; await uploadFrame(file, setUploadingStartFrame, setStartFramePreview, setStartFrameUrl); e.target.value = ''; }} />
                </div>
              </div>
              <div>
                <div onClick={() => endFrameInputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={async (e) => { e.preventDefault(); const file = e.dataTransfer?.files?.[0]; if (!file) return; await uploadFrame(file, setUploadingEndFrame, setEndFramePreview, setEndFrameUrl); }} className="w-full h-24 rounded border border-dashed border-white/20 bg-[#1a1a1e] text-white/70 text-sm flex flex-col items-center justify-center relative overflow-hidden cursor-pointer hover:border-white/30 hover:bg-[#1f1f23] transition-colors">
                  {uploadingEndFrame ? (
                    <div className="flex items-center gap-2 text-white/70"><span className="inline-block h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true"></span><span className="text-xs">Uploading…</span></div>
                  ) : (endFramePreview || endFrameUrl) ? (
                    <>
                      <img src={endFramePreview || endFrameUrl} alt="End Frame" className="absolute inset-0 w-full h-full object-contain p-1" onLoad={() => setLoadingEndFromReuse(false)} onError={() => setLoadingEndFromReuse(false)} />
                      {(loadingEndFromReuse && !uploadingEndFrame) && (<div className="absolute inset-0 bg-black/40 flex items-center justify-center"><span className="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span></div>)}
                      <button type="button" onClick={(e) => { e.stopPropagation(); setEndFrameUrl(""); setEndFramePreview(""); }} className="absolute top-0.5 right-0.5 px-1 py-0.5 text-xs rounded bg-black/60 hover:bg-black text-white border border-white/10">×</button>
                    </>
                  ) : (
                    <div className="text-center"><div className="text-xs text-white/70 mb-1">Upload</div><div className="text-xs text-white/70 mb-1">End Frame (Optional)</div><div className="text-xs text-white/50">Click or drag</div></div>
                  )}
                  <input ref={endFrameInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; await uploadFrame(file, setUploadingEndFrame, setEndFramePreview, setEndFrameUrl); e.target.value = ''; }} />
                </div>
              </div>
            </div>
            <div className="text-xs text-white/50 mt-1">Upload start and end frames for I2V generation. End frame is optional.</div>
          </div>
        )
      )}
      <div>
        <label className="block mb-2 font-semibold">Aspect Ratio</label>
        <select className="w-full p-2 rounded bg-[#232326] text-white border border-white/10" value={videoAspectRatio} onChange={(e) => setVideoAspectRatio(e.target.value)}>
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
        </select>
        <div className="text-xs text-white/50 mt-1">Only 16:9 and 9:16 are supported.</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block mb-2 font-semibold">Resolution</label>
          <select className="w-full p-2 rounded bg-[#232326] text-white border border-white/10" value={videoResolution} onChange={(e) => setVideoResolution(e.target.value)}>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </div>
        <div>
          <label className="block mb-2 font-semibold">Duration (s)</label>
          <select className="w-full p-2 rounded bg-[#232326] text-white border border-white/10" value={videoDuration} onChange={(e) => setVideoDuration(e.target.value)}>
            <option value={4}>4</option>
            <option value={6}>6</option>
            <option value={8}>8</option>
          </select>
        </div>
      </div>
      <button onClick={handleGenerateClick} disabled={checkingCredits || clickCooldown || !videoPrompt.trim() || !!buttonCooldown || (isI2VModel && !startFrameUrl && endFrameUrl) || priceLoading || !(typeof priceCredits === 'number' && priceCredits > 0)} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
        {(videoSubmittingCount > 0 || checkingCredits || clickCooldown) && (<span className="inline-block h-5 w-5 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span>)}
        <span>{checkingCredits ? 'Checking credits…' : (buttonCooldown ? 'Generating…' : (clickCooldown ? 'Cooling down…' : (priceLoading ? 'Generate (…)': (typeof priceCredits === 'number' ? `Generate (${priceCredits} credits)` : 'Generate Video'))))}</span>
      </button>
      {priceError && (<div className="text-yellow-400 text-xs text-center mt-1">{priceError}</div>)}
      {videoError && (<div className="text-red-400 text-sm text-center">{videoError}</div>)}
      {isI2VModel && !startFrameUrl && endFrameUrl && (<div className="text-red-400 text-sm text-center">Start frame is required for I2V generation. End frame alone is not sufficient.</div>)}
    </>
  );
}


