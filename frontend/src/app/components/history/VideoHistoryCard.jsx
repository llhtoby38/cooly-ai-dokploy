"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useApiBase } from "../../hooks/useApiBase";
import VideoDetailsModal from "./VideoDetailsModal";
import DownloadButton from "../DownloadButton";

export default function VideoHistoryCard({ session, onManualCheck, onReusePrompt, estimateMs = 60000 }) {
  const API_BASE = useApiBase();
  const [open, setOpen] = useState(false);
  const [remainingMs, setRemainingMs] = useState(estimateMs);

  useEffect(() => {
    if (session.status !== 'processing') return;
    const createdAtMs = new Date(session.created_at).getTime();
    const id = setInterval(() => {
      const elapsed = Date.now() - createdAtMs;
      const rem = Math.max(0, estimateMs - elapsed);
      setRemainingMs(rem);
    }, 50);
    return () => clearInterval(id);
  }, [session.status, session.created_at, estimateMs]);

  const formatModelLabel = (model) => {
    if (!model) return '';
    const m = String(model).toLowerCase();
    if (m.includes('seedream')) return 'Seedream 3.0';
    if (m.includes('veo')) {
      if (m.includes('fast') || m.includes('turbo') || m.includes('lite') || m.includes('speed')) return 'Veo 3 Fast';
      if (m.includes('quality')) return 'Veo 3 Quality';
      if (m.includes('standard') || m.includes('std') || m.includes('default')) return 'Veo 3 Quality';
      return 'Veo 3';
    }
    return model;
  };

  const handleCardClick = () => setOpen(true);
  const closeModal = () => setOpen(false);

  return (
    <>
      <div className="bg-[#18181b] rounded-lg p-6 w-full max-w-full overflow-hidden cursor-pointer" onClick={handleCardClick}>
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2 flex-none">
            {session.model && (
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-white/10 text-white">
                {formatModelLabel(session.model)}
              </span>
            )}
          </div>
          {(session.status || session.provider_status) && (
            <div className="relative group flex-none">
              {(() => {
                const s = String(session.provider_status || session.status || '').toLowerCase();
                const isGreen = ['completed', 'succeeded', 'success', 'done'].includes(s);
                const isYellow = ['processing', 'running', 'queued'].includes(s);
                const isOrange = ['timeout'].includes(s);
                const cls = isGreen ? 'bg-green-900 text-green-300' : isYellow ? 'bg-yellow-900 text-yellow-300' : isOrange ? 'bg-orange-900 text-orange-300' : 'bg-red-900 text-red-300';
                const label = session.provider_status || session.status;
                return (
                  <div className={`px-3 py-1 rounded-full text-xs font-medium ${cls}`}>
                    {label}
                  </div>
                );
              })()}
              {session.status === 'completed' && (
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
        <div className="mb-3">
          <div className="flex items-center gap-2 min-w-0">
            {(session.aspect_ratio || session.aspectRatio) && (
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-white/10 text-white flex-shrink-0">
                {session.aspect_ratio || session.aspectRatio}
              </span>
            )}
            <h3 className="text-sm font-medium text-gray-200 truncate min-w-0">{session.prompt}</h3>
          </div>
        </div>
        <div className="mt-4">
          {(() => {
            const hasVideo = !!(session.b2_url || session.original_url);
            const isProcessing = String(session.status || '').toLowerCase() === 'processing';
            const message = isProcessing ? `Estimated Time${remainingMs > 0 ? ` • ${(remainingMs / 1000).toFixed(1)}s` : ' • finishing…'}` : 'Awaiting video…';
            return (
              <>
                {hasVideo ? (
                  <div className="w-full h-64 lg:h-[28rem] xl:h-[36rem] rounded-lg border border-white/10 bg-[#0b0b0c] overflow-hidden relative">
                    {/* Download button - only show for completed videos */}
                    <DownloadButton 
                      url={session.b2_url || session.original_url} 
                      filename={`video-${session.session_id}.mp4`} 
                      type="video" 
                    />
                    
                    <video
                      controls
                      className="w-full h-full object-contain"
                      key={session.session_id}
                    >
                      {session.b2_url && (<source src={session.b2_url} type="video/mp4" />)}
                      {session.original_url && (<source src={session.original_url} type="video/mp4" />)}
                      Your browser does not support the video tag.
                    </video>
                  </div>
                ) : (
                  <div className="w-full h-64 lg:h-[28rem] xl:h-[36rem] rounded-lg border border-white/10 bg-[#0b0b0c] flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-white/60 text-xs mb-1">{message}</div>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
      {open && (
        <VideoDetailsModal session={session} onClose={closeModal} onReusePrompt={onReusePrompt} />
      )}
    </>
  );
}


