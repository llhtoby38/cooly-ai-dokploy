"use client";
import React, { useEffect } from "react";

export default function Sora2DetailsModal({ session, onClose, onReusePrompt }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stop = (e) => e.stopPropagation();

  const formatModelLabel = (model) => {
    const m = String(model || '').toLowerCase();
    return m.includes('pro') ? 'Sora 2 Pro' : 'Sora 2';
  };

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

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center cursor-default" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="bg-[#111214] border border-white/10 rounded-xl shadow-2xl w-[90vw] sm:w-[85vw] xl:w-[75vw] max-w-[64rem] max-h-[55vh] overflow-hidden flex flex-col" onClick={stop}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-none">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-white/10 text-white">{formatModelLabel(session.model)}</span>
            {(() => {
              const { label, cls } = getDisplayStatus();
              return (
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${cls}`}>
                  {label}
                </span>
              );
            })()}
          </div>
          <button className="text-white/70 hover:text-white text-2xl leading-none" onClick={onClose}>×</button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5 grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            {session.b2_url || session.original_url ? (
              <video
                key={session.session_id}
                controls
                className="w-full h-auto max-h-[45vh] object-contain rounded-lg border border-white/10 bg-[#0b0b0c]"
              >
                {session.b2_url && (<source src={session.b2_url} type="video/mp4" />)}
                {session.original_url && (<source src={session.original_url} type="video/mp4" />)}
                Your browser does not support the video tag.
              </video>
            ) : (
              <div className="text-white/60 text-sm">No video yet.</div>
            )}
          </div>
          <div className="space-y-4">
            <div>
              <div className="text-xs text-white/60 mb-1">Prompt</div>
              <div className="text-sm text-gray-100 whitespace-pre-wrap break-words bg-white/5 border border-white/10 rounded-md p-3 max-h-60 overflow-auto">{session.prompt}</div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => navigator.clipboard.writeText(session.prompt)} className="px-3 py-1.5 text-xs rounded bg-white/10 hover:bg-white/20 text-white">Copy</button>
                {onReusePrompt && (<button onClick={() => onReusePrompt(session.prompt, session)} className="px-3 py-1.5 text-xs rounded bg-white/10 hover:bg-white/20 text-white">Reuse</button>)}
              </div>
            </div>
            {session.ref_image_url && !session.start_frame_url && !session.end_frame_url && (
              <div>
                <div className="text-xs text-white/60 mb-1">Reference image</div>
                <img src={session.ref_image_url} alt="Reference" className="h-24 w-24 rounded border border-white/10 object-cover" onError={(e)=>{e.currentTarget.style.display='none';}} />
              </div>
            )}
            {(session.start_frame_url || session.end_frame_url) && (
              <div>
                <div className="text-xs text-white/60 mb-2">Start & End Frames</div>
                <div className="flex gap-2">
                  {session.start_frame_url && (
                    <div className="text-center">
                      <div className="text-xs text-white/50 mb-1">Start Frame</div>
                      <img src={session.start_frame_url} alt="Start Frame" className="h-20 w-20 rounded border border-white/10 object-cover" onError={(e)=>{e.currentTarget.style.display='none';}} />
                    </div>
                  )}
                  {session.end_frame_url && (
                    <div className="text-center">
                      <div className="text-xs text-white/50 mb-1">End Frame</div>
                      <img src={session.end_frame_url} alt="End Frame" className="h-20 w-20 rounded border border-white/10 object-cover" onError={(e)=>{e.currentTarget.style.display='none';}} />
                    </div>
                  )}
                </div>
              </div>
            )}
            <div>
              <div className="text-xs text-white/60">Details</div>
                             <div className="text-sm text-white/90 bg-white/5 border border-white/10 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between"><span className="text-white/60">Provider Task ID</span><span className="font-mono text-xs">{session.task_id || '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-white/60">Aspect Ratio</span><span>{session.aspect_ratio || '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-white/60">Resolution</span><span>{session.resolution || '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-white/60">Duration</span><span>{session.video_duration ? `${session.video_duration}s` : '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-white/60">Credits Used</span><span className="text-blue-300">{(typeof session.credit_cost === 'number' && session.credit_cost > 0) ? session.credit_cost : (session.credits || session.price_credits || 0)} credits</span></div>
                <div className="flex items-center justify-between"><span className="text-white/60">Created</span><span>{new Date(session.created_at).toLocaleString()}</span></div>
                {session.completed_at && (<div className="flex items-center justify-between"><span className="text-white/60">Completed</span><span>{new Date(session.completed_at).toLocaleString()}</span></div>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



