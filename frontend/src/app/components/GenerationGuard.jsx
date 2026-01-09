'use client';

import React from 'react';
import Link from 'next/link';

export default function GenerationGuard({
  isAuthenticated,
  userCredits,
  requiredCredits,
  priceLoading,
  className = '',
  visible, // for credit-insufficient mode: show only when true
  onClose,
  dismissible = true
}) {
  if (priceLoading) return null;
  const authed = !!isAuthenticated;
  const balance = Number(userCredits || 0);
  const needed = requiredCredits != null ? Number(requiredCredits) : null;

  const isInsufficient = authed && (balance <= 0 || (needed != null && balance < needed));
  const show = (!authed) || (!!visible && isInsufficient);
  if (!show) return null;

  let title = '';
  let body = '';
  let ctaHref = '';
  let ctaText = '';
  let ctaOnClick = null;

  if (!authed) {
    title = 'Please sign in to start generating';
    body = 'Create an account or sign in to use image and video generation.';
    ctaHref = '#';
    ctaText = 'Sign in';
    ctaOnClick = (e) => {
      e.preventDefault();
      const evt = new CustomEvent('open-auth-modal', { detail: { mode: 'login' } });
      window.dispatchEvent(evt);
    };
  } else if (balance <= 0) {
    title = "You're out of credits";
    body = 'Buy credits or subscribe to continue creating.';
    // Capture current page to return after payment
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
    ctaHref = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
    ctaText = 'Buy credits';
  } else {
    title = 'Not enough credits for this job';
    body = `Need ${needed} credits, you have ${balance}.`;
    // Capture current page to return after payment
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
    ctaHref = `/billing?returnTo=${encodeURIComponent(currentPath)}`;
    ctaText = 'Buy credits';
  }

  return (
    <div className={`absolute inset-0 z-40 flex items-start justify-center bg-black/60 pt-24 md:pt-40 ${className}`}>
      <div className="relative max-w-md w-full mx-4 bg-gray-900 border border-gray-700 rounded-xl p-6 text-center shadow-xl">
        {dismissible && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-2 right-2 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded px-2"
          >
            ×
          </button>
        )}
        <h3 className="text-xl font-semibold text-white mb-2">{title}</h3>
        <p className="text-gray-300 mb-4">{body}</p>
        <div className="flex items-center justify-center gap-3">
          <Link href={ctaHref} onClick={ctaOnClick || undefined} className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white">
            {ctaText}
          </Link>
          {authed && (
            <Link href="/" className="px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 text-white">
              Explore
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export function canGenerate({ isAuthenticated, userCredits, requiredCredits }) {
  const authed = !!isAuthenticated;
  if (!authed) return false;
  const balance = Number(userCredits || 0);
  if (balance <= 0) return false;
  const needed = requiredCredits != null ? Number(requiredCredits) : 0;
  return balance >= needed;
}


