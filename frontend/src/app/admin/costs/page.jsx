'use client';

import { useEffect, useState } from 'react';
import phFetch from '../../services/phFetch';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:5000';

export default function AdminCostsPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [group, setGroup] = useState('none');
  const [topUsers, setTopUsers] = useState([]);
  const [topSessions, setTopSessions] = useState([]);

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem('adminToken');
      if (!token) { setLoading(false); return; }
      // ping a protected endpoint to validate
      const r = await phFetch(`${API_BASE}/api/admin/dashboard`, { headers: { 'Authorization': `Bearer ${token}` } });
      setIsAuthenticated(r.ok);
      setLoading(false);
      if (r.ok) {
        await refreshAll();
      }
    })();
  }, []);

  const params = () => new URLSearchParams({
    ...(from && { startDate: from }),
    ...(to && { endDate: to })
  });

  const refreshAll = async () => {
    const token = localStorage.getItem('adminToken');
    const p = params();
    const [s, d, u, ses] = await Promise.all([
      phFetch(`${API_BASE}/api/admin/costs/summary?${p}`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()).catch(()=>({})),
      phFetch(`${API_BASE}/api/admin/costs/daily?${new URLSearchParams({ ...Object.fromEntries(p), group })}`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()).catch(()=>({})),
      phFetch(`${API_BASE}/api/admin/costs/top-users?${p}`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()).catch(()=>({})),
      phFetch(`${API_BASE}/api/admin/costs/top-sessions?${p}`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()).catch(()=>({}))
    ]);
    setSummary(s || null);
    setDaily(d?.daily || []);
    setTopUsers(u?.users || []);
    setTopSessions(ses?.sessions || []);
  };

  if (loading) return <div className="p-6 text-white">Loading…</div>;
  if (!isAuthenticated) return <div className="p-6 text-white">Not authorized</div>;

  const fmt = (n) => typeof n === 'number' ? `$${n.toFixed(4)}` : '$0.0000';

  return (
    <div className="p-6 space-y-6">
      {/* Filters */}
      <div className="bg-gray-800 p-4 rounded-lg grid grid-cols-1 md:grid-cols-6 gap-4">
        <div>
          <label className="block text-gray-300 text-sm mb-1">From</label>
          <input type="date" value={from} onChange={(e)=>setFrom(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
        </div>
        <div>
          <label className="block text-gray-300 text-sm mb-1">To</label>
          <input type="date" value={to} onChange={(e)=>setTo(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
        </div>
        <div>
          <label className="block text-gray-300 text-sm mb-1">Group by</label>
          <select value={group} onChange={(e)=>setGroup(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white">
            <option value="none">None</option>
            <option value="product">Product</option>
            <option value="model">Model</option>
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={refreshAll} className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md">Apply</button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-800 p-6 rounded-lg">
          <p className="text-gray-400 text-sm">Total cost</p>
          <p className="text-2xl text-white font-semibold">{fmt(Number(summary?.total?.usd || 0))}</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg">
          <p className="text-gray-400 text-sm">Total sessions</p>
          <p className="text-2xl text-white font-semibold">{Number(summary?.total?.sessions || 0).toLocaleString()}</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg">
          <p className="text-gray-400 text-sm">Avg per session</p>
          <p className="text-2xl text-white font-semibold">{fmt((Number(summary?.total?.usd||0))/(Number(summary?.total?.sessions||0)||1))}</p>
        </div>
      </div>

      {/* Breakdown by product */}
      <div className="bg-gray-800 p-6 rounded-lg overflow-x-auto">
        <h3 className="text-white font-semibold mb-4">By product</h3>
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Product</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-300 uppercase">USD</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-300 uppercase">Sessions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {(summary?.byProduct||[]).map((r,idx)=> (
              <tr key={idx}>
                <td className="px-4 py-2 text-white">{r.product}</td>
                <td className="px-4 py-2 text-right text-white">{fmt(Number(r.usd||0))}</td>
                <td className="px-4 py-2 text-right text-white">{Number(r.sessions||0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Daily series */}
      <div className="bg-gray-800 p-6 rounded-lg overflow-x-auto">
        <h3 className="text-white font-semibold mb-4">Daily</h3>
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Day (UTC)</th>
              {group==='product' && (<th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Product</th>)}
              {group==='model' && (<th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Model</th>)}
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-300 uppercase">USD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {daily.map((r,idx)=> (
              <tr key={idx}>
                <td className="px-4 py-2 text-white">{r.day_utc}</td>
                {group==='product' && (<td className="px-4 py-2 text-white">{r.product}</td>)}
                {group==='model' && (<td className="px-4 py-2 text-white">{r.model_key}</td>)}
                <td className="px-4 py-2 text-right text-white">{fmt(Number(r.usd||0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top users */}
      <div className="bg-gray-800 p-6 rounded-lg overflow-x-auto">
        <h3 className="text-white font-semibold mb-4">Top users (by cost)</h3>
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">User ID</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-300 uppercase">USD</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-300 uppercase">Sessions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {topUsers.map((u)=> (
              <tr key={u.user_id}>
                <td className="px-4 py-2 text-white">{u.user_id}</td>
                <td className="px-4 py-2 text-right text-white">{fmt(Number(u.usd||0))}</td>
                <td className="px-4 py-2 text-right text-white">{Number(u.sessions||0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top sessions */}
      <div className="bg-gray-800 p-6 rounded-lg overflow-x-auto">
        <h3 className="text-white font-semibold mb-4">Top sessions (by cost)</h3>
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Session</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Product</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase">Model</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-300 uppercase">USD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {topSessions.map((s)=> (
              <tr key={s.session_id}>
                <td className="px-4 py-2 text-white">{s.session_id}</td>
                <td className="px-4 py-2 text-white">{s.product}</td>
                <td className="px-4 py-2 text-white">{s.model_key}</td>
                <td className="px-4 py-2 text-right text-white">{fmt(Number(s.session_usd||0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


