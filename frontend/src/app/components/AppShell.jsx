"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FaCoins, FaUser } from "react-icons/fa";
import { useAuth } from "../contexts/AuthContext";
import AuthModal from "./AuthModal";
import BillingModal from "./BillingModal";

const TOOL_GROUPS = [
  {
    label: "Navigation",
    items: [
      { label: "Homepage", href: "/", tool: "home" },
      { label: "Templates", href: "/templates", tool: "templates" }
    ]
  },
  {
    label: "Image Generation",
    items: [
      { label: "Seedream 3.0", href: "/image/seedream", tool: "image" },
      { label: "Seedream 4.0", href: "/image/seedream4", tool: "seedream4" }
    ]
  },
  {
    label: "Video Generation",
    items: [
      { label: "Google Veo 3.1", href: "/video/veo31", tool: "veo31" },
      { label: "Seedance 1.0", href: "/video/seedance", tool: "seedance" },
      { label: "Sora 2", href: "/video/sora2", tool: "sora2" }
    ]
  }
];

export default function AppShell({ selectedTool, childrenLeft, childrenMain, onCreditsUpdate, mobilePromptNode, onMobileGenerate, mobileGenerateDisabled, mobileSettingsContent, mobileCreditAmount, showMobilePrompt = true, showLeftSidebar = true }) {
  const { user, logout, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLegalMenu, setShowLegalMenu] = useState(false);
  const userMenuRef = useRef(null);
  const legalMenuRef = useRef(null);

  // Close account dropdown on outside click or Esc
  useEffect(() => {
    if (!showUserMenu) return;
    const handleClick = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showUserMenu]);

  // Close legal menu on outside click or Esc
  useEffect(() => {
    if (!showLegalMenu) return;
    const handleClick = (e) => {
      if (legalMenuRef.current && !legalMenuRef.current.contains(e.target)) {
        setShowLegalMenu(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setShowLegalMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showLegalMenu]);

  // Global event to open the auth modal from nested components (e.g., GenerationGuard)
  useEffect(() => {
    const handler = (e) => {
      try {
        const mode = e?.detail?.mode === 'register' ? 'register' : 'login';
        setAuthMode(mode);
        setShowAuthModal(true);
      } catch {
        setAuthMode('login');
        setShowAuthModal(true);
      }
    };
    window.addEventListener('open-auth-modal', handler);
    return () => window.removeEventListener('open-auth-modal', handler);
  }, []);

  // Global event to open billing modal
  const [showBillingModal, setShowBillingModal] = useState(false);
  useEffect(() => {
    const handler = () => setShowBillingModal(true);
    window.addEventListener('open-billing-modal', handler);
    return () => window.removeEventListener('open-billing-modal', handler);
  }, []);

  const currentToolLabel = selectedTool === 'home' ? 'Homepage' : 
                          selectedTool === 'image' ? 'Seedream 3.0' : 
                          selectedTool === 'seedream4' ? 'Seedream 4.0' :
                          selectedTool === 'veo31' ? 'Google Veo 3.1' : 
                          selectedTool === 'seedance' ? 'Seedance 1.0' : 
                          selectedTool === 'sora2' ? 'Sora 2' : 
                          selectedTool === 'templates' ? 'Templates' : 
                          selectedTool === 'account' ? null : null;

  return (
    <div className="min-h-screen h-screen flex flex-col bg-black text-white overflow-hidden overscroll-none">
      <header className="w-full py-4 px-8 border-b border-white/20 bg-black flex items-center flex-shrink-0 justify-between">
        <Link href="/" className="text-3xl font-extrabold tracking-wide cursor-pointer">
          COOLY
        </Link>
        <div className="flex items-center gap-4 relative">
          {loading ? (
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 bg-gray-800/60 px-3 py-1 rounded-full animate-pulse">
                <div className="w-3 h-3 rounded-full bg-yellow-400/60" />
                <div className="h-3 w-16 bg-white/20 rounded" />
              </div>
              <div className="w-10 h-10 rounded-full bg-white/20 animate-pulse" />
            </div>
          ) : user ? (
            <>
              <div className="flex items-center gap-4">
                <div className="hidden md:flex items-center gap-2 bg-gray-800 px-3 py-1 rounded-full">
                  <FaCoins className="text-yellow-400" />
                  <span className="text-sm font-semibold">{(user?.available_credits ?? user?.credits) } Credits</span>
                </div>
                <button
                  onClick={() => window.location.href = '/billing'}
                  className="hidden md:inline-block bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  Buy Credits
                </button>
              </div>
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setShowUserMenu(v => !v)}
                  aria-label="Account menu"
                  className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:opacity-90"
                >
                  <FaUser />
                </button>
                {showUserMenu && (
                  <div className="absolute right-0 mt-2 w-80 bg-[#111] border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
                    <div className="p-4 border-b border-white/10 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center font-bold">
                        {String(user.email || '?').slice(0,1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{user.email}</div>
                        <div className="text-xs text-gray-400">Signed in</div>
                      </div>
                    </div>
                    <div className="p-2">
                      <div className="px-3 py-2 text-sm text-gray-300 flex items-center justify-between">
                        <span>Available</span>
                        <span className="inline-flex items-center gap-1 bg-gray-800 px-2 py-1 rounded-full text-xs">
                          <FaCoins className="text-yellow-400" /> {(user?.available_credits ?? user?.credits)}
                        </span>
                      </div>
                      {/* Total credits hidden per request */}
                      <button
                        onClick={() => { window.location.href = '/billing'; setShowUserMenu(false); }}
                        className="mt-2 w-full px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
                      >
                        Buy Credits
                      </button>
                    </div>
                    <div className="p-3 border-t border-white/10 space-y-2">
                      <Link
                        href="/account"
                        onClick={() => setShowUserMenu(false)}
                        className="block w-full text-center border border-white/30 text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-white hover:text-black transition-colors"
                      >
                        Account settings
                      </Link>
                      <button
                        onClick={() => { setShowUserMenu(false); logout(); }}
                        className="w-full border border-white text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-white hover:text-black transition-colors"
                      >
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <button onClick={() => { window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'register' } })); }} className="text-white hover:text-gray-300 transition-colors">Sign Up</button>
              <button onClick={() => { window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } })); }} className="border border-white text-white rounded-full px-6 py-2 font-semibold hover:bg-white hover:text-black transition-colors">Sign In</button>
            </>
          )}
        </div>
      </header>

      <div className="min-h-0 h-full overflow-hidden">
        {/* Mobile top menu */}
        <div className="md:hidden w-full bg-black border-b border-white/20 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
          <button className="px-3 py-2 rounded-md bg-white/10 text-white" onClick={() => setShowMobileMenu(true)}>☰ Menu</button>
          {currentToolLabel && (
            <div className="text-sm px-3 py-2 rounded-md bg-white text-black font-semibold">{currentToolLabel}</div>
          )}
        </div>

        <div className="flex md:flex-row flex-col min-h-0 h-full">
        {/* Fixed side menu (desktop only) */}
        <nav className="hidden md:flex w-48 min-w-[12rem] max-w-[12rem] flex-none bg-black border-r border-white/20 flex-col py-6 gap-4 relative">
            {TOOL_GROUPS.map((group) => (
              <div key={group.label} className="px-4">
                <div className="text-xs uppercase tracking-wide text-gray-400 px-2 mb-2">{group.label}</div>
                <div className="flex flex-col">
                  {group.items.map((item) => (
                    item.comingSoon ? (
                      <div
                        key={item.tool}
                        className="text-left w-full px-3 py-2 rounded-md mb-1 text-gray-500 cursor-not-allowed relative"
                      >
                        {item.label}
                        <span className="absolute top-1 right-1 text-xs bg-yellow-500/20 text-yellow-400 px-1 rounded text-[10px]">
                          SOON
                        </span>
                      </div>
                    ) : (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`text-left w-full px-3 py-2 rounded-md mb-1 transition-colors ${selectedTool === item.tool ? 'bg-white text-black' : 'hover:bg-white/10 text-white'}`}
                      >
                        {item.label}
                      </Link>
                    )
                  ))}
                </div>
              </div>
            ))}
            
            {/* Bottom menu buttons */}
            <div className="absolute bottom-6 left-4 right-4 flex justify-end">
              {/* Three dots menu */}
              <div className="relative" ref={legalMenuRef}>
                <button
                  onClick={() => setShowLegalMenu(!showLegalMenu)}
                  className="px-3 py-2 rounded-md hover:bg-white/10 text-white transition-colors flex items-center justify-center"
                  aria-label="Legal menu"
                >
                  <span className="text-lg">⋯</span>
                </button>
                
                {showLegalMenu && (
                  <div className="absolute bottom-full right-0 mb-2 w-48 bg-[#18181b] border border-white/20 rounded-lg shadow-lg py-2 z-50">
                    <Link
                      href="/legal/terms"
                      className="block px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                      onClick={() => setShowLegalMenu(false)}
                    >
                      Terms of Service
                    </Link>
                    <Link
                      href="/legal/privacy"
                      className="block px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                      onClick={() => setShowLegalMenu(false)}
                    >
                      Privacy Policy
                    </Link>
                    <div className="border-t border-white/20 my-1"></div>
                    <a
                      href="mailto:support@cooly.ai"
                      className="block px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                      onClick={() => setShowLegalMenu(false)}
                    >
                      Contact Support
                    </a>
                  </div>
                )}
              </div>
            </div>
        </nav>

        {/* Content area (no horizontal scroll; cards shrink responsively) */}
        <div className="flex-1 min-h-0 h-full min-w-0 overflow-hidden">
          <div className="flex md:flex-row flex-col min-h-0 h-full min-w-0 overflow-hidden">
            {showLeftSidebar && (
              <aside className="hidden md:flex md:w-96 md:min-w-[24rem] md:max-w-[24rem] bg-[#18181b] border-r border-white/20 p-6 flex-col gap-6 min-h-0 h-full overflow-y-auto">
                {childrenLeft}
              </aside>
            )}
            <main className={`bg-[#0a0a0a] px-3 md:px-6 pt-0 pb-6 md:pb-6 min-h-0 h-full overflow-y-auto overflow-x-hidden flex-1 min-w-0 ${showLeftSidebar ? 'w-full md:w-0' : 'w-full'}`}>
              {childrenMain}
              <div className="h-[220px] md:hidden" />
            </main>
          </div>
        </div>
        </div>
      </div>
      {showAuthModal && (
        <AuthModal isOpen={showAuthModal} initialMode={authMode} onClose={() => setShowAuthModal(false)} />
      )}
      {showBillingModal && (
        <BillingModal isOpen={showBillingModal} onClose={() => setShowBillingModal(false)} />
      )}

      {/* Full-screen mobile menu overlay */}
      {showMobileMenu && (
        <div className="fixed inset-0 bg-black/90 z-50 flex">
          <div className="m-auto w-full max-w-sm bg-[#111] border border-white/10 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">Menu</h3>
              <button onClick={() => setShowMobileMenu(false)} className="px-2 py-1 bg-white/10 rounded">✕</button>
            </div>
            <div className="flex flex-col gap-2">
              {TOOL_GROUPS.map((group) => (
                <div key={group.label} className="pb-2">
                  <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">{group.label}</div>
                  {group.items.map((item) => (
                    item.comingSoon ? (
                      <div key={item.tool} className="block w-full text-left px-3 py-2 rounded-md mb-1 text-gray-500 cursor-not-allowed relative">
                        {item.label}
                        <span className="absolute top-1 right-1 text-xs bg-yellow-500/20 text-yellow-400 px-1 rounded text-[10px]">
                          SOON
                        </span>
                      </div>
                    ) : (
                      <Link key={item.href} href={item.href} onClick={()=>setShowMobileMenu(false)} className={`block w-full text-left px-3 py-2 rounded-md mb-1 transition-colors ${selectedTool === item.tool ? 'bg-white text-black' : 'bg-white/10 text-white'}`}>{item.label}</Link>
                    )
                  ))}
                </div>
              ))}
            </div>
            
            {/* Legal links in mobile menu */}
            <div className="mt-6 pt-4 border-t border-white/20">
              <div className="text-xs uppercase tracking-wide text-gray-400 px-2 mb-2">Legal</div>
              <div className="flex flex-col">
                <Link href="/legal/terms" onClick={() => setShowMobileMenu(false)} className="block w-full text-left px-3 py-2 rounded-md mb-1 transition-colors bg-white/10 text-white hover:bg-white/20">Terms of Service</Link>
                <Link href="/legal/privacy" onClick={() => setShowMobileMenu(false)} className="block w-full text-left px-3 py-2 rounded-md mb-1 transition-colors bg-white/10 text-white hover:bg-white/20">Privacy Policy</Link>
                <a href="mailto:support@cooly.ai" onClick={() => setShowMobileMenu(false)} className="block w-full text-left px-3 py-2 rounded-md mb-1 transition-colors bg-white/10 text-white hover:bg-white/20">Contact Support</a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile settings drawer */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end lg:hidden" onClick={()=>setShowSettings(false)}>
          <div className="w-full max-h-[80vh] bg-[#18181b] border-t border-white/10 rounded-t-xl p-4" onClick={(e)=>e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold">Settings</h3>
              <button onClick={()=>setShowSettings(false)} className="px-2 py-1 bg-white/10 rounded">✕</button>
            </div>
            <div className="overflow-y-auto max-h-[70vh]">
              {mobileSettingsContent || childrenLeft}
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom prompt and generate bar */}
      {showMobilePrompt && (
        <div className="md:hidden fixed bottom-0 left-0 right-4 bg-[#18181b] border-t border-white/10 p-3 flex flex-col gap-2 z-40">
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 bg-white/10 rounded text-white" onClick={()=>setShowSettings(true)}>⚙</button>
            <div className="flex-1">
              {mobilePromptNode}
            </div>
          </div>
          <button disabled={mobileGenerateDisabled} onClick={onMobileGenerate} className={`w-full ${mobileGenerateDisabled ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white font-semibold py-3 px-6 rounded-lg transition-colors`}>
            {mobileCreditAmount ? `Generate (${mobileCreditAmount} credits)` : 'Generate'}
          </button>
        </div>
      )}
    </div>
  );
}


