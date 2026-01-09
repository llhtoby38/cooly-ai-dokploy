"use client";
import React, { useEffect, useRef, useState } from "react";
import ImageDetailsModal from "./ImageDetailsModal";
import DownloadButton from "../DownloadButton";

function ImageHistoryCard({ session, API_BASE, onReusePrompt, estimateMs }) {
  const simplifyAspect = (input) => {
    if (!input) return '';
    let w = 0, h = 0;
    const s = String(input).trim();
    if (/^\d+[:xX]\d+$/.test(s)) {
      const parts = s.split(/[:xX]/);
      w = parseInt(parts[0], 10);
      h = parseInt(parts[1], 10);
    } else if (/^\d+\s*x\s*\d+$/i.test(s)) {
      const parts = s.toLowerCase().split('x');
      w = parseInt(parts[0], 10);
      h = parseInt(parts[1], 10);
    } else {
      return '';
    }
    if (!w || !h) return '';
    const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
    const g = gcd(w, h);
    const sw = Math.round(w / g);
    const sh = Math.round(h / g);
    return `${sw}:${sh}`;
  };
  const formatModelLabel = (model, tool) => {
    if (!model) return '';
    const t = String(tool || '').toLowerCase();
    if (t === 'byteplus-seedream-4') return 'Seedream 4.0';
    if (t === 'byteplus-seedream') return 'Seedream 3.0';
    const m = String(model).toLowerCase();
    if (m.includes('seedream-4')) return 'Seedream 4.0';
    if (m.includes('seedream')) return 'Seedream 3.0';
    if (m.includes('veo')) {
      if (m.includes('fast') || m.includes('turbo') || m.includes('lite') || m.includes('speed')) return 'Veo 3 Fast';
      if (m.includes('standard') || m.includes('std') || m.includes('default')) return 'Veo 3 Standard';
      return 'Veo 3';
    }
    return model;
  };

  // Calculate dimensions based on aspect ratio
  const calculateDimensions = (aspectRatio, baseSize = 280) => {
    const simplified = simplifyAspect(aspectRatio) || '1:1';
    const [wRatio, hRatio] = simplified.split(':').map(Number);
    if (!wRatio || !hRatio) return { width: baseSize, height: baseSize };

    let width, height;

    if (wRatio >= hRatio) {
      // Landscape or square
      width = baseSize;
      height = (baseSize * hRatio) / wRatio;
    } else {
      // Portrait
      height = baseSize;
      width = (baseSize * wRatio) / hRatio;
    }

    return {
      width: Math.round(width),
      height: Math.round(height),
      aspectRatio: `${wRatio}/${hRatio}`
    };
  };
  const [isModalOpen, setIsModalOpen] = useState(false);
  const expected = session.expectedOutputs || 1; // expected requested outputs (used only while processing)
  const [displayProgress, setDisplayProgress] = useState(Array(expected).fill(0));
  const [remainingMs, setRemainingMs] = useState(typeof estimateMs === 'number' ? estimateMs : 5000);
  const [imageLoaded, setImageLoaded] = useState(Array(expected).fill(false));
  const [imgSrcOverrides, setImgSrcOverrides] = useState(Array(expected).fill(''));
  const [uiStatus, setUiStatus] = useState(session.status);
  const lastProgressTsRef = useRef(0);
  const FAILED_STALE_MS = 120000; // 2 minutes without progress
  const FAILED_DEBOUNCE_MS = 1200; // debounce before showing failed
  const statusTimerRef = useRef(null);

  // Keep displayProgress array length in sync with expected slots
  useEffect(() => {
    setDisplayProgress(prev => {
      const next = Array(expected).fill(0);
      for (let i = 0; i < expected; i++) next[i] = prev[i] ?? 0;
      return next;
    });
    setImageLoaded(prev => {
      const next = Array(expected).fill(false);
      for (let i = 0; i < expected; i++) next[i] = prev[i] ?? false;
      return next;
    });
  }, [expected]);

  // Update displayed progress directly to the backend milestone (no counting animation)
  useEffect(() => {
    const targets = Array.isArray(session.progress) ? session.progress : [];
    let sawAdvance = false;
    setDisplayProgress(prev => prev.map((v, i) => {
      const t = typeof targets[i] === 'number' ? targets[i] : v;
      const nextVal = Math.max(0, Math.min(100, Math.round(t)));
      if (nextVal > (prev[i] || 0)) sawAdvance = true;
      return nextVal;
    }));
    if (sawAdvance) lastProgressTsRef.current = Date.now();
  }, [session.progress, expected]);

  // Estimated time remaining countdown (ms) per card (only while processing)
  useEffect(() => {
    if (uiStatus !== 'processing') return;
    const startedAt = new Date(session.created_at).getTime() || Date.now();
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const target = typeof estimateMs === 'number' ? estimateMs : 10000;
      setRemainingMs(target - elapsed);
    };
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [uiStatus, session.created_at, estimateMs]);

  // Status gating to prevent transient failed flashes
  useEffect(() => {
    if (session.status === 'failed') {
      // Only show failed if no progress in the last debounce window and either
      //  - we have never seen progress, or
      //  - the session is stale beyond FAILED_STALE_MS
      const lastTs = lastProgressTsRef.current || new Date(session.created_at).getTime();
      const noRecent = Date.now() - lastTs > FAILED_DEBOUNCE_MS;
      const stale = Date.now() - new Date(session.created_at).getTime() > FAILED_STALE_MS;
      if (noRecent || stale) setUiStatus('failed'); else setUiStatus('processing');
    } else {
      setUiStatus(session.status);
    }
  }, [session.status, session.created_at]);

  const handleCardKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsModalOpen(true);
    }
  };

  // Parse error details if present
  const errorMsg = (() => {
    if (uiStatus !== 'failed' || !session.error_details) return null;
    try {
      const details = typeof session.error_details === 'string'
        ? JSON.parse(session.error_details)
        : session.error_details;
      return details?.message || null;
    } catch {
      return null;
    }
  })();

  const errorMessageParts = (() => {
    if (!errorMsg) return null;
    const marker = errorMsg.toLowerCase().indexOf('request id:');
    if (marker === -1) {
      return { main: errorMsg, requestId: null };
    }
    const main = errorMsg.slice(0, marker).trim() || errorMsg;
    const requestLine = errorMsg.slice(marker).trim();
    return { main, requestId: requestLine };
  })();

  return (
    <div
      className="bg-[#18181b] rounded-lg p-6 w-full max-w-full overflow-visible cursor-pointer"
      onClick={() => setIsModalOpen(true)}
      role="button"
      tabIndex={0}
      onKeyDown={handleCardKeyDown}
      aria-label="Open details"
    >
      <div className="flex justify-between items-center mb-2">
        <div className="flex-none">
          {session.model && (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-white/10 text-white">
              {formatModelLabel(session.model, session.generation_tool || session.tool)}
            </span>
          )}
        </div>
        {uiStatus && (
          <div className="relative group flex-none">
            <span className={`px-3 py-1 rounded-full text-xs font-medium transition-colors duration-300 ${
              uiStatus === 'completed' ? 'bg-green-900 text-green-300' :
              uiStatus === 'processing' ? 'bg-yellow-900 text-yellow-300' :
              'bg-red-900 text-red-300'
            }`}>
              {uiStatus}
            </span>
            {uiStatus === 'completed' && (
              <div className="absolute right-0 mt-2 w-max max-w-xs p-2 text-xs bg-black/80 text-gray-200 rounded shadow-lg border border-white/10 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-20">
                <div>Created: {new Date(session.created_at).toLocaleString()}</div>
                {session.completed_at && (
                  <div>Completed: {new Date(session.completed_at).toLocaleString()}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mb-4 relative group/prompt">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {(() => {
              const displayAR = simplifyAspect(session.resolution || session.aspectRatio);
              return displayAR ? (
                <span className="px-2 py-1 rounded-full text-xs font-medium bg-white/10 text-white flex-shrink-0">
                  {displayAR}
                </span>
              ) : null;
            })()}
            <h3 className="text-xs font-medium text-gray-200 truncate min-w-0">{session.prompt}</h3>
          </div>
          {/* Progress indicator for processing tasks */}
          {/* Removed X/Y header progress per request */}
        </div>
        {/* Tooltip removed in favor of modal */}
      </div>

      {/* Error Banner */}
      {errorMessageParts && (
        <div className="mb-4 p-3 rounded bg-red-900/30 border border-red-800/50 text-red-200 text-xs flex items-start gap-2">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="flex-1 min-w-0 break-words hyphens-auto text-pretty text-balance">
            <span className="block">{errorMessageParts.main}</span>
            {errorMessageParts.requestId && (
              <span className="block text-xs text-red-100 mt-1">{errorMessageParts.requestId}</span>
            )}
          </span>
        </div>
      )}

      <div className="overflow-visible">
        <div className="grid gap-2 xl:gap-4 grid-cols-2 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 justify-start min-w-0">
                    {/* Render grid with expected number of slots */}
          {(() => {
            const slotCount = (() => {
              if (uiStatus === 'processing') {
                return expected || Math.max(session.images.length, 1);
              }
              if (uiStatus === 'failed') {
                return expected || Math.max(session.images.length, 1);
              }
              return Math.max(session.images.length, 1);
            })();
            return Array.from({ length: slotCount }).map((_, index) => {
            const imageUrl = session.images[index];
            const dimensions = calculateDimensions(session.resolution || session.aspectRatio);
            const completedAtMs = session.completed_at ? new Date(session.completed_at).getTime() : 0;
            const completedRecently = uiStatus === 'completed' && (!completedAtMs || (Date.now() - completedAtMs) < 5000);
            const isFailed = uiStatus === 'failed';
            const shouldShowLoading = !imageUrl && (uiStatus === 'processing' || completedRecently);

            if (imageUrl) {
              const computeDisplaySrc = (rawUrl) => {
                try {
                  const u = new URL(String(rawUrl));
                  const host = u.hostname || '';
                  const isPublicHost = /picsum\.photos|unsplash|placekitten|placehold|loremflickr/i.test(host);
                  // Load public CDNs directly to avoid proxy CORP/Referer issues
                  return isPublicHost ? rawUrl : `${API_BASE}/api/image/proxy?url=${encodeURIComponent(rawUrl)}`;
                } catch {
                  return `${API_BASE}/api/image/proxy?url=${encodeURIComponent(String(rawUrl))}`;
                }
              };
              const defaultSrc = computeDisplaySrc(imageUrl);
              const altSrc = (() => {
                // Alternate between proxy and direct for robust fallback
                try {
                  const u = new URL(String(imageUrl));
                  const host = u.hostname || '';
                  const isPublicHost = /picsum\.photos|unsplash|placekitten|placehold|loremflickr/i.test(host);
                  return isPublicHost ? `${API_BASE}/api/image/proxy?url=${encodeURIComponent(imageUrl)}` : imageUrl;
                } catch {
                  return imageUrl;
                }
              })();
              const displaySrc = (imgSrcOverrides[index] || defaultSrc);
              // Debug: log which URL is used for this slot
              // Show completed image
              return (
                <div key={`slot-${index}`} className="min-w-0">
                  <div
                    className="relative w-full rounded-lg overflow-hidden"
                    style={{
                      aspectRatio: dimensions.aspectRatio
                    }}
                  >
                    {/* Download button - only show for completed images */}
                    <DownloadButton 
                      url={imageUrl} 
                      filename={`image-${session.session_id}-${index + 1}.jpg`} 
                      type="image" 
                    />
                    
                    <a href={imageUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      {/* Placeholder stays visible behind to avoid flash */}
                      <div className="absolute inset-0 bg-[#111]" />
                      <img
                        src={displaySrc}
                        alt={`Generated image ${index + 1}`}
                        className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${imageLoaded[index] ? 'opacity-100' : 'opacity-0'}`}
                        loading="lazy"
                        onLoad={() => setImageLoaded(prev => {
                          const next = [...prev];
                          next[index] = true;
                          return next;
                        })}
                        onError={() => {
                          // Flip to alternate source once on error (with cache buster)
                          setImgSrcOverrides(prev => {
                            const next = [...prev];
                            const currently = prev[index] || defaultSrc;
                            const useAlt = (currently === defaultSrc) ? altSrc : defaultSrc;
                            const withBuster = useAlt + (useAlt.includes('?') ? '&' : '?') + 'v=' + Date.now();
                            next[index] = withBuster;
                            return next;
                          });
                          setImageLoaded(prev => {
                            const next = [...prev];
                            next[index] = false;
                            return next;
                          });
                        }}
                      />
                    </a>
                  </div>
                </div>
              );
            } else if (shouldShowLoading) {
              // Show loading slot with correct aspect ratio
              const delayClass = session.isOptimistic ? 'animate-pulse' : '';

              return (
                <div key={`slot-${index}`} className="min-w-0">
                  <div
                    className={`w-full bg-[#111] rounded-lg flex items-center justify-center border border-white/5 hover:border-white/10 transition-colors ${delayClass}`}
                    style={{
                      aspectRatio: dimensions.aspectRatio
                    }}
                  >
                    {(() => {
                      const ms = Math.max(0, Math.ceil(remainingMs));
                      const secondsText = (ms / 1000).toFixed(1);
                      return (
                        <div className="text-center">
                          <div className="text-white/60 text-[10px] mb-0.5">Estimated Time</div>
                          <div className="text-white text-sm font-semibold tabular-nums">{secondsText}s</div>
                          <div className="text-white/40 text-xs mt-1">Slot {index + 1} {ms <= 0 ? '(finishing...)' : ''}</div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            } else {
              // Show empty slot for failed generations (or no image)
              return (
                <div key={`slot-${index}`} className="min-w-0">
                  <div
                    className="w-full bg-[#111] rounded-lg flex items-center justify-center"
                    style={{
                      aspectRatio: dimensions.aspectRatio
                    }}
                  >
                    <div className="text-center text-white/40 text-sm">
                      Failed to generate
                    </div>
                  </div>
                </div>
              );
            }
            });
          })()}
        </div>
      </div>
      {isModalOpen && (
        <ImageDetailsModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          session={session}
          API_BASE={API_BASE}
          onReusePrompt={onReusePrompt}
        />
      )}
    </div>
  );
}

// Avoid re-rendering cards when unrelated props are unchanged
function areEqual(prevProps, nextProps) {
  const a = prevProps.session || {};
  const b = nextProps.session || {};
  if (a === b) return true;
  // Compare primitive fields used by UI
  const fields = [
    'session_id', 'status', 'prompt', 'model', 'aspectRatio', 'resolution',
    'created_at', 'completed_at', 'expectedOutputs', 'credit_cost', 'error_details'
  ];
  for (const f of fields) {
    if ((a[f] || null) !== (b[f] || null)) return false;
  }
  // Compare images array by reference or shallow equality
  const aImgs = Array.isArray(a.images) ? a.images : [];
  const bImgs = Array.isArray(b.images) ? b.images : [];
  if (aImgs === bImgs) {
    // ok
  } else {
    if (aImgs.length !== bImgs.length) return false;
    for (let i = 0; i < aImgs.length; i++) if (aImgs[i] !== bImgs[i]) return false;
  }
  // Compare progress shallowly
  const aProg = Array.isArray(a.progress) ? a.progress : [];
  const bProg = Array.isArray(b.progress) ? b.progress : [];
  if (aProg === bProg) {
    // ok
  } else {
    if (aProg.length !== bProg.length) return false;
    for (let i = 0; i < aProg.length; i++) if ((aProg[i] || 0) !== (bProg[i] || 0)) return false;
  }
  // Ignore function prop identity (onReusePrompt) and API_BASE/estimateMs changes are rare; include them
  if ((prevProps.API_BASE || '') !== (nextProps.API_BASE || '')) return false;
  if ((prevProps.estimateMs || 0) !== (nextProps.estimateMs || 0)) return false;
  return true;
}

export default React.memo(ImageHistoryCard, areEqual);
