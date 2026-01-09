"use client";
import React, { useState } from "react";
import { useApiBase } from "../hooks/useApiBase";
import phFetch from "../services/phFetch";
import { useAuth } from "../contexts/AuthContext";

export default function SeedancePanel({
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
  // Customization props for reusing this panel (e.g., Sora 2)
  title = 'Seedance 1.0',
  aboutHref = 'https://seed.bytedance.com/en/seedance',
  aboutLabel = 'About Seedance',
  modelOptions = null, // array of { value, label }
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
  const debounceRef = React.useRef(0);
  const API_BASE = useApiBase();
  const { user, applyOptimisticAvailableDelta, showCreditToast, getLastReservedAmount, checkAuth } = useAuth();
  
  // Refs for file inputs to trigger file picker on click
  const refImageInputRef = React.useRef(null);
  const startFrameInputRef = React.useRef(null);
  const endFrameInputRef = React.useRef(null);

  // New selection model: default behavior (Seedance) or customized via props
  const isLiteSelected = String(videoModel || '').includes('lite');
  const isProSelected = String(videoModel || '').includes('pro');
  // For UI logic, treat Lite selection as I2V mode unless disabled by consumer
  const isI2VModel = !disableRefInputs && isLiteSelected;

  // Track previous model to detect manual changes (not initial load or reuse)
  const prevModelRef = React.useRef(videoModel);
  
  // Clear reference images when manually switching to Pro (no frames supported in UI)
  React.useEffect(() => {
    const prevModel = prevModelRef.current;
    const currentModel = videoModel;
    
    // Only clear if user manually switched TO Pro mode (not initial load or reuse)
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

  // Clear imageUrl when using I2V with start/end frames to prevent conflicts
  React.useEffect(() => {
    if (!disableRefInputs && isI2VModel && (startFrameUrl || endFrameUrl) && imageUrl) {
      setImageUrl("");
      setPreviewUrl("");
    }
  }, [disableRefInputs, isI2VModel, startFrameUrl, endFrameUrl, imageUrl, setImageUrl]);

	// Auto-populate/replace preview when imageUrl changes (e.g., from reuse)
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

  // Auto-downgrade resolution when start/end frames are uploaded (1080p not supported)
  React.useEffect(() => {
    if (!disableRefInputs && isI2VModel && (startFrameUrl || endFrameUrl) && videoResolution === '1080p') {
      setVideoResolution('720p');
    }
  }, [disableRefInputs, isI2VModel, startFrameUrl, endFrameUrl, videoResolution, setVideoResolution]);

  // Function to detect aspect ratio from image
  const detectAspectRatio = (file) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const ratio = width / height;
        
        // Map common ratios to our supported options
        if (Math.abs(ratio - 16/9) < 0.1) resolve("16:9");
        else if (Math.abs(ratio - 4/3) < 0.1) resolve("4:3");
        else if (Math.abs(ratio - 1/1) < 0.1) resolve("1:1");
        else if (Math.abs(ratio - 3/4) < 0.1) resolve("3:4");
        else if (Math.abs(ratio - 9/16) < 0.1) resolve("9:16");
        else if (Math.abs(ratio - 21/9) < 0.1) resolve("21:9");
        else {
          // For custom ratios, find the closest match
          const ratios = [16/9, 4/3, 1/1, 3/4, 9/16, 21/9];
          const ratioLabels = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
          let closest = 0;
          let minDiff = Math.abs(ratio - ratios[0]);
          for (let i = 1; i < ratios.length; i++) {
            const diff = Math.abs(ratio - ratios[i]);
            if (diff < minDiff) {
              minDiff = diff;
              closest = i;
            }
          }
          resolve(ratioLabels[closest]);
        }
      };
      img.onerror = () => resolve("16:9"); // fallback
      img.src = URL.createObjectURL(file);
    });
  };

  // Helper function to upload a frame
  const uploadFrame = async (file, setUploading, setPreview, setUrl) => {
    try {
      // Enforce 10 MB size cap
      const MAX_MB = 10;
      if (file.size > MAX_MB * 1024 * 1024) {
        alert(`Image must be ≤ ${MAX_MB} MB`);
        return;
      }
      setUploading(true);
      try { setPreview(URL.createObjectURL(file)); } catch {}
      
      // Detect and set aspect ratio from the image
      const detectedRatio = await detectAspectRatio(file);
      setVideoAspectRatio(detectedRatio);
      
      const buf = await file.arrayBuffer();
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
    debounceRef.current = now + 2000; // 2s minimum gap between clicks
    if (!clickCooldown) {
      setClickCooldown(true);
      setTimeout(() => setClickCooldown(false), 2000);
    }

    try {
      setCheckingCredits(true);
      // Require a valid computed price; never fall back to a non-zero default
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
        onGenerateVideo?.();
      } else {
        // If not logged in, open login; otherwise redirect to billing
        if (!user) {
          window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
        } else {
          // Redirect to billing page with returnTo parameter
          const currentPath = window.location.pathname;
          window.location.href = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
        }
      }
    } catch (_) {
      // Redirect to billing page with returnTo parameter
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
          <a
            href={aboutHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-2 py-1 rounded transition-colors"
          >
            {aboutLabel}
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
          {Array.isArray(modelOptions) && modelOptions.length > 0 ? (
            modelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))
          ) : (
            <>
              <option value="seedance-1-0-pro">Seedance 1.0 Pro</option>
              <option value="seedance-1-0-lite">Seedance 1.0 Lite</option>
            </>
          )}
        </select>
      </div>
      {/* Reference Images Section */}
      {disableRefInputs ? null : (
        isLiteSelected ? (
          <div>
            <label className="block mb-2 font-semibold">Start & End Frames</label>
            <div className="grid grid-cols-2 gap-3">
              {/* Start Frame */}
              <div>
                <div
                  onClick={() => startFrameInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    const file = e.dataTransfer?.files?.[0];
                    if (!file) return;
                    await uploadFrame(file, setUploadingStartFrame, setStartFramePreview, setStartFrameUrl);
                  }}
                  className="w-full h-24 rounded border border-dashed border-white/20 bg-[#1a1a1e] text-white/70 text-sm flex flex-col items-center justify-center relative overflow-hidden cursor-pointer hover:border-white/30 hover:bg-[#1f1f23] transition-colors"
                >
                  {uploadingStartFrame ? (
                    <div className="flex items-center gap-2 text-white/70">
                      <span className="inline-block h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
                      <span className="text-xs">Uploading…</span>
                    </div>
                  ) : (startFramePreview || startFrameUrl) ? (
                    <>
                      <img src={startFramePreview || startFrameUrl} alt="Start Frame" className="absolute inset-0 w-full h-full object-contain p-1"
                        onLoad={() => setLoadingStartFromReuse(false)}
                        onError={() => setLoadingStartFromReuse(false)}
                      />
                      {(loadingStartFromReuse && !uploadingStartFrame) && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <span className="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setStartFrameUrl(""); 
                          setStartFramePreview("");
                        }}
                        className="absolute top-0.5 right-0.5 px-1 py-0.5 text-xs rounded bg-black/60 hover:bg-black text-white border border-white/10"
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <div className="text-center">
                      <div className="text-xs text-white/70 mb-1">Upload</div>
                      <div className="text-xs text-white/70 mb-1">Start Frame</div>
                      <div className="text-xs text-white/50">Click or drag</div>
                    </div>
                  )}
                  
                  {/* Hidden file input */}
                  <input
                    ref={startFrameInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      await uploadFrame(file, setUploadingStartFrame, setStartFramePreview, setStartFrameUrl);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
              {/* End Frame */}
              <div>
                <div
                  onClick={() => endFrameInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    const file = e.dataTransfer?.files?.[0];
                    if (!file) return;
                    await uploadFrame(file, setUploadingEndFrame, setEndFramePreview, setEndFrameUrl);
                  }}
                  className="w-full h-24 rounded border border-dashed border-white/20 bg-[#1a1a1e] text-white/70 text-sm flex flex-col items-center justify-center relative overflow-hidden cursor-pointer hover:border-white/30 hover:bg-[#1f1f23] transition-colors"
                >
                  {uploadingEndFrame ? (
                    <div className="flex items-center gap-2 text-white/70">
                      <span className="inline-block h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
                      <span className="text-xs">Uploading…</span>
                    </div>
                  ) : (endFramePreview || endFrameUrl) ? (
                    <>
                      <img src={endFramePreview || endFrameUrl} alt="End Frame" className="absolute inset-0 w-full h-full object-contain p-1"
                        onLoad={() => setLoadingEndFromReuse(false)}
                        onError={() => setLoadingEndFromReuse(false)}
                      />
                      {(loadingEndFromReuse && !uploadingEndFrame) && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <span className="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setEndFrameUrl(""); 
                          setEndFramePreview("");
                        }}
                        className="absolute top-0.5 right-0.5 px-1 py-0.5 text-xs rounded bg-black/60 hover:bg-black text-white border border-white/10"
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <div className="text-center">
                      <div className="text-xs text-white/70 mb-1">Upload</div>
                      <div className="text-xs text-white/70 mb-1">End Frame (Optional)</div>
                      <div className="text-xs text-white/50">Click or drag</div>
                    </div>
                  )}
                  
                  {/* Hidden file input */}
                  <input
                    ref={endFrameInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      await uploadFrame(file, setUploadingEndFrame, setEndFramePreview, setEndFrameUrl);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="text-xs text-white/50 mt-1">Upload start and end frames for I2V generation. End frame is optional.</div>
          </div>
        ) : (
          <div>
            <label className="block mb-2 font-semibold">Reference Image</label>
            <div
              onClick={() => refImageInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={async (e) => {
                e.preventDefault();
                const file = e.dataTransfer?.files?.[0];
                if (!file) return;
                await uploadFrame(file, setUploadingRef, setPreviewUrl, setImageUrl);
              }}
              className="w-full h-28 rounded border border-dashed border-white/20 bg-[#1a1a1e] text-white/70 text-sm mb-2 flex items-center justify-center relative overflow-hidden cursor-pointer hover:border-white/30 hover:bg-[#1f1f23] transition-colors"
            >
              {uploadingRef ? (
                <div className="flex items-center gap-2 text-white/70">
                  <span className="inline-block h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
                  <span>Uploading…</span>
                </div>
              ) : (previewUrl || imageUrl) ? (
                <>
                  <img src={previewUrl || imageUrl} alt="Reference" className="absolute inset-0 w-full h-full object-contain p-2"
                    onLoad={() => setLoadingRefFromReuse(false)}
                    onError={() => setLoadingRefFromReuse(false)}
                  />
                  {(loadingRefFromReuse && !uploadingRef) && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <span className="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setImageUrl(""); 
                      setPreviewUrl("");
                      setVideoAspectRatio("16:9"); // Reset to default
                    }}
                    className="absolute top-1 right-1 px-2 py-0.5 text-xs rounded bg-black/60 hover:bg-black text-white border border-white/10"
                  >
                    ×
                  </button>
                </>
              ) : (
                <span>Click or drag & drop an image here</span>
              )}
              
              {/* Hidden file input */}
              <input
                ref={refImageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  await uploadFrame(file, setUploadingRef, setPreviewUrl, setImageUrl);
                  e.target.value = '';  // Reset so same file can be selected again
                }}
              />
            </div>
            <div className="text-xs text-white/50 mt-1">Click or drag & drop an image to upload.</div>
          </div>
        )
      )}
      <div>
        <label className="block mb-2 font-semibold">Aspect Ratio</label>
        <select
          className="w-full p-2 rounded bg-[#232326] text-white border border-white/10"
          value={videoAspectRatio}
          onChange={(e) => setVideoAspectRatio(e.target.value)}
        >
          <option value="16:9">16:9</option>
          <option value="4:3">4:3</option>
          <option value="1:1">1:1</option>
          <option value="3:4">3:4</option>
          <option value="9:16">9:16</option>
          <option value="21:9">21:9</option>
        </select>
        <div className="text-xs text-white/50 mt-1">Other aspect ratios may not be supported.</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block mb-2 font-semibold">Resolution</label>
          <select
            className="w-full p-2 rounded bg-[#232326] text-white border border-white/10"
            value={videoResolution}
            onChange={(e) => setVideoResolution(e.target.value)}
          >
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            {!(isI2VModel && (startFrameUrl || endFrameUrl)) && <option value="1080p">1080p</option>}
          </select>
          {isI2VModel && (startFrameUrl || endFrameUrl) && (
            <div className="text-xs text-white/50 mt-1">1080p not supported with start/end frames</div>
          )}
        </div>
        <div>
          <label className="block mb-2 font-semibold">Duration (s)</label>
          <select
            className="w-full p-2 rounded bg-[#232326] text-white border border-white/10"
            value={videoDuration}
            onChange={(e) => setVideoDuration(e.target.value)}
          >
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={5}>5</option>
            <option value={6}>6</option>
            <option value={7}>7</option>
            <option value={8}>8</option>
            <option value={9}>9</option>
            <option value={10}>10</option>
            <option value={11}>11</option>
            <option value={12}>12</option>
          </select>
        </div>
      </div>
      <button
        onClick={handleGenerateClick}
        disabled={checkingCredits || clickCooldown || !videoPrompt.trim() || !!buttonCooldown || (isI2VModel && !startFrameUrl && endFrameUrl) || priceLoading || !(typeof priceCredits === 'number' && priceCredits > 0)}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        {(videoSubmittingCount > 0 || checkingCredits || clickCooldown) && (
          <span className="inline-block h-5 w-5 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
        )}
        <span>
          {checkingCredits ? 'Checking credits…' : (buttonCooldown ? 'Generating…' : (clickCooldown ? 'Cooling down…' : (
            priceLoading ? 'Generate (…)' : (
              typeof priceCredits === 'number' ? `Generate (${priceCredits} credits)` : 'Generate Video'
            )
          )))}
        </span>
      </button>
      {priceError && (
        <div className="text-yellow-400 text-xs text-center mt-1">{priceError}</div>
      )}
      {videoError && (
        <div className="text-red-400 text-sm text-center">{videoError}</div>
      )}
      {isI2VModel && !startFrameUrl && endFrameUrl && (
        <div className="text-red-400 text-sm text-center">Start frame is required for I2V generation. End frame alone is not sufficient.</div>
      )}
    </>
  );
}


