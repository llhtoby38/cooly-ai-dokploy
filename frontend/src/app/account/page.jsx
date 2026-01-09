"use client";
import React, { useEffect, useState } from "react";
import phFetch from "../services/phFetch";
import AppShell from "../components/AppShell";
import { useApiBase } from "../hooks/useApiBase";
import { toErrorText } from "../utils/toErrorText";
import { useAuth } from '../contexts/AuthContext';

export default function AccountPage() {
  const { user, deleteAccount } = useAuth();
  const API_BASE = useApiBase();
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Subscription mgmt UI state
  const [submitting, setSubmitting] = useState(false);
  const [subMsg, setSubMsg] = useState("");
  const [subErr, setSubErr] = useState("");
  const [billingModeSel, setBillingModeSel] = useState('monthly');
  const [plansMonthly, setPlansMonthly] = useState([]);
  const [plansYearly, setPlansYearly] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);
  const [showSetPasswordModal, setShowSetPasswordModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  
  // Tab state
  const [activeTab, setActiveTab] = useState('account');
  
  // Credit usage state
  const [creditUsage, setCreditUsage] = useState([]);
  const [creditUsageLoading, setCreditUsageLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState('all');
  
  // Cursor pagination state
  const [pagination, setPagination] = useState({
    hasMore: false,
    hasPrevious: false,
    limit: 50
  });
  const [cursorStack, setCursorStack] = useState([]); // Stack of cursors for "Previous" navigation

  const fetchMe = async () => {
    try {
      setLoading(true);
      const res = await phFetch(`${API_BASE}/api/user/me`);
      if (!res.ok) throw new Error("Not authenticated");
      const j = await res.json();
      // Enrich with subscription billing mode
      try {
        const sres = await phFetch(`${API_BASE}/api/billing/me-subscription?ts=${Date.now()}`, { cache: 'no-store' });
        if (sres.ok) {
          const sj = await sres.json();
          if (sj.subscription) {
            setMe({ ...j, subscription: sj.subscription });
            return;
          }
        }
      } catch {}
      setMe(j);
    } catch (e) {
      setError("Please sign in");
    } finally {
      setLoading(false);
    }
  };

  // Load plans for change-plan UI when subscription tab is active
  useEffect(() => {
    const loadPlans = async () => {
      try {
        const [mRes, yRes] = await Promise.all([
          phFetch(`${API_BASE}/api/billing/public/plans?billingMode=monthly`),
          phFetch(`${API_BASE}/api/billing/public/plans?billingMode=yearly`),
        ]);
        const m = (await mRes.json()).plans || [];
        const y = (await yRes.json()).plans || [];
        setPlansMonthly(m.map(p => ({ id: p.id, name: p.name })));
        setPlansYearly(y.map(p => ({ id: p.id, name: p.name })));
        if (!selectedPlanId && m.length > 0) setSelectedPlanId(m[0].id);
      } catch (e) {
        // ignore
      }
    };
    if (activeTab === 'subscription') {
      loadPlans();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, API_BASE]);

  const fetchCreditUsage = async (cursor = null, direction = 'next') => {
    try {
      setCreditUsageLoading(true);
      
      // Calculate date range based on filter
      let startDate, endDate;
      const now = new Date();
      
      switch (dateFilter) {
        case 'last-30':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'last-7':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'september-2025':
          startDate = new Date('2025-09-01');
          endDate = new Date('2025-09-30T23:59:59');
          break;
        case 'august-september-2025':
          startDate = new Date('2025-08-01');
          endDate = new Date('2025-09-30T23:59:59');
          break;
        case 'ytd':
          startDate = new Date('2025-01-01');
          break;
        case 'all':
        default:
          // No date filtering
          break;
      }
      
      // Build query parameters
      const params = new URLSearchParams();
      if (startDate) {
        params.append('startDate', startDate.toISOString());
      }
      if (endDate) {
        params.append('endDate', endDate.toISOString());
      }
      if (cursor) {
        if (direction === 'next') {
          params.append('before', cursor);
        } else {
          params.append('after', cursor);
        }
      }
      params.append('limit', '50');
      
      const url = `${API_BASE}/api/user/credit-usage?${params.toString()}`;
      console.log('Fetching credit usage from:', url);
      const res = await phFetch(url);
      
      console.log('Response status:', res.status);
      if (!res.ok) {
        const errorText = await res.text();
        console.error('API Error:', errorText);
        throw new Error(`Failed to fetch credit usage: ${res.status} ${errorText}`);
      }
      const data = await res.json();
      console.log('API Response:', data);
      
      setCreditUsage(data.transactions || []);
      setPagination(data.pagination || { hasMore: false, hasPrevious: false, limit: 50 });
      
    } catch (e) {
      console.error("Failed to fetch credit usage:", e);
      setCreditUsage([]);
      setPagination({ hasMore: false, hasPrevious: false, limit: 50 });
    } finally {
      setCreditUsageLoading(false);
    }
  };

  useEffect(() => {
    fetchMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === 'credit-usage') {
      // Reset pagination when date filter changes
      setCursorStack([]);
      fetchCreditUsage();
    }
  }, [activeTab, dateFilter]);

  // Pagination functions
  const loadNextPage = () => {
    if (creditUsage.length > 0 && pagination.hasMore) {
      const lastTransaction = creditUsage[creditUsage.length - 1];
      const cursor = lastTransaction.created_at;
      
      // Push current cursor to stack for "Previous" navigation
      setCursorStack(prev => [...prev, cursor]);
      fetchCreditUsage(cursor, 'next');
    }
  };

  const loadPreviousPage = () => {
    if (cursorStack.length > 0) {
      const previousCursor = cursorStack[cursorStack.length - 1];
      const newStack = cursorStack.slice(0, -1);
      
      setCursorStack(newStack);
      fetchCreditUsage(previousCursor, 'previous');
    }
  };

  const setPassword = async () => {
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setSettingPassword(true);
    setError("");

    try {
      const res = await phFetch(`${API_BASE}/api/auth/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword })
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Failed to set password");
      } else {
        setShowSetPassword(false);
        setNewPassword("");
        setConfirmPassword("");
        await fetchMe(); // Refresh user data
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setSettingPassword(false);
    }
  };

  const unlink = async () => {
    setError("");
    const res = await phFetch(`${API_BASE}/api/auth/unlink/google`, {
      method: "POST",
    });
    
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.requiresPassword) {
        setShowSetPassword(true);
        setError("Set a password first to unlink Google");
      } else {
        setError(j.error || "Failed to unlink");
      }
    } else {
      await fetchMe();
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm('Are you absolutely sure? This action cannot be undone and will permanently delete your account and all your data.')) {
      return;
    }

    setDeleteAccountLoading(true);
    try {
      const result = await deleteAccount();
      
      if (result.success) {
        // Account deleted successfully, redirect to home
        window.location.href = '/';
      } else {
        alert(`Failed to delete account: ${result.error}`);
      }
    } catch (error) {
      console.error('Delete account error:', error);
      alert('Failed to delete account. Please try again.');
    } finally {
      setDeleteAccountLoading(false);
      setShowDeleteAccountModal(false);
    }
  };

  // Tab content components
  const AccountTab = () => (
    <div className="space-y-6">
      {loading ? (
        <div>Loading…</div>
      ) : error ? (
        <div className="text-red-400">{toErrorText(error)}</div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-gray-800 rounded">
            <div><span className="text-gray-400">Email:</span> {me.email}</div>
            <div><span className="text-gray-400">Available Credits:</span> {typeof me.available_credits === 'number' ? me.available_credits : (me.credits || 0)}</div>
            <div><span className="text-gray-400">Total Credits:</span> {me.credits}</div>
            <div><span className="text-gray-400">Provider:</span> {me.provider || "local"}</div>
            {me.last_login_at && (
              <div><span className="text-gray-400">Last login:</span> {new Date(me.last_login_at).toLocaleString()}</div>
            )}
          </div>

          {/* Connected Accounts Section */}
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold mb-2">Connected accounts</h3>
              <p className="text-sm text-gray-400 mb-4">
                Manage the social media accounts connected to your profile for easy login.
              </p>
            </div>
            
            <div className="space-y-3">
              {/* Google Account */}
              <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg border border-gray-700">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                  </div>
                  <span className="text-white font-medium">Google</span>
                </div>
                
                <div className="flex items-center gap-3">
                  {me.google_id ? (
                    <>
                      <span className="text-white text-sm">Connected</span>
                      <button
                        onClick={unlink}
                        className="px-3 py-1 text-sm border border-gray-600 text-gray-300 rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!me.google_id}
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-400 text-sm">Not connected</span>
                      <button
                        onClick={() => { window.location.href = `${API_BASE}/api/auth/google`; }}
                        className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                      >
                        Connect
                      </button>
                    </>
                  )}
                </div>
              </div>
              
              {/* Note for Google account */}
              {me.google_id && (
                <div className="text-xs text-gray-500">
                  <span className="font-medium">Note:</span> This account is needed for login and can't be disconnected. 
                  <a href="mailto:support@cooly.ai" className="text-blue-400 hover:text-blue-300 ml-1">
                    Contact us
                  </a> for more info. We are working on improving this experience.
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="text-red-400">{typeof error === 'string' ? error : (error?.message || error?.error || JSON.stringify(error))}</div>
          )}
        </div>
      )}

      {/* Delete Account Section */}
      <div className="border-t border-gray-700 pt-6 mt-8">
        <div className="space-y-4">
          <button
            onClick={() => setShowDeleteAccountModal(true)}
            className="px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition-colors border border-gray-600"
          >
            Delete account
          </button>
          
          {me?.subscription ? (
            <div className="text-sm text-gray-400">
              <span className="font-medium">Note:</span> As you have an active paid plan, you can't delete your account directly. 
              Please contact <a href="mailto:support@cooly.ai" className="text-blue-400 hover:text-blue-300">support@cooly.ai</a> for assistance.
            </div>
          ) : (
            <div className="text-sm text-gray-400">
              <span className="font-medium">Note:</span> This will permanently delete your account and all associated data. This action cannot be undone.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const CreditUsageTab = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Credit Usage History</h2>
        <div className="text-sm text-gray-400 flex items-center gap-3">
          <span>Available:</span>
          <span className="font-semibold text-white">{typeof me?.available_credits === 'number' ? me.available_credits : (me?.credits || 0)}</span>
          <span className="mx-1 opacity-50">|</span>
          <span>Total:</span>
          <span className="font-semibold text-white">{me?.credits || 0}</span>
        </div>
      </div>
      
      {/* Date Filter */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-gray-300">Filter by:</label>
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="all">All time</option>
          <option value="last-7">Last 7 days</option>
          <option value="last-30">Last 30 days</option>
          <option value="september-2025">September 2025</option>
          <option value="august-september-2025">August - September 2025</option>
          <option value="ytd">Year to date (2025)</option>
        </select>
      </div>
      
      {creditUsageLoading ? (
        <div className="text-center py-8">
          <div className="inline-block h-6 w-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          <div className="mt-2 text-gray-400">Loading credit usage...</div>
        </div>
      ) : creditUsage.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          No credit usage history found for the selected period.
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {creditUsage.map((transaction, index) => (
              <div key={index} className="p-4 bg-gray-800 rounded-lg border border-gray-700">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{transaction.description || 'Credit Transaction'}</div>
                    <div className="text-sm text-gray-400">
                      {new Date(transaction.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className={`font-semibold ${transaction.amount < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {transaction.amount > 0 ? '+' : ''}{transaction.amount}
                  </div>
                </div>
                {transaction.balance_after && (
                  <div className="text-xs text-gray-500 mt-1">
                    Balance after: {transaction.balance_after}
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {/* Pagination Controls */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-700">
            <button
              onClick={loadPreviousPage}
              disabled={cursorStack.length === 0 || creditUsageLoading}
              className="px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-gray-600"
            >
              ← Previous
            </button>
            
            <div className="text-sm text-gray-400">
              Showing {creditUsage.length} transactions
            </div>
            
            <button
              onClick={loadNextPage}
              disabled={!pagination.hasMore || creditUsageLoading}
              className="px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-gray-600"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );

  const SubscriptionTab = () => (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Subscription</h2>
      
      {me?.subscription ? (
        <div className="p-6 bg-gray-800 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Active Subscription</h3>
            <span className="px-3 py-1 bg-green-600 text-white text-sm rounded-full">
              {me.subscription.status}
            </span>
          </div>
          
          <div className="space-y-2">
            <div>
              <span className="text-gray-400">Plan:</span> {(() => {
                const id = me.subscription.plan_id || '';
                const cap = id ? id.charAt(0).toUpperCase() + id.slice(1) : '';
                const mode = me.subscription.billing_mode === 'yearly' ? 'Yearly' : (me.subscription.billing_mode === 'monthly' ? 'Monthly' : null);
                return <>
                  <span className="ml-1 text-white font-medium">{cap}</span>
                  {mode && <span className="text-gray-400 ml-2">— {mode}</span>}
                </>;
              })()}
            </div>
            <div><span className="text-gray-400">Status:</span> {me.subscription.status}</div>
            {me.subscription.current_period_end && (
              <div><span className="text-gray-400">Renews:</span> {new Date(me.subscription.current_period_end).toLocaleDateString()}</div>
            )}
            {/* Pending change */}
            {me.subscription.pending_change && (
              <div className="text-yellow-300">
                <span className="text-gray-400">Pending change:</span> {(() => {
                  const pc = me.subscription.pending_change;
                  const name = pc.plan_display_name || (pc.new_plan_key ? pc.new_plan_key.charAt(0).toUpperCase() + pc.new_plan_key.slice(1) : '');
                  const mode = pc.billing_mode ? (pc.billing_mode === 'yearly' ? 'Yearly' : 'Monthly') : '';
                  const when = pc.effective_at ? new Date(pc.effective_at).toLocaleDateString() : '';
                  if (pc.event_type === 'cancel_scheduled') {
                    return <>Will cancel at period end on <span className="font-medium text-yellow-200">{when}</span></>;
                  }
                  if (pc.event_type === 'resume_scheduled') {
                    return <>Resume scheduled on <span className="font-medium text-yellow-2 00">{when}</span></>;
                  }
                  return <>Will change to <span className="font-medium text-yellow-200">{name}</span>{mode ? <> — {mode}</> : null} on <span className="font-medium text-yellow-200">{when}</span></>;
                })()}
              </div>
            )}
            {/* Next invoice */}
            {me.subscription.next_invoice && (
              <div>
                <span className="text-gray-400">Next charge:</span> {(() => {
                  const ni = me.subscription.next_invoice;
                  const dollars = (Number(ni.amount_cents || 0) / 100).toFixed(2);
                  const when = ni.due_at ? new Date(ni.due_at).toLocaleString() : '—';
                  return <><span className="text-white font-medium">${dollars}</span> on {when}</>;
                })()}
              </div>
            )}
          </div>

          {/* Manage actions */}
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="p-4 bg-gray-900 rounded border border-gray-700">
              <div className="font-medium mb-2">Manage in Billing Portal</div>
              <p className="text-sm text-gray-400 mb-3">Update payment method, download invoices, or cancel.</p>
              <button
                onClick={async () => {
                  setSubmitting(true); setSubErr(""); setSubMsg("");
                  try {
                    const r = await fetch(`${API_BASE}/api/billing/create-portal-session`, { method: 'POST', credentials: 'include' });
                    const d = await r.json();
                    if (!r.ok) throw new Error(d.error || 'Failed to open portal');
                    window.location.href = d.url;
                  } catch (e) { setSubErr(e.message); }
                  finally { setSubmitting(false); }
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                disabled={submitting}
              >Open Billing Portal</button>
            </div>

            <div className="p-4 bg-gray-900 rounded border border-gray-700">
              <div className="font-medium mb-2">Change Plan</div>
              <p className="text-sm text-gray-400 mb-3">Switch plans or billing periods in the dedicated Change Plan page.</p>
              <button
                onClick={() => { window.location.href = '/billing'; }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
                disabled={submitting}
              >Change Plan</button>
            </div>

            <div className="p-4 bg-gray-900 rounded border border-gray-700">
              <div className="font-medium mb-2">Cancellation</div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setSubmitting(true); setSubErr(""); setSubMsg("");
                    try {
                      const r = await fetch(`${API_BASE}/api/billing/cancel`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ atPeriodEnd: true }) });
                      const d = await r.json();
                      if (!r.ok) throw new Error(d.error || 'Failed to cancel');
                      setSubMsg('Cancellation scheduled at period end.');
                      await fetchMe();
                    } catch (e) { setSubErr(e.message); }
                    finally { setSubmitting(false); }
                  }}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded disabled:opacity-50"
                  disabled={submitting}
                >Cancel at period end</button>
                <button
                  onClick={async () => {
                    setSubmitting(true); setSubErr(""); setSubMsg("");
                    try {
                      const r = await fetch(`${API_BASE}/api/billing/resume`, { method: 'POST', credentials: 'include' });
                      const d = await r.json();
                      if (!r.ok) throw new Error(d.error || 'Failed to resume');
                      setSubMsg('Subscription resumed.');
                      await fetchMe();
                    } catch (e) { setSubErr(e.message); }
                    finally { setSubmitting(false); }
                  }}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded disabled:opacity-50"
                  disabled={submitting}
                >Resume</button>
              </div>
              {(subMsg || subErr) && (
                <div className={`mt-3 text-sm ${subErr? 'text-red-400':'text-green-400'}`}>{subErr || subMsg}</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-6 bg-gray-800 rounded-lg border border-gray-700 text-center">
          <h3 className="text-lg font-semibold mb-2">No Active Subscription</h3>
          <p className="text-gray-400 mb-4">You're currently using the free tier with credit-based pricing.</p>
          <button
            onClick={() => window.location.href = '/billing'}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md"
          >
            View Billing Options
          </button>
        </div>
      )}
    </div>
  );

  return (
    <AppShell
      selectedTool="account"
      showMobilePrompt={false}
      showLeftSidebar={false}
      childrenMain={
        <div className="max-w-4xl mx-auto pt-10">
          {/* Tab Navigation */}
          <div className="border-b border-gray-700 mb-8">
            <nav className="flex space-x-8">
              {[
                { id: 'account', label: 'Account' },
                { id: 'credit-usage', label: 'Credit Usage' },
                { id: 'subscription', label: 'Subscription' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="min-h-[400px]">
            {activeTab === 'account' && <AccountTab />}
            {activeTab === 'credit-usage' && <CreditUsageTab />}
            {activeTab === 'subscription' && <SubscriptionTab />}
          </div>

          {/* Modals */}
          {/* Delete Account Confirmation Modal */}
          {showDeleteAccountModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                <h3 className="text-lg font-semibold text-red-800 mb-4">Delete Account</h3>
                <p className="text-gray-600 mb-6">
                  This will permanently delete your account and all your data including:
                </p>
                <ul className="text-sm text-gray-600 mb-6 space-y-1">
                  <li>• All generated images and videos</li>
                  <li>• Account settings and preferences</li>
                  <li>• Billing and subscription information</li>
                  <li>• Generation history and credits</li>
                </ul>
                <p className="text-red-600 font-medium mb-6">
                  This action cannot be undone.
                </p>
                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowDeleteAccountModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                    disabled={deleteAccountLoading}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
                    disabled={deleteAccountLoading}
                  >
                    {deleteAccountLoading ? 'Deleting...' : 'Delete Permanently'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Set Password Modal */}
          {showSetPassword && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-gray-900 rounded-lg p-8 w-full max-w-md border border-gray-700">
                <h2 className="text-2xl font-bold mb-6">Set Password</h2>
                <p className="text-gray-300 mb-4">
                  Set a password to enable unlinking your Google account.
                </p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                      placeholder="Enter new password (min 8 characters)"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                      placeholder="Confirm new password"
                      required
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={() => setShowSetPassword(false)}
                      className="flex-1 px-4 py-2 border border-gray-600 text-gray-300 rounded-md hover:bg-gray-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={setPassword}
                      disabled={settingPassword}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-semibold py-2 px-4 rounded-md"
                    >
                      {settingPassword ? "Setting..." : "Set Password"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      }
    />
  );
}


