"use client";
import React, { useEffect, useState } from "react";

export default function VideoDetailsModal({ session, onClose, onReusePrompt }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [videoLengthSec, setVideoLengthSec] = useState(null);
  const stop = (e) => e.stopPropagation();

  const formatModelLabel = (model) => {
    if (!model) return '';
    const m = String(model).toLowerCase();
    if (m.includes('seedream')) return 'Seedream 3.0';
    if (m.includes('veo')) {
      if (m.includes('fast') || m.includes('turbo') || m.includes('lite') || m.includes('speed')) return 'Veo 3 Fast';
      if (m.includes('standard') || m.includes('std') || m.includes('default')) return 'Veo 3 Standard';
      return 'Veo 3';
    }
    return model;
  };

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
                ['completed','done','succeeded','success'].includes(String(session.provider_status || session.status || '').toLowerCase())
                  ? 'bg-green-900 text-green-300'
                  : ['processing','running','queued','queueing','in_progress'].includes(String(session.provider_status || session.status || '').toLowerCase())
                    ? 'bg-yellow-900 text-yellow-300'
                    : 'bg-red-900 text-red-300'
              }`}>
                {session.provider_status || session.status}
              </span>
            )}
          </div>
          <button className="text-white/70 hover:text-white text-2xl leading-none" onClick={onClose}>×</button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5 grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            {session.b2_url || session.original_url ? (
              <video
                controls
                className="w-full h-auto max-h-[45vh] object-contain rounded-lg border border-white/10 bg-[#0b0b0c]"
                src={session.b2_url || session.original_url}
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget?.duration;
                  if (Number.isFinite(d) && d > 0) setVideoLengthSec(d);
                }}
              >
                Your browser does not support the video tag.
              </video>
            ) : (
              <div className="text-white/60 text-sm">No video yet.</div>
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
                    onClick={() => onReusePrompt(session.prompt)}
                    className="px-3 py-1.5 text-xs rounded bg-white/10 hover:bg-white/20 text-white"
                  >
                    Reuse
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-white/60">Model parameters</div>
              <div className="text-sm text-white/90 bg-white/5 border border-white/10 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Model</span>
                  <span>{formatModelLabel(session.model)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Aspect Ratio</span>
                  <span>{session.aspectRatio || session.aspect_ratio || '—'}</span>
                </div>
                {Number.isFinite(videoLengthSec) && videoLengthSec > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-white/60">Video Length</span>
                    <span>{videoLengthSec.toFixed(1)}s</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Credits Used</span>
                  <span className="text-blue-300">{session.credit_cost || 5} credits</span>
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
