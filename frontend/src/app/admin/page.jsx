'use client';

import { useState, useEffect } from 'react';
import phFetch from '../services/phFetch';
import { FaUsers, FaDollarSign, FaChartLine, FaCog, FaSignOutAlt, FaSearch, FaPlus, FaEye, FaList, FaHeartbeat } from 'react-icons/fa';
import AdminCostsPage from './costs/page';
import MonitoringTab from '../components/MonitoringTab';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:5000';

export default function AdminDashboard() {
  const safeDate = (val) => {
    if (!val) return '—';
    const d = new Date(val);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : '—';
  };
  const safeDateOnly = (val) => {
    if (!val) return '—';
    const d = new Date(val);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : '—';
  };
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [dashboardData, setDashboardData] = useState(null);
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState(null);
  // Pricing state
  const [plans, setPlans] = useState([]);
  const [packages, setPackages] = useState([]);
  const [modelPricing, setModelPricing] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [txPage, setTxPage] = useState(1);
  const [subEvents, setSubEvents] = useState([]);
  const [subPage, setSubPage] = useState(1);
  const [subEmail, setSubEmail] = useState('');
  const [subEventType, setSubEventType] = useState('');
  const [subPlan, setSubPlan] = useState('');
  const [subStart, setSubStart] = useState('');
  const [subEnd, setSubEnd] = useState('');
  const [subTotalPages, setSubTotalPages] = useState(1);

  // Financials
  const [finSummary, setFinSummary] = useState([]);
  const [finLedger, setFinLedger] = useState([]);
  const [finPage, setFinPage] = useState(1);
  const [finTotalPages, setFinTotalPages] = useState(1);
  const [finSide, setFinSide] = useState('');
  const [finCategory, setFinCategory] = useState('');
  const [finStart, setFinStart] = useState('');
  const [finEnd, setFinEnd] = useState('');
  const [finGroupBy, setFinGroupBy] = useState('month');
  const [txEmail, setTxEmail] = useState('');
  const [txStart, setTxStart] = useState('');
  const [txEnd, setTxEnd] = useState('');
  const [txTotalPages, setTxTotalPages] = useState(1);

  // Settings state
  const [settings, setSettings] = useState({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const workerConcurrencySetting = settings?.gen_worker_concurrency;
  const workerConcurrencyUnset =
    workerConcurrencySetting === null ||
    typeof workerConcurrencySetting === 'undefined' ||
    workerConcurrencySetting === '' ||
    workerConcurrencySetting === 'null';
  const workerConcurrencyInputValue = workerConcurrencyUnset ? '' : String(workerConcurrencySetting);

  // Login state
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (isAuthenticated && activeTab === 'users') {
      fetchUsers(1, '');
    }
  }, [isAuthenticated, activeTab]);

  useEffect(() => {
    if (isAuthenticated && activeTab === 'pricing') {
      fetchPlans();
      fetchPackages();
      fetchModelPricing();
    }
  }, [isAuthenticated, activeTab]);

  useEffect(() => {
    if (isAuthenticated && activeTab === 'transactions') {
      fetchTransactions(1);
    }
  }, [isAuthenticated, activeTab]);

  useEffect(() => {
    if (isAuthenticated && activeTab === 'subscriptions') {
      fetchSubEvents(1);
    }
  }, [isAuthenticated, activeTab]);

  useEffect(() => {
    if (isAuthenticated && activeTab === 'financials') {
      fetchFinSummary();
      fetchFinLedger(1);
    }
  }, [isAuthenticated, activeTab]);

  useEffect(() => {
    if (isAuthenticated && activeTab === 'settings') {
      loadSettings();
    }
  }, [isAuthenticated, activeTab]);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      if (!token) {
        setLoading(false);
        return;
      }

      // Verify token by making a request to dashboard
      const response = await phFetch(`${API_BASE}/api/admin/dashboard`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        setIsAuthenticated(true);
        const data = await response.json();
        setDashboardData(data);
      } else {
        localStorage.removeItem('adminToken');
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      localStorage.removeItem('adminToken');
    } finally {
      setLoading(false);
    }
  };

  const fetchFinSummary = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const params = new URLSearchParams({
        groupBy: finGroupBy,
        ...(finStart && { startDate: finStart }),
        ...(finEnd && { endDate: finEnd })
      });
      const res = await phFetch(`${API_BASE}/api/admin/finance/summary?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setFinSummary(data.summary || []);
      }
    } catch (e) {
      console.error('Failed to fetch finance summary', e);
    }
  };

  const fetchFinLedger = async (page = 1) => {
    try {
      const token = localStorage.getItem('adminToken');
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50',
        ...(finSide && { side: finSide }),
        ...(finCategory && { category: finCategory }),
        ...(finStart && { startDate: finStart }),
        ...(finEnd && { endDate: finEnd })
      });
      const res = await phFetch(`${API_BASE}/api/admin/finance/ledger?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        const rows = Array.isArray(data.ledger) ? data.ledger : [];
        // Deduplicate by external_id (Stripe invoice id) or fallback to id
        const seen = new Set();
        const unique = [];
        for (const r of rows) {
          const key = r.external_id || r.id;
          if (!key) { unique.push(r); continue; }
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(r);
        }
        setFinLedger(unique);
        setFinPage(data.pagination.page);
        setFinTotalPages(data.pagination.pages);
      }
    } catch (e) {
      console.error('Failed to fetch finance ledger', e);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');

    try {
      const response = await phFetch(`${API_BASE}/api/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(loginForm)
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('adminToken', data.token);
        setAdmin(data.admin);
        setIsAuthenticated(true);
        await fetchDashboardData();
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch (error) {
      setLoginError('Network error. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await phFetch(`${API_BASE}/api/admin/dashboard`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setDashboardData(data);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    }
  };

  const loadSettings = async () => {
    try {
      setSettingsLoading(true);
      const token = localStorage.getItem('adminToken');
      const res = await phFetch(`${API_BASE}/api/admin/settings`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || {});
      }
    } catch (e) {
      console.error('Failed to load settings', e);
    } finally {
      setSettingsLoading(false);
    }
  };

  const updateSetting = async (key, value) => {
    try {
      const token = localStorage.getItem('adminToken');
      const res = await phFetch(`${API_BASE}/api/admin/settings/${key}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(prev => ({ ...prev, [key]: data.setting?.value }));
      }
    } catch (e) {
      console.error('Failed to update setting', e);
    }
  };

  const deleteAccount = async () => {
    if (!deleteEmail) {
      alert('Enter an email to delete');
      return;
    }
    const confirmText = `Type DELETE to confirm deleting account: ${deleteEmail}`;
    const input = prompt(confirmText);
    if (input !== 'DELETE') return;
    try {
      setDeleteLoading(true);
      const token = localStorage.getItem('adminToken');
      const params = new URLSearchParams({ email: deleteEmail });
      const res = await phFetch(`${API_BASE}/api/admin/users?${params.toString()}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        alert('Account soft-deleted');
        setDeleteEmail('');
        // refresh any lists
        if (activeTab === 'users') fetchUsers(1, '');
      } else {
        alert(`Failed: ${data.error || res.status}`);
      }
    } catch (e) {
      alert('Network error deleting account');
    } finally {
      setDeleteLoading(false);
    }
  };

  const fetchUsers = async (page = 1, search = '') => {
    try {
      const token = localStorage.getItem('adminToken');
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50',
        ...(search && { search })
      });

      const response = await phFetch(`${API_BASE}/api/admin/users?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setUsers(data.users);
        setCurrentPage(page);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };

  const fetchPlans = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const res = await phFetch(`${API_BASE}/api/admin/pricing/plans`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans);
      }
    } catch {}
  };

  const fetchPackages = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const res = await phFetch(`${API_BASE}/api/admin/pricing/packages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPackages(data.packages);
      }
    } catch {}
  };

  const fetchModelPricing = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const res = await phFetch(`${API_BASE}/api/admin/pricing/models`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setModelPricing(data.models);
      }
    } catch {}
  };

  const fetchTransactions = async (page = 1) => {
    try {
      const token = localStorage.getItem('adminToken');
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50',
        ...(txEmail && { email: txEmail }),
        ...(txStart && { startDate: txStart }),
        ...(txEnd && { endDate: txEnd })
      });
      const res = await phFetch(`${API_BASE}/api/admin/transactions?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions);
        setTxPage(data.pagination.page);
        setTxTotalPages(data.pagination.pages);
      }
    } catch (e) {
      console.error('Failed to fetch transactions', e);
    }
  };

  const fetchSubEvents = async (page = 1) => {
    try {
      const token = localStorage.getItem('adminToken');
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50',
        ...(subEmail && { email: subEmail }),
        ...(subEventType && { event_type: subEventType }),
        ...(subPlan && { plan_key: subPlan }),
        ...(subStart && { startDate: subStart }),
        ...(subEnd && { endDate: subEnd })
      });
      const res = await phFetch(`${API_BASE}/api/admin/subscriptions/history?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSubEvents(data.events);
        setSubPage(data.pagination.page);
        setSubTotalPages(data.pagination.pages);
      }
    } catch (e) {
      console.error('Failed to fetch subscription events', e);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    setIsAuthenticated(false);
    setAdmin(null);
    setDashboardData(null);
    setUsers([]);
    setActiveTab('overview');
  };

  const adjustUserCredits = async (userId, amount, reason) => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await phFetch(`${API_BASE}/api/admin/users/${userId}/credits`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ amount, reason })
      });

      if (response.ok) {
        // Refresh dashboard and user data
        await fetchDashboardData();
        await fetchUsers(currentPage, userSearch);
        if (selectedUser?.id === userId) {
          // Refresh selected user details
          const userResponse = await phFetch(`${API_BASE}/api/admin/users/${userId}`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          if (userResponse.ok) {
            const userData = await userResponse.json();
            setSelectedUser(userData.user);
          }
        }
        alert('Credits adjusted successfully!');
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      alert('Failed to adjust credits');
    }
  };

  // Inline components for Pricing management
  const PricingPlans = () => {
    const [editingId, setEditingId] = useState(null);
    const [draft, setDraft] = useState({});

    const startEdit = (p) => {
      setEditingId(p.id);
      setDraft({
        priceDollars: (p.price_cents / 100).toFixed(2),
        credits: p.credits_per_period,
        is_active: p.is_active
      });
    };

    const cancelEdit = () => {
      setEditingId(null);
      setDraft({});
    };

    const saveEdit = async (p) => {
      try {
        const token = localStorage.getItem('adminToken');
        const body = {
          id: p.id,
          plan_key: p.plan_key,
          billing_mode: p.billing_mode,
          display_name: p.display_name,
          price_cents: Math.round(Number(draft.priceDollars) * 100),
          credits_per_period: Number(draft.credits),
          is_active: Boolean(draft.is_active),
          sort_order: p.sort_order
        };
        const res = await phFetch(`${API_BASE}/api/admin/pricing/plans`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(`Save failed: ${err.error || res.status}`);
          return;
        }
        await fetchPlans();
        cancelEdit();
        alert('Plan saved');
      } catch (e) {
        alert('Network error saving plan');
      }
    };

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Plan</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Mode</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Price</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Credits/Period</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Active</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {plans.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 text-white">{p.display_name}</td>
                <td className="px-4 py-2 text-white">{p.billing_mode}</td>
                <td className="px-4 py-2 text-white">
                  {editingId === p.id ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draft.priceDollars}
                      onChange={(e) => setDraft({ ...draft, priceDollars: e.target.value })}
                      className="w-28 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                    />
                  ) : (
                    `$${(p.price_cents / 100).toFixed(2)}`
                  )}
                </td>
                <td className="px-4 py-2 text-white">
                  {editingId === p.id ? (
                    <input
                      type="number"
                      min="0"
                      value={draft.credits}
                      onChange={(e) => setDraft({ ...draft, credits: e.target.value })}
                      className="w-28 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                    />
                  ) : (
                    p.credits_per_period.toLocaleString()
                  )}
                </td>
                <td className="px-4 py-2 text-white">
                  {editingId === p.id ? (
                    <input
                      type="checkbox"
                      checked={!!draft.is_active}
                      onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                    />
                  ) : (
                    p.is_active ? 'Yes' : 'No'
                  )}
                </td>
                <td className="px-4 py-2 text-white">
                  {editingId === p.id ? (
                    <div className="space-x-2">
                      <button onClick={() => saveEdit(p)} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded">Save</button>
                      <button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1 rounded">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => startEdit(p)} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded">Edit</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const CreditPackages = () => {
    const [editingId, setEditingId] = useState(null);
    const [draft, setDraft] = useState({});

    const startEdit = (pkg) => {
      setEditingId(pkg.id);
      setDraft({
        display_name: pkg.display_name,
        credits: pkg.credits,
        priceDollars: (pkg.price_cents / 100).toFixed(2),
        is_active: pkg.is_active
      });
    };

    const cancelEdit = () => {
      setEditingId(null);
      setDraft({});
    };

    const saveEdit = async (pkg) => {
      try {
        const token = localStorage.getItem('adminToken');
        const body = {
          id: pkg.id,
          display_name: draft.display_name,
          credits: Number(draft.credits),
          price_cents: Math.round(Number(draft.priceDollars) * 100),
          is_active: Boolean(draft.is_active),
          sort_order: pkg.sort_order
        };
        const res = await phFetch(`${API_BASE}/api/admin/pricing/packages`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(`Save failed: ${err.error || res.status}`);
          return;
        }
        await fetchPackages();
        cancelEdit();
        alert('Package saved');
      } catch (e) {
        alert('Network error saving package');
      }
    };

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Name</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Credits</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Price</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Active</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {packages.map((pkg) => (
              <tr key={pkg.id}>
                <td className="px-4 py-2 text-white">
                  {editingId === pkg.id ? (
                    <input
                      type="text"
                      value={draft.display_name}
                      onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
                      className="w-48 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                    />
                  ) : (
                    pkg.display_name
                  )}
                </td>
                <td className="px-4 py-2 text-white">
                  {editingId === pkg.id ? (
                    <input
                      type="number"
                      min="0"
                      value={draft.credits}
                      onChange={(e) => setDraft({ ...draft, credits: e.target.value })}
                      className="w-28 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                    />
                  ) : (
                    pkg.credits.toLocaleString()
                  )}
                </td>
                <td className="px-4 py-2 text-white">
                  {editingId === pkg.id ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draft.priceDollars}
                      onChange={(e) => setDraft({ ...draft, priceDollars: e.target.value })}
                      className="w-28 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                    />
                  ) : (
                    `$${(pkg.price_cents / 100).toFixed(2)}`
                  )}
                </td>
                <td className="px-4 py-2 text-white">
                  {editingId === pkg.id ? (
                    <input
                      type="checkbox"
                      checked={!!draft.is_active}
                      onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                    />
                  ) : (
                    pkg.is_active ? 'Yes' : 'No'
                  )}
                </td>
                <td className="px-4 py-2 text-white">
                  {editingId === pkg.id ? (
                    <div className="space-x-2">
                      <button onClick={() => saveEdit(pkg)} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded">Save</button>
                      <button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1 rounded">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => startEdit(pkg)} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded">Edit</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const ModelPricing = () => {
    const [editingId, setEditingId] = useState(null);
    const [draft, setDraft] = useState({});

    const startEdit = (m) => {
      setEditingId(m.id);
      setDraft({
        display_name: m.display_name,
        operation: m.operation,
        unit: m.unit,
        credit_cost_per_unit: m.credit_cost_per_unit,
        is_active: m.is_active
      });
    };

    const cancelEdit = () => {
      setEditingId(null);
      setDraft({});
    };

    const saveEdit = async (m) => {
      try {
        const token = localStorage.getItem('adminToken');
        const body = {
          id: m.id,
          model_key: m.model_key,
          display_name: draft.display_name,
          operation: draft.operation,
          unit: draft.unit,
          credit_cost_per_unit: Number(draft.credit_cost_per_unit),
          is_active: Boolean(draft.is_active)
        };
        const res = await fetch(`${API_BASE}/api/admin/pricing/models`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(`Save failed: ${err.error || res.status}`);
          return;
        }
        await fetchModelPricing();
        cancelEdit();
        alert('Model pricing saved');
      } catch (e) {
        alert('Network error saving model pricing');
      }
    };

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Model</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Operation</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Unit</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Credit cost / unit</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Active</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {modelPricing.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2 text-white">
                  {editingId === m.id ? (
                    <input
                      type="text"
                      value={draft.display_name}
                      onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
                      className="w-56 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                    />
                  ) : (
                    m.display_name
                  )}
                </td>
                <td className="px-4 py-2 text-white">
                  {editingId === m.id ? (
                    <input
                      type="text"
                      value={draft.operation}
                      onChange={(e) => setDraft({ ...draft, operation: e.target.value })}
                      className="w-28 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                    />
                  ) : (
                    m.operation
                  )}
                </td>
                <td className="px-4 py-2 text-white">
                  {editingId === m.id ? (
                    <input
                      type="text"
                      value={draft.unit}
                      onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                      className="w-28 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                    />
                  ) : (
                    m.unit
                  )}
                </td>
                <td className="px-4 py-2 text-white">
                  {editingId === m.id ? (
                    <input
                      type="number"
                      min="0"
                      value={draft.credit_cost_per_unit}
                      onChange={(e) => setDraft({ ...draft, credit_cost_per_unit: e.target.value })}
                      className="w-28 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                    />
                  ) : (
                    m.credit_cost_per_unit
                  )}
                </td>
                <td className="px-4 py-2 text-white">
                  {editingId === m.id ? (
                    <input
                      type="checkbox"
                      checked={!!draft.is_active}
                      onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                    />
                  ) : (
                    m.is_active ? 'Yes' : 'No'
                  )}
                </td>
                <td className="px-4 py-2 text-white">
                  {editingId === m.id ? (
                    <div className="space-x-2">
                      <button onClick={() => saveEdit(m)} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded">Save</button>
                      <button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1 rounded">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => startEdit(m)} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded">Edit</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-gray-800 p-8 rounded-lg w-full max-w-md">
          <h1 className="text-2xl font-bold text-white mb-6 text-center">Admin Login</h1>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Email
              </label>
              <input
                type="email"
                value={loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Password
              </label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            {loginError && (
              <div className="text-red-400 text-sm">{loginError}</div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md disabled:opacity-50"
            >
              {loginLoading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-semibold text-white">Admin Dashboard</h1>
            <div className="flex items-center space-x-4">
              <span className="text-gray-300">Welcome, {admin?.email}</span>
              <button
                onClick={handleLogout}
                className="flex items-center space-x-2 text-gray-300 hover:text-white"
              >
                <FaSignOutAlt />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {[ 
              { id: 'overview', label: 'Overview', icon: FaChartLine },
              { id: 'users', label: 'Users', icon: FaUsers },
              { id: 'subscriptions', label: 'Subscriptions', icon: FaList },
              { id: 'transactions', label: 'Transactions', icon: FaList },
              { id: 'financials', label: 'Financials', icon: FaDollarSign },
              { id: 'costs', label: 'Costs', icon: FaDollarSign },
              { id: 'pricing', label: 'Pricing', icon: FaCog },
              { id: 'monitoring', label: 'Monitoring', icon: FaHeartbeat },
              { id: 'settings', label: 'Settings', icon: FaCog }
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-gray-300 hover:text-white hover:border-gray-300'
                  }`}
                >
                  <Icon />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 overflow-y-auto">
        {activeTab === 'overview' && dashboardData && (
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="flex items-center">
                  <FaUsers className="text-blue-400 text-2xl" />
                  <div className="ml-4">
                    <p className="text-gray-400 text-sm">Total Users</p>
                    <p className="text-2xl font-semibold text-white">{dashboardData.overview.totalUsers}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="flex items-center">
                  <FaDollarSign className="text-green-400 text-2xl" />
                  <div className="ml-4">
                    <p className="text-gray-400 text-sm">Revenue (30d)</p>
                    <p className="text-2xl font-semibold text-white">${dashboardData.overview.revenue.toFixed(2)}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="flex items-center">
                  <FaChartLine className="text-purple-400 text-2xl" />
                  <div className="ml-4">
                    <p className="text-gray-400 text-sm">Active Subscriptions</p>
                    <p className="text-2xl font-semibold text-white">{dashboardData.overview.activeSubscriptions}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="flex items-center">
                  <FaCog className="text-orange-400 text-2xl" />
                  <div className="ml-4">
                    <p className="text-gray-400 text-sm">Credits Used (30d)</p>
                    <p className="text-2xl font-semibold text-white">{dashboardData.overview.creditUsage.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-4">Recent Users</h3>
                <div className="space-y-3">
                  {dashboardData.recentUsers.map((user, idx) => (
                    <div key={`${user.id}-${idx}`} className="flex justify-between items-center">
                      <div>
                        <p className="text-white">{user.email}</p>
                        <p className="text-gray-400 text-sm">{safeDateOnly(user.created_at)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-white">{user.credits} credits</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-4">Recent Transactions</h3>
                <div className="space-y-3">
                  {dashboardData.recentTransactions.map((transaction) => (
                    <div key={transaction.id} className="flex justify-between items-center">
                      <div>
                        <p className="text-white">{transaction.user_email}</p>
                        <p className="text-gray-400 text-sm">{transaction.description}</p>
                      </div>
                      <div className="text-right">
                        <p className={`${transaction.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {transaction.amount > 0 ? '+' : ''}{transaction.amount}
                        </p>
                        <p className="text-gray-400 text-sm">{safeDateOnly(transaction.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            {/* User Search */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <div className="flex space-x-4">
                <div className="flex-1">
                  <div className="relative">
                    <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search users by email..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <button
                  onClick={() => fetchUsers(1, userSearch)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md"
                >
                  Search
                </button>
              </div>
            </div>

            {/* Users Table */}
            <div className="bg-gray-800 rounded-lg overflow-hidden overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Credits
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Subscription
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Joined
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {users.map((user, idx) => (
                    <tr key={`${user.id}-${idx}`}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-white">{user.email}</div>
                          <div className="text-sm text-gray-400">{user.role}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        {user.credits.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        {user.subscription_status ? `${user.subscription_plan_name || user.plan_id || ''} ${user.subscription_billing_mode ? `— ${user.subscription_billing_mode}` : ''}` : 'None'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => setSelectedUser(user)}
                          className="text-blue-400 hover:text-blue-300 mr-4"
                        >
                          <FaEye />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex justify-center">
              <button
                onClick={() => fetchUsers(currentPage - 1, userSearch)}
                disabled={currentPage === 1}
                className="px-4 py-2 bg-gray-700 text-white rounded-md disabled:opacity-50 mr-2"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-white">Page {currentPage}</span>
              <button
                onClick={() => fetchUsers(currentPage + 1, userSearch)}
                className="px-4 py-2 bg-gray-700 text-white rounded-md ml-2"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {activeTab === 'pricing' && (
          <div className="space-y-8">
            {/* Subscription Plans */}
            <section className="bg-gray-800 p-6 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Subscription Plans</h3>
                <button
                  onClick={() => fetchPlans()}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-md"
                >
                  Refresh
                </button>
              </div>
              <PricingPlans />
            </section>

            {/* One-off Packages */}
            <section className="bg-gray-800 p-6 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">One-off Credit Packages</h3>
                <button
                  onClick={() => fetchPackages()}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-md"
                >
                  Refresh
                </button>
              </div>
              <CreditPackages />
            </section>

            {/* Model Pricing */}
            <section className="bg-gray-800 p-6 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Model Credit Costs</h3>
                <button
                  onClick={() => fetchModelPricing()}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-md"
                >
                  Refresh
                </button>
              </div>
              <ModelPricing />
            </section>
          </div>
        )}

        {activeTab === 'transactions' && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="col-span-1 md:col-span-1">
                  <label className="block text-gray-300 text-sm mb-1">Email</label>
                  <input value={txEmail} onChange={(e) => setTxEmail(e.target.value)} placeholder="user@email.com" className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
                </div>
                <div>
                  <label className="block text-gray-300 text-sm mb-1">Start date</label>
                  <input type="date" value={txStart} onChange={(e) => setTxStart(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
                </div>
                <div>
                  <label className="block text-gray-300 text-sm mb-1">End date</label>
                  <input type="date" value={txEnd} onChange={(e) => setTxEnd(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
                </div>
                <div className="flex items-end">
                  <button onClick={() => fetchTransactions(1)} className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md">Apply</button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-gray-800 rounded-lg overflow-hidden overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Description</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Balance After</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="px-6 py-3 text-sm text-gray-300">{new Date(t.created_at).toLocaleString()}</td>
                      <td className="px-6 py-3 text-sm text-white">{t.user_email}</td>
                      <td className="px-6 py-3 text-sm text-gray-300">{t.description}</td>
                      <td className={`px-6 py-3 text-sm text-right ${t.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>{t.amount > 0 ? `+${t.amount}` : t.amount}</td>
                      <td className="px-6 py-3 text-sm text-right text-gray-300">{t.balance_after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex justify-center items-center space-x-3">
              <button onClick={() => fetchTransactions(txPage - 1)} disabled={txPage <= 1} className="px-4 py-2 bg-gray-700 text-white rounded-md disabled:opacity-50">Previous</button>
              <span className="text-white">Page {txPage} / {txTotalPages}</span>
              <button onClick={() => fetchTransactions(txPage + 1)} disabled={txPage >= txTotalPages} className="px-4 py-2 bg-gray-700 text-white rounded-md disabled:opacity-50">Next</button>
            </div>
          </div>
        )}

        {activeTab === 'financials' && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                <div>
                  <label className="block text-gray-300 text-sm mb-1">Side</label>
                  <select value={finSide} onChange={(e) => setFinSide(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white">
                    <option value="">All</option>
                    <option value="income">Income</option>
                    <option value="cost">Cost</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-300 text-sm mb-1">Category</label>
                  <input value={finCategory} onChange={(e) => setFinCategory(e.target.value)} placeholder="subscription / one_off / provider_api" className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
                </div>
                <div>
                  <label className="block text-gray-300 text-sm mb-1">Start</label>
                  <input type="date" value={finStart} onChange={(e) => setFinStart(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
                </div>
                <div>
                  <label className="block text-gray-300 text-sm mb-1">End</label>
                  <input type="date" value={finEnd} onChange={(e) => setFinEnd(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
                </div>
                <div>
                  <label className="block text-gray-300 text-sm mb-1">Group by</label>
                  <select value={finGroupBy} onChange={(e) => setFinGroupBy(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white">
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button onClick={() => { fetchFinSummary(); fetchFinLedger(1); }} className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md">Apply</button>
                </div>
              </div>
            </div>

            {/* KPIs / Summary */}
            <div className="bg-gray-800 p-6 rounded-lg overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Period</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Income</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Cost</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Gross Margin</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {finSummary.map((row, idx) => {
                    const income = Number(row.income_cents || 0) / 100;
                    const cost = Number(row.cost_cents || 0) / 100;
                    const margin = income - cost;
                    return (
                      <tr key={idx}>
                        <td className="px-6 py-3 text-sm text-gray-300">{safeDateOnly(row.period)}</td>
                        <td className="px-6 py-3 text-sm text-right text-green-400">${income.toFixed(2)}</td>
                        <td className="px-6 py-3 text-sm text-right text-red-400">${cost.toFixed(2)}</td>
                        <td className="px-6 py-3 text-sm text-right text-white">${margin.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Ledger */}
            <div className="bg-gray-800 rounded-lg overflow-hidden overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Side</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Category</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Provider/Model</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Detail</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Amount</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {finLedger.map((r, idx) => (
                    <tr key={r.external_id || r.id}>
                      <td className="px-6 py-3 text-sm text-gray-300">{safeDate(r.created_at)}</td>
                      <td className="px-6 py-3 text-sm text-gray-300">{r.side}</td>
                      <td className="px-6 py-3 text-sm text-gray-300">{r.category}</td>
                      <td className="px-6 py-3 text-sm text-white">{r.user_email || ''}</td>
                      <td className="px-6 py-3 text-sm text-gray-300">{[r.provider, r.model_key].filter(Boolean).join(' / ')}</td>
                      <td className="px-6 py-3 text-sm text-gray-300">
                        {r.category === 'subscription' && (
                          <span>{r.sub_plan_name || (r.sub_plan_key ? r.sub_plan_key.charAt(0).toUpperCase()+r.sub_plan_key.slice(1) : '')}{r.sub_billing_mode ? ` — ${r.sub_billing_mode}` : ''}</span>
                        )}
                        {r.category === 'one_off' && (
                          <span>{r.one_off_credits ? `${r.one_off_credits} credits` : ''}</span>
                        )}
                      </td>
                      <td className={`px-6 py-3 text-sm text-right ${r.side === 'income' ? 'text-green-400' : 'text-red-400'}`}>${(r.amount_cents / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex justify-center items-center space-x-3">
              <button onClick={() => fetchFinLedger(finPage - 1)} disabled={finPage <= 1} className="px-4 py-2 bg-gray-700 text-white rounded-md disabled:opacity-50">Previous</button>
              <span className="text-white">Page {finPage} / {finTotalPages}</span>
              <button onClick={() => fetchFinLedger(finPage + 1)} disabled={finPage >= finTotalPages} className="px-4 py-2 bg-gray-700 text-white rounded-md disabled:opacity-50">Next</button>
            </div>
          </div>
        )}

        {activeTab === 'costs' && (
          <AdminCostsPage />
        )}

        {activeTab === 'subscriptions' && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                <div>
                  <label className="block text-gray-300 text-sm mb-1">Email</label>
                  <input value={subEmail} onChange={(e) => setSubEmail(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
                </div>
                <div>
                  <label className="block text-gray-300 text-sm mb-1">Event</label>
                  <select value={subEventType} onChange={(e) => setSubEventType(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white">
                    <option value="">All</option>
                    <option value="created">Created</option>
                    <option value="plan_changed">Plan Changed</option>
                    <option value="cancel_scheduled">Cancel Scheduled</option>
                    <option value="canceled">Canceled</option>
                    <option value="renewed">Renewed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-300 text-sm mb-1">Plan key</label>
                  <input value={subPlan} onChange={(e) => setSubPlan(e.target.value)} placeholder="starter / pro / essential / premium" className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
                </div>
                <div>
                  <label className="block text-gray-300 text-sm mb-1">Start</label>
                  <input type="date" value={subStart} onChange={(e) => setSubStart(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
                </div>
                <div>
                  <label className="block text-gray-300 text-sm mb-1">End</label>
                  <input type="date" value={subEnd} onChange={(e) => setSubEnd(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
                </div>
                <div className="flex items-end">
                  <button onClick={() => fetchSubEvents(1)} className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md">Apply</button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-gray-800 rounded-lg overflow-hidden overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Event</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Plan</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Billing</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Amount</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase">Credits Δ</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {subEvents.map((e, idx) => {
                    const isScheduled = ['plan_change_scheduled','cancel_scheduled','resume_scheduled'].includes(e.event_type);
                    const eff = e.effective_at ? new Date(e.effective_at) : null;
                    const pending = isScheduled && eff && eff.getTime() > Date.now();
                    return (
                      <tr key={`${e.id}-${idx}`}>
                        <td className="px-6 py-3 text-sm text-gray-300">{safeDate(e.created_at)}</td>
                        <td className="px-6 py-3 text-sm text-white">{e.user_email || ''}</td>
                        <td className="px-6 py-3 text-sm text-gray-300">{e.event_type}</td>
                        <td className="px-6 py-3 text-sm text-gray-300">{e.plan_display_name || e.new_plan_key || e.prev_plan_key || ''}</td>
                        <td className="px-6 py-3 text-sm text-gray-300">{e.billing_mode || ''}</td>
                        <td className="px-6 py-3 text-sm text-gray-300">{pending ? 'Pending' : ''}</td>
                        <td className="px-6 py-3 text-sm text-right text-gray-300">{e.amount_cents != null ? `$${(e.amount_cents / 100).toFixed(2)}` : ''}</td>
                        <td className={`px-6 py-3 text-sm text-right ${e.credits_delta > 0 ? 'text-green-400' : (e.credits_delta < 0 ? 'text-red-400' : 'text-gray-300')}`}>{e.credits_delta != null ? e.credits_delta : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex justify-center items-center space-x-3">
              <button onClick={() => fetchSubEvents(subPage - 1)} disabled={subPage <= 1} className="px-4 py-2 bg-gray-700 text-white rounded-md disabled:opacity-50">Previous</button>
              <span className="text-white">Page {subPage} / {subTotalPages}</span>
              <button onClick={() => fetchSubEvents(subPage + 1)} disabled={subPage >= subTotalPages} className="px-4 py-2 bg-gray-700 text-white rounded-md disabled:opacity-50">Next</button>
            </div>
          </div>
        )}

        {activeTab === 'monitoring' && <MonitoringTab />}

        {activeTab === 'settings' && (
          <div className="bg-gray-800 p-6 rounded-lg space-y-6">
            <h3 className="text-lg font-semibold text-white">System Settings</h3>

            <div className="flex items-center justify-between bg-gray-700 rounded p-4">
              <div>
                <p className="text-white font-medium">Free signup credits</p>
                <p className="text-gray-300 text-sm">When enabled, new accounts receive free starter credits (currently 10 max lifetime).</p>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={!!(settings?.free_signup_credits_enabled ?? true)}
                  onChange={(e) => updateSetting('free_signup_credits_enabled', e.target.checked)}
                  disabled={settingsLoading}
                />
                <div className="w-11 h-6 bg-gray-500 peer-focus:outline-none rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                  <div className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full transition-transform ${ (settings?.free_signup_credits_enabled ?? true) ? 'translate-x-5' : '' }`}></div>
                </div>
              </label>
            </div>
            {/* Upload mock outputs to B2 (global) */}
            <div className="flex items-center justify-between bg-gray-700 rounded p-4">
              <div>
                <p className="text-white font-medium">Upload mock outputs to B2</p>
                <p className="text-gray-300 text-sm">When mock mode is on, also upload sample images/videos to B2 for parity.</p>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={!!(settings?.upload_mock_outputs_to_b2 ?? false)}
                  onChange={(e) => updateSetting('upload_mock_outputs_to_b2', e.target.checked)}
                  disabled={settingsLoading}
                />
                <div className="w-11 h-6 bg-gray-500 peer-focus:outline-none rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                  <div className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full transition-transform ${ (settings?.upload_mock_outputs_to_b2 ?? false) ? 'translate-x-5' : '' }`}></div>
                </div>
              </label>
            </div>

            {/* Mock API Toggles */}
            <div className="bg-gray-700 rounded p-4">
              <p className="text-white font-medium mb-2">Mock API Toggles</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-white">
                {[
                  { key: 'feature_mock_api', label: 'Global MOCK_API' },
                  { key: 'feature_mock_seedream3', label: 'Mock Seedream 3' },
                  { key: 'feature_mock_seedream4', label: 'Mock Seedream 4' },
                  { key: 'feature_mock_video', label: 'Mock Video (global)' },
                  { key: 'feature_mock_seedance', label: 'Mock Seedance' },
                  { key: 'feature_mock_sora', label: 'Mock Sora' },
                  { key: 'feature_mock_veo31', label: 'Mock Veo 3.1' }
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                    <span className="text-sm">{label}</span>
                    <input
                      type="checkbox"
                      checked={!!(settings?.[key] ?? false)}
                      onChange={(e) => updateSetting(key, e.target.checked)}
                      disabled={settingsLoading}
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-300 mt-2">These map to app_settings keys (feature_*). They are read by the backend featureFlags helper to drive MOCK_MODE without env changes.</p>
            </div>

            {/* Generation Worker */}
            <div className="bg-gray-700 rounded p-4">
              <p className="text-white font-medium mb-2">Generation Worker</p>
              <p className="text-xs text-gray-300 mb-3">Adjust in-process SQS worker concurrency. Leave blank to fall back to the environment (`GEN_WORKER_CONCURRENCY`, default 5).</p>
              <label className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                <span className="text-sm text-white">SQS worker concurrency</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={workerConcurrencyInputValue}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      updateSetting('gen_worker_concurrency', null);
                      return;
                    }
                    if (val === '-' || val === '+') {
                      return;
                    }
                    const numeric = Number(val);
                    if (!Number.isFinite(numeric)) {
                      return;
                    }
                    const normalized = Math.max(1, Math.min(10, Math.floor(numeric)));
                    updateSetting('gen_worker_concurrency', normalized);
                  }}
                  placeholder="Default (env)"
                  disabled={settingsLoading}
                  className="w-40 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 caret-white text-right"
                  style={{ color: '#fff' }}
                />
              </label>
              <p className="text-xs text-gray-400 mt-2">The worker re-polls SQS immediately whenever in-flight jobs are below this limit.</p>
            </div>

            {/* Session Sweeper */}
            <div className="bg-gray-700 rounded p-4">
              <p className="text-white font-medium mb-2">Session Sweeper</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-white">
                <label className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                  <span className="text-sm">Enable Session Sweeper</span>
                  <input
                    type="checkbox"
                    checked={!!(settings?.enable_session_sweeper ?? true)}
                    onChange={(e) => updateSetting('enable_session_sweeper', e.target.checked)}
                    disabled={settingsLoading}
                  />
                </label>

                <label className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                  <span className="text-sm mr-3">Interval (s)</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={Math.floor(Number(settings?.session_sweep_interval_ms ?? 120000) / 1000)}
                    onChange={(e) => updateSetting('session_sweep_interval_ms', Number(e.target.value) * 1000)}
                    disabled={settingsLoading}
                    className="w-40 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-right"
                  />
                </label>
                <p className="text-xs text-gray-300 md:col-span-2">How often the sweeper runs.</p>

                <label className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                  <div>
                    <span className="text-sm mr-3">IMG_MAX (s)</span>
                    <p className="text-xs text-gray-300 mt-1">Max age before image sessions are auto-failed.</p>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={Math.floor(Number(settings?.img_max_ms ?? 30 * 60 * 1000) / 1000)}
                    onChange={(e) => updateSetting('img_max_ms', Number(e.target.value) * 1000)}
                    disabled={settingsLoading}
                    className="w-40 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-right"
                  />
                </label>

                <label className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                  <div>
                    <span className="text-sm mr-3">VIDEO_MAX (s)</span>
                    <p className="text-xs text-gray-300 mt-1">Max age before any video session is auto-failed if still processing.</p>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={Math.floor(Number(settings?.video_max_ms ?? 2 * 60 * 60 * 1000) / 1000)}
                    onChange={(e) => updateSetting('video_max_ms', Number(e.target.value) * 1000)}
                    disabled={settingsLoading}
                    className="w-40 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-right"
                  />
                </label>

                <label className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                  <div>
                    <span className="text-sm mr-3">VIDEO_NOTASK_TTL (s)</span>
                    <p className="text-xs text-gray-300 mt-1">For selected tools, fail early if no task_id appears within this time.</p>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={Math.floor(Number(settings?.video_notask_ttl_ms ?? 30 * 60 * 1000) / 1000)}
                    onChange={(e) => updateSetting('video_notask_ttl_ms', Number(e.target.value) * 1000)}
                    disabled={settingsLoading}
                    className="w-40 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-right"
                  />
                </label>

                {/* Task tools (checkboxes) */}
                <div className="bg-gray-800 rounded px-3 py-2 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm mr-3">Tools requiring task_id (early TTL)</span>
                  </div>
                  <p className="text-xs text-gray-300 mt-1">Apply VIDEO_NOTASK_TTL (s) to these tools. If unchecked, the tool will wait until VIDEO_MAX (s) instead.</p>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
                    {[
                      { key: 'seedance', label: 'Seedance' },
                      { key: 'sora', label: 'Sora 2' },
                      { key: 'veo31', label: 'Veo 3.1' }
                    ].map(({ key, label }) => {
                      const current = String(settings?.session_sweep_task_tools ?? 'seedance')
                        .split(',')
                        .map(s => s.trim().toLowerCase())
                        .filter(Boolean);
                      const checked = current.includes(key);
                      return (
                        <label key={key} className="flex items-center justify-between bg-gray-700 rounded px-3 py-2">
                          <span className="text-sm text-white">{label}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={settingsLoading}
                            onChange={(e) => {
                              const set = new Set(current);
                              if (e.target.checked) set.add(key); else set.delete(key);
                              const csv = Array.from(set).join(',');
                              updateSetting('session_sweep_task_tools', csv);
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-300 mt-2">Overrides are read by the backend sweeper each tick. Leave blank to use defaults/env.</p>
            </div>

            {/* Session Sweeper — Per-tool overrides */}
            <div className="bg-gray-700 rounded p-4">
              <p className="text-white font-medium mb-2">Per-tool overrides</p>
              <p className="text-xs text-gray-300 mb-3">These override the global values above only for the specified tool. Leave empty to inherit global defaults.</p>

              {/* Image tools */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-white">
                <label className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                  <div>
                    <span className="text-sm mr-3">Seedream 3 — IMG_MAX (s)</span>
                    <p className="text-xs text-gray-300 mt-1">Max age before Seedream 3 image sessions auto-fail.</p>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={(settings?.sweeper_img_max_ms_seedream3 === '' || settings?.sweeper_img_max_ms_seedream3 == null) ? '' : Math.floor(Number(settings?.sweeper_img_max_ms_seedream3) / 1000)}
                    onChange={(e) => updateSetting('sweeper_img_max_ms_seedream3', e.target.value === '' ? '' : Number(e.target.value) * 1000)}
                    disabled={settingsLoading}
                    className="w-40 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-right"
                  />
                </label>

                <label className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                  <div>
                    <span className="text-sm mr-3">Seedream 4 — IMG_MAX (s)</span>
                    <p className="text-xs text-gray-300 mt-1">Max age before Seedream 4 image sessions auto-fail.</p>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={(settings?.sweeper_img_max_ms_seedream4 === '' || settings?.sweeper_img_max_ms_seedream4 == null) ? '' : Math.floor(Number(settings?.sweeper_img_max_ms_seedream4) / 1000)}
                    onChange={(e) => updateSetting('sweeper_img_max_ms_seedream4', e.target.value === '' ? '' : Number(e.target.value) * 1000)}
                    disabled={settingsLoading}
                    className="w-40 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-right"
                  />
                </label>
              </div>

              {/* Video tools */}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-white">
                {/* Seedance */}
                <div className="bg-gray-800 rounded px-3 py-2">
                  <p className="text-sm font-medium">Seedance</p>
                  <label className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-gray-300 mr-2">No-task TTL (s)</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={(settings?.sweeper_video_notask_ttl_ms_seedance === '' || settings?.sweeper_video_notask_ttl_ms_seedance == null) ? '' : Math.floor(Number(settings?.sweeper_video_notask_ttl_ms_seedance) / 1000)}
                      onChange={(e) => updateSetting('sweeper_video_notask_ttl_ms_seedance', e.target.value === '' ? '' : Number(e.target.value) * 1000)}
                      disabled={settingsLoading}
                      className="w-32 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-right"
                    />
                  </label>
                  <label className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-gray-300 mr-2">Video Max (s)</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={(settings?.sweeper_video_max_ms_seedance === '' || settings?.sweeper_video_max_ms_seedance == null) ? '' : Math.floor(Number(settings?.sweeper_video_max_ms_seedance) / 1000)}
                      onChange={(e) => updateSetting('sweeper_video_max_ms_seedance', e.target.value === '' ? '' : Number(e.target.value) * 1000)}
                      disabled={settingsLoading}
                      className="w-32 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-right"
                    />
                  </label>
                </div>

                {/* Sora 2 */}
                <div className="bg-gray-800 rounded px-3 py-2">
                  <p className="text-sm font-medium">Sora 2</p>
                  <label className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-gray-300 mr-2">No-task TTL (s)</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={(settings?.sweeper_video_notask_ttl_ms_sora === '' || settings?.sweeper_video_notask_ttl_ms_sora == null) ? '' : Math.floor(Number(settings?.sweeper_video_notask_ttl_ms_sora) / 1000)}
                      onChange={(e) => updateSetting('sweeper_video_notask_ttl_ms_sora', e.target.value === '' ? '' : Number(e.target.value) * 1000)}
                      disabled={settingsLoading}
                      className="w-32 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-right"
                    />
                  </label>
                  <label className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-gray-300 mr-2">Video Max (s)</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={(settings?.sweeper_video_max_ms_sora === '' || settings?.sweeper_video_max_ms_sora == null) ? '' : Math.floor(Number(settings?.sweeper_video_max_ms_sora) / 1000)}
                      onChange={(e) => updateSetting('sweeper_video_max_ms_sora', e.target.value === '' ? '' : Number(e.target.value) * 1000)}
                      disabled={settingsLoading}
                      className="w-32 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-right"
                    />
                  </label>
                </div>

                {/* Veo 3.1 */}
                <div className="bg-gray-800 rounded px-3 py-2">
                  <p className="text-sm font-medium">Veo 3.1</p>
                  <label className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-gray-300 mr-2">No-task TTL (s)</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={(settings?.sweeper_video_notask_ttl_ms_veo31 === '' || settings?.sweeper_video_notask_ttl_ms_veo31 == null) ? '' : Math.floor(Number(settings?.sweeper_video_notask_ttl_ms_veo31) / 1000)}
                      onChange={(e) => updateSetting('sweeper_video_notask_ttl_ms_veo31', e.target.value === '' ? '' : Number(e.target.value) * 1000)}
                      disabled={settingsLoading}
                      className="w-32 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-right"
                    />
                  </label>
                  <label className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-gray-300 mr-2">Video Max (s)</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={(settings?.sweeper_video_max_ms_veo31 === '' || settings?.sweeper_video_max_ms_veo31 == null) ? '' : Math.floor(Number(settings?.sweeper_video_max_ms_veo31) / 1000)}
                      onChange={(e) => updateSetting('sweeper_video_max_ms_veo31', e.target.value === '' ? '' : Number(e.target.value) * 1000)}
                      disabled={settingsLoading}
                      className="w-32 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-right"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Danger zone */}
            <div className="bg-gray-700 rounded p-4 border border-red-500">
              <p className="text-white font-semibold mb-2">Danger zone</p>
              <div className="flex flex-col md:flex-row md:items-center md:space-x-3 space-y-3 md:space-y-0">
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={deleteEmail}
                  onChange={(e) => setDeleteEmail(e.target.value)}
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                />
                <button
                  onClick={deleteAccount}
                  disabled={deleteLoading || !deleteEmail}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded"
                >
                  {deleteLoading ? 'Deleting…' : 'Delete account'}
                </button>
              </div>
              <p className="text-red-300 text-xs mt-2">This permanently deletes the user and most related data. Finance ledger entries are retained but anonymized.</p>
            </div>
          </div>
        )}
      </main>

      {/* User Details Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 p-6 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">User Details</h3>
              <button
                onClick={() => setSelectedUser(null)}
                className="text-gray-400 hover:text-white"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Email</label>
                <p className="text-white">{selectedUser.email}</p>
              </div>
              
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Credits</label>
                <p className="text-white">{selectedUser.credits.toLocaleString()}</p>
              </div>

              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Current Plan</label>
                <p className="text-white">
                  {selectedUser.subscription_status ? `${selectedUser.subscription_plan_name || selectedUser.plan_id || ''} ${selectedUser.subscription_billing_mode ? `— ${selectedUser.subscription_billing_mode}` : ''}` : 'None'}
                </p>
              </div>
              
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Role</label>
                <p className="text-white">{selectedUser.role}</p>
              </div>
              
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Adjust Credits</label>
                <div className="mb-3 p-3 bg-gray-700 rounded-md">
                  <p className="text-gray-300 text-sm mb-2">
                    <strong>Instructions:</strong>
                  </p>
                  <ul className="text-gray-400 text-sm space-y-1">
                    <li>• <strong>Add credits:</strong> Enter positive number (e.g., 100)</li>
                    <li>• <strong>Remove credits:</strong> Enter negative number (e.g., -50)</li>
                    <li>• <strong>Reason:</strong> Provide clear reason for audit trail</li>
                    <li>• <strong>Examples:</strong> "Refund for failed generation", "Bonus credits", "Account suspension"</li>
                  </ul>
                </div>
                <div className="flex space-x-2">
                  <input
                    type="number"
                    id="creditAmount"
                    placeholder="Amount (+/-)"
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    id="creditReason"
                    placeholder="Reason for adjustment"
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => {
                      const amount = document.getElementById('creditAmount').value;
                      const reason = document.getElementById('creditReason').value;
                      if (amount && reason) {
                        adjustUserCredits(selectedUser.id, parseInt(amount), reason);
                        document.getElementById('creditAmount').value = '';
                        document.getElementById('creditReason').value = '';
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md"
                  >
                    Adjust
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
