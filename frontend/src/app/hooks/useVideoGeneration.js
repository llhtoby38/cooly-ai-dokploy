"use client";
import { useState, useEffect } from "react";
import { useApiBase } from "./useApiBase";
import phFetch from "../services/phFetch";

export function useVideoGeneration(user) {
  const API_BASE = useApiBase();
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoModel, setVideoModel] = useState("veo3_fast");
  const [videoAspectRatio, setVideoAspectRatio] = useState("16:9");
  const [videoSubmittingCount, setVideoSubmittingCount] = useState(0);
  const [videoError, setVideoError] = useState("");
  const [sessionId, setSessionId] = useState(null);

  const generateVideo = async () => {
    if (!user) {
      window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
      return;
    }
    setVideoSubmittingCount(c => c + 1);
    setVideoError('');
    try {
      const response = await phFetch(`${API_BASE}/api/video/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: videoPrompt, model: videoModel, aspectRatio: videoAspectRatio })
      });
      const data = await response.json();
      if (response.ok) {
        setSessionId(data.sessionId);
        return data; // return payload including sessionId, credits_left
      } else {
        setVideoError(data.error || 'Failed to start video generation');
        return null;
      }
    } catch (e) {
      setVideoError(e.message || 'Network error');
      return null;
    } finally {
      setVideoSubmittingCount(c => Math.max(0, c - 1));
    }
  };

  return {
    API_BASE,
    videoPrompt, setVideoPrompt,
    videoModel, setVideoModel,
    videoAspectRatio, setVideoAspectRatio,
    videoSubmittingCount, videoError, sessionId,
    generateVideo,
    setVideoError
  };
}


