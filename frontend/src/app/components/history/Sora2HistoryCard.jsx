"use client";
import React, { useEffect, useState } from "react";
import { useApiBase } from "../../hooks/useApiBase";
import Sora2DetailsModal from "./Sora2DetailsModal";
import DownloadButton from "../DownloadButton";

export default function Sora2HistoryCard({ session, onManualCheck, onReusePrompt, estimateMs = 60000 }) {
  const API_BASE = useApiBase();
  const [open, setOpen] = useState(false);
  const [remainingMs, setRemainingMs] = useState(estimateMs);

  const getEstimateMs = () => {
    const d = Number(session?.video_duration) || 4;
    if (d === 4) return 150000; // 2.5 minutes
    if (d === 8) return 300000; // 5 minutes
    if (d === 12) return 450000; // 7.5 minutes
    return estimateMs; // fallback
  };

  useEffect(() => {
    if (session.status !== 'processing') return;
    const createdAtMs = new Date(session.created_at).getTime();
    const localEstimate = getEstimateMs();
    const id = setInterval(() => {
      const elapsed = Date.now() - createdAtMs;
      const rem = Math.max(0, localEstimate - elapsed);
      setRemainingMs(rem);
    }, 200);
    return () => clearInterval(id);
  }, [session.status, session.created_at, session.video_duration]);

  const getDisplayStatus = () => {
    const hasVideo = session.b2_url || session.original_url;

    if (session.provider_status === 'succeeded' && !hasVideo) {
      return { status: 'uploading', label: 'Uploading...', cls: 'bg-blue-900 text-blue-300' };
    }

    if (session.storage_status === 'upload_failed') {
      return { status: 'failed', label: 'Upload Failed', cls: 'bg-red-900 text-red-300' };
    }

    if (session.status === 'completed' && hasVideo) {
      return { status: 'completed', label: 'Completed', cls: 'bg-green-900 text-green-300' };
    }

    const raw = String(session.provider_status || session.status || '').toLowerCase();
    const isGreen = ['succeeded', 'success', 'completed', 'done'].includes(raw);
    const isYellow = ['queued', 'queueing', 'running', 'processing', 'in_progress'].includes(raw);
    const isGray = ['cancelled', 'canceled'].includes(raw);
    const cls = isGreen ? 'bg-green-900 text-green-300' : isYellow ? 'bg-yellow-900 text-yellow-300' : isGray ? 'bg-gray-700 text-gray-300' : 'bg-red-900 text-red-300';
    const label = session.provider_status || session.status;
    return { status: raw, label, cls };
  };

  const providerBadge = () => {
    const { label, cls } = getDisplayStatus();
    return <div className={`px-3 py-1 rounded-full text-xs font-medium ${cls}`}>{label}</div>;
  };

  const formatModelLabel = (model) => {
    const m = String(model || '').toLowerCase();
    return m.includes('pro') ? 'Sora 2 Pro' : 'Sora 2';
  };

  return (
    <>
      <div className="bg-[#18181b] rounded-lg p-6 w-full max-w-full overflow-hidden cursor-pointer" onClick={() => setOpen(true)}>
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2 flex-none">
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-white/10 text-white">{formatModelLabel(session.model)}</span>
          </div>
          <div className="relative group flex-none">
            {providerBadge()}
          </div>
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
        {(() => {
          const { status } = getDisplayStatus();
          const hasVideo = !!(session.b2_url || session.original_url);
          const isProcessing = status === 'processing' || status === 'queued' || status === 'running' || status === 'in_progress';
          const isUploading = status === 'uploading';
          const message = isProcessing
            ? `Estimated Time${remainingMs > 0 ? ` • ${(remainingMs / 60000).toFixed(1)} minutes` : ' • finishing…'}`
            : isUploading
              ? 'Uploading to Storage • Please wait…'
              : 'Awaiting video…';

          return (
            <div className="mt-4">
              {hasVideo ? (
                <div className="w-full h-64 lg:h-[28rem] xl:h-[36rem] rounded-lg border border-white/10 bg-[#0b0b0c] overflow-hidden relative">
                  {/* Download button - only show for completed videos */}
                  <DownloadButton 
                    url={session.b2_url || session.original_url} 
                    filename={`sora2-video-${session.session_id}.mp4`} 
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
                <div className="w-full max-w-full h-64 lg:h-[28rem] xl:h-[36rem] rounded-lg border border-white/10 bg-[#0b0b0c] flex items-center justify-center">
                  <div className="text-center">
                    {(isProcessing || isUploading) && (
                      <div className="mx-auto mb-2 h-8 w-8 rounded-full border-2 border-white/20 border-t-white animate-spin"></div>
                    )}
                    <div className="text-white/60 text-xs mb-1">{message}</div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
      {open && (
        <Sora2DetailsModal session={session} onClose={() => setOpen(false)} onReusePrompt={onReusePrompt} />
      )}
    </>
  );
}



