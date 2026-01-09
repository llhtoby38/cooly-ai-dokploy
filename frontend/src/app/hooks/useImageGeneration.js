"use client";
import { useState, useEffect } from "react";
import { useApiBase } from "./useApiBase";
import phFetch from "../services/phFetch";

export function useImageGeneration(user) {
  const API_BASE = useApiBase();
  let applyDelta = null;
  let showCreditToast = null;
  let getLastReservedAmount = null;
  let checkAuth = null;
  try {
    const ctx = require('../contexts/AuthContext');
    if (ctx && typeof ctx.useAuth === 'function') {
      const { applyOptimisticAvailableDelta, showCreditToast: sct, getLastReservedAmount: glra, checkAuth: ca } = ctx.useAuth();
      applyDelta = applyOptimisticAvailableDelta;
      showCreditToast = sct;
      getLastReservedAmount = glra;
      checkAuth = ca;
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('Failed to access AuthContext in useImageGeneration:', error);
    }
  }
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("seedream-3-0-t2i-250415");
  const [outputs, setOutputs] = useState(4);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [loading, setLoading] = useState(false);
  const [concurrentRequests, setConcurrentRequests] = useState(0);
  const [error, setError] = useState("");
  const [urls, setUrls] = useState([]);
  const [priceCredits, setPriceCredits] = useState(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState("");

  const aspectRatioToSize = (ratioStr, maxDim = 1024) => {
    if (!ratioStr) return `${maxDim}x${maxDim}`;
    const parts = ratioStr.split(":").map(Number);
    if (parts.length !== 2 || parts.some(isNaN)) return `${maxDim}x${maxDim}`;
    const [wR, hR] = parts;
    let width, height;
    if (wR >= hR) {
      width = maxDim;
      height = Math.round((maxDim * hR) / wR);
    } else {
      height = maxDim;
      width = Math.round((maxDim * wR) / hR);
    }
    const round64 = (n) => Math.max(64, Math.round(n / 64) * 64);
    width = round64(width);
    height = round64(height);
    return `${width}x${height}`;
  };

  const generate = async (options = {}) => {
    if (!user) {
      window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
      return;
    }
    
    // Track concurrent requests
    setConcurrentRequests(prev => prev + 1);
    setLoading(true);
    setError("");
    
    try {
      const sizeStr = aspectRatioToSize(aspectRatio);
      const res = await phFetch(`${API_BASE}/api/image/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model, size: sizeStr, outputs, aspect_ratio: aspectRatio, response_format: 'url', clientKey: options.clientKey || undefined })
      });
      
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Generation failed');
        // Refund immediately using known price
        try {
          const amount = (typeof priceCredits === 'number' && priceCredits > 0) ? priceCredits : (typeof outputs === 'number' ? outputs : 1);
          if (applyDelta && Number.isFinite(amount)) applyDelta(amount);
          if (typeof showCreditToast === 'function' && amount > 0) showCreditToast('released', amount);
        } catch {}
        // Soft refresh
        try { if (typeof checkAuth === 'function') setTimeout(() => checkAuth(false), 400); } catch {}
        throw new Error(data?.error || 'Generation failed');
      }
      // Success path: already deducted in panel; nothing to do here
      
      // Decrement concurrent requests and update loading state
      setConcurrentRequests(prev => {
        const newCount = prev - 1;
        if (newCount === 0) {
          setLoading(false);
        }
        return newCount;
      });
      
      setUrls(data.urls || []);
      return data;
    } catch (e) {
      setError(e.message || 'Network error');
      // Network error: local refund using estimated price + soft refresh, then throw
      try {
        const amount = (typeof priceCredits === 'number' && priceCredits > 0) ? priceCredits : (typeof outputs === 'number' ? outputs : 1);
        if (applyDelta && Number.isFinite(amount)) applyDelta(amount);
        if (typeof showCreditToast === 'function' && amount > 0) showCreditToast('released', amount);
      } catch {}
      try { if (typeof checkAuth === 'function') setTimeout(() => checkAuth(false), 400); } catch {}
      
      // Decrement concurrent requests and update loading state
      setConcurrentRequests(prev => {
        const newCount = prev - 1;
        if (newCount === 0) {
          setLoading(false);
        }
        return newCount;
      });
      
      throw e;
    }
  };

  // Fetch price when model or outputs change
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!model || !outputs) { setPriceCredits(null); setPriceError(""); return; }
      setPriceLoading(true); setPriceError("");
      try {
        const res = await phFetch(`${API_BASE}/api/image/price`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, outputs })
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (res.ok && typeof data.credits === 'number') {
            setPriceCredits(data.credits);
          } else { setPriceCredits(null); setPriceError(data.error || 'Price unavailable'); }
        }
      } catch { if (!cancelled) { setPriceCredits(null); setPriceError('Price unavailable'); } }
      finally { if (!cancelled) setPriceLoading(false); }
    };
    run();
    return () => { cancelled = true; };
  }, [API_BASE, model, outputs]);

  return {
    API_BASE,
    prompt, setPrompt,
    model, setModel,
    outputs, setOutputs,
    aspectRatio, setAspectRatio,
    loading, error, urls,
    generate,
    setError,
    priceCredits, priceLoading, priceError
  };
}


