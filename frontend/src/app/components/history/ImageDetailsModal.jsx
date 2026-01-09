"use client";
import React, { useEffect } from "react";

export default function ImageDetailsModal({ isOpen, onClose, session, API_BASE, onReusePrompt }) {
  const simplifyAspect = (input) => {
    console.log('simplifyAspect input:', input, 'type:', typeof input);
    if (!input) return '';
    const s = String(input).trim();
    console.log('trimmed string:', s);
    let w = 0, h = 0;
    if (/^\d+[:xX]\d+$/.test(s)) {
      const parts = s.split(/[:xX]/);
      w = parseInt(parts[0], 10);
      h = parseInt(parts[1], 10);
      console.log('matched pattern 1, w:', w, 'h:', h);
    } else if (/^\d+\s*x\s*\d+$/i.test(s)) {
      const parts = s.toLowerCase().split('x');
      w = parseInt(parts[0], 10);
      h = parseInt(parts[1], 10);
      console.log('matched pattern 2, w:', w, 'h:', h);
    } else {
      console.log('no pattern matched, returning empty');
      return '';
    }
    if (!w || !h) {
      console.log('invalid w or h, returning empty');
      return '';
    }
    const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
    const g = gcd(w, h);
    const sw = Math.round(w / g);
    const sh = Math.round(h / g);
    const result = `${sw}:${sh}`;
    console.log('final result:', result);
    return result;
  };
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const stop = (e) => e.stopPropagation();

  const formatModelLabel = (model) => {
    if (!model) return '';
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

  const isSeedream4 = (() => {
    const t = String(session?.generation_tool || '').toLowerCase();
    if (t === 'byteplus-seedream-4') return true;
    const m = String(session?.model || '').toLowerCase();
    return m.includes('seedream-4');
  })();

  const getAspectStyle = () => {
    // Prefer exact resolution (e.g., 896x1152)
    const res = String(session.resolution || session.detected_resolution || '').toLowerCase();
    let w = null, h = null;
    const m = res.match(/^(\d+)x(\d+)$/);
    if (m) {
      w = parseInt(m[1], 10); h = parseInt(m[2], 10);
    }
    if (!w || !h) {
      // Fallback to aspect ratio tokens like 7:9, 16:9, etc.
      const ar = String(session.aspectRatio || session.aspect_ratio || '').trim();
      const r = ar.match(/^(\d+)\s*[:/]\s*(\d+)$/);
      if (r) {
        w = parseInt(r[1], 10); h = parseInt(r[2], 10);
      }
    }
    if (w && h && w > 0 && h > 0) {
      return { aspectRatio: `${w} / ${h}` };
    }
    return undefined;
  };

  const errorMessage = (() => {
    if (!session?.error_details) return null;
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
    if (!errorMessage) return null;
    const marker = errorMessage.toLowerCase().indexOf('request id:');
    if (marker === -1) {
      return { main: errorMessage, requestId: null };
    }
    const main = errorMessage.slice(0, marker).trim() || errorMessage;
    const requestLine = errorMessage.slice(marker).trim();
    return { main, requestId: requestLine };
  })();

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center cursor-default" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="bg-[#111214] border border-white/10 rounded-xl shadow-2xl w-[90vw] sm:w-[85vw] xl:w-[75vw] max-w-[64rem] max-h-[55vh] overflow-hidden flex flex-col" onClick={stop}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-none">
          <div className="flex items-center gap-3">
            {session.model && (
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-white/10 text-white">
                {formatModelLabel(session.model)}
              </span>
            )}
            {session.status && (
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                session.status === 'completed' ? 'bg-green-900 text-green-300' :
                session.status === 'processing' ? 'bg-yellow-900 text-yellow-300' :
                'bg-red-900 text-red-300'
              }`}>
                {session.status}
              </span>
            )}
          </div>
          <button className="text-white/70 hover:text-white text-2xl leading-none" onClick={onClose}>×</button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5 grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-4">
            {session.images && session.images.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-start">
                {session.images.map((url, idx) => (
                  <a key={idx} href={url} target="_blank" rel="noreferrer" className="block">
                    <div className="relative w-full rounded-lg overflow-hidden bg-[#0b0b0c]" style={getAspectStyle()}>
                      <img
                        src={`${API_BASE}/api/image/proxy?url=${encodeURIComponent(url)}`}
                        alt={`Generated image ${idx + 1}`}
                        className="absolute inset-0 w-full h-full object-contain"
                      />
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="w-full min-h-[12rem] rounded-lg border border-dashed border-white/15 bg-[#0b0b0c] flex items-center justify-center px-4">
                <div className="w-full">
                  {errorMessageParts ? (
                    <div className="p-4 rounded bg-red-900/30 border border-red-800/50 text-red-200 text-xs flex items-start gap-2">
                      <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="flex-1 min-w-0 break-words hyphens-auto text-pretty text-balance">
                        <span className="block">{errorMessageParts.main}</span>
                        {errorMessageParts.requestId && (
                          <span className="block text-xs text-red-100 mt-1">{errorMessageParts.requestId}</span>
                        )}
                      </span>
                    </div>
                  ) : (
                    <div className="text-white/60 text-sm text-center">
                      No images available for this session.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <div className="text-xs text-white/60 mb-1">Prompt</div>
              <div className="text-sm text-gray-100 whitespace-pre-wrap break-words bg-white/5 border border-white/10 rounded-md p-3 max-h-60 overflow-auto">
                {session.prompt}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => navigator.clipboard.writeText(session.prompt)}
                  className="px-3 py-1.5 text-xs rounded bg-white/10 hover:bg-white/20 text-white"
                >
                  Copy
                </button>
                {onReusePrompt && (
                  <button
                    onClick={() => onReusePrompt(session.prompt, session)}
                    className="px-3 py-1.5 text-xs rounded bg-white/10 hover:bg-white/20 text-white"
                  >
                    Reuse
                  </button>
                )}
              </div>
            </div>

            {(() => {
              // Prefer negative prompt from input_settings; fallback to top-level field if ever present
              let neg = '';
              try {
                const s = session?.input_settings;
                const obj = typeof s === 'string' ? JSON.parse(s) : s;
                if (obj && typeof obj.negative_prompt === 'string') neg = obj.negative_prompt;
              } catch {}
              if (!neg && typeof session?.negative_prompt === 'string') neg = session.negative_prompt;
              if (!neg) return null;
              return (
                <div>
                  <div className="text-xs text-white/60 mb-1">Negative Prompt</div>
                  <div className="text-sm text-gray-100 whitespace-pre-wrap break-words bg-white/5 border border-white/10 rounded-md p-3 max-h-40 overflow-auto">
                    {neg}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => navigator.clipboard.writeText(neg)}
                      className="px-3 py-1.5 text-xs rounded bg-white/10 hover:bg-white/20 text-white"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Reference images (Seedream 4.0) below the prompt */}
            {(() => {
              const arr = Array.isArray(session.ref_image_urls)
                ? session.ref_image_urls
                : (typeof session.ref_image_urls === 'string' ? (() => { try { return JSON.parse(session.ref_image_urls); } catch { return []; } })() : []);
              const refImages = Array.isArray(arr) ? arr.filter(Boolean).slice(0, 10) : [];
              const single = session.ref_image_url && !refImages.length ? [session.ref_image_url] : [];
              const allRefs = [...refImages, ...single];
              if (allRefs.length === 0) return null;
              return (
                <div>
                  <div className="text-xs text-white/60 mb-2">Reference Images</div>
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                    {allRefs.map((u, i) => (
                      <div key={i} className="relative aspect-square rounded border border-white/10 bg-[#0b0b0c] overflow-hidden">
                        <img
                          src={`${API_BASE}/api/image/proxy?url=${encodeURIComponent(u)}`}
                          alt={`Ref ${i+1}`}
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(e)=>{e.currentTarget.style.display='none';}}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="space-y-2">
              <div className="text-xs text-white/60">Model parameters</div>
              <div className="text-sm text-white/90 bg-white/5 border border-white/10 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Model</span>
                  <span>{formatModelLabel(session.model)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Outputs</span>
                  <span>{session.expectedOutputs || session.outputs || 1}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Aspect Ratio</span>
                  <span>{simplifyAspect(session.aspectRatio || session.aspect_ratio || session.resolution) || '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Resolution</span>
                  <span>{session.resolution || '—'}</span>
                </div>
                {!isSeedream4 && (
                  <div className="flex items-center justify-between">
                    <span className="text-white/60">Guidance Scale</span>
                    <span>{session.guidance_scale || '—'}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Credits Used</span>
                  <span className="text-blue-300">{session.credit_cost || 1} credits</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Created</span>
                  <span>{new Date(session.created_at).toLocaleString()}</span>
                </div>
                {session.completed_at && (
                  <div className="flex items-center justify-between">
                    <span className="text-white/60">Completed</span>
                    <span>{new Date(session.completed_at).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


