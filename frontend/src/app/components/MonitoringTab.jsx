'use client';

import { useState, useEffect } from 'react';
import phFetch from "../services/phFetch";
import { FaHeartbeat, FaExclamationTriangle, FaCheckCircle, FaTimesCircle, FaSync } from 'react-icons/fa';
import { toErrorText } from "../utils/toErrorText";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:5000';

function MonitoringTab() {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collectorStatus, setCollectorStatus] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    fetchMetrics();
    fetchCollectorStatus();
    fetchSettings();
    fetchModelOptions();
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchMetrics();
      }, 10000); // Refresh every 10 seconds
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh]);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('adminToken');
      const response = await phFetch(`${API_BASE}/api/admin/health-metrics`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setMetrics(data.metrics);
        setLastUpdated(new Date());
      } else {
        setError('Failed to fetch metrics');
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const fetchCollectorStatus = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await phFetch(`${API_BASE}/api/admin/health-metrics/status`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setCollectorStatus(data.status);
      }
    } catch (error) {
      console.error('Failed to fetch collector status:', error);
    }
  };

  const startCollector = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await phFetch(`${API_BASE}/api/admin/health-metrics/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        await fetchCollectorStatus();
        await fetchMetrics();
      }
    } catch (error) {
      console.error('Failed to start collector:', error);
    }
  };

  const stopCollector = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await phFetch(`${API_BASE}/api/admin/health-metrics/stop`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        await fetchCollectorStatus();
      }
    } catch (error) {
      console.error('Failed to stop collector:', error);
    }
  };

  const triggerCollection = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await phFetch(`${API_BASE}/api/admin/health-metrics/collect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        await fetchMetrics();
      }
    } catch (error) {
      console.error('Failed to trigger collection:', error);
    }
  };

  // Admin settings state (for load-test toggles)
  const [settings, setSettings] = useState({});
  const [settingsLoading, setSettingsLoading] = useState(false);

  const fetchSettings = async () => {
    try {
      setSettingsLoading(true);
      const token = localStorage.getItem('adminToken');
      const res = await phFetch(`${API_BASE}/api/admin/settings`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || {});
      }
    } catch (e) {
      // ignore
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
      // ignore
    }
  };

  // Model options (for dropdown)
  const [modelOptions, setModelOptions] = useState([]);
  const fetchModelOptions = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const res = await phFetch(`${API_BASE}/api/admin/pricing/models`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const rows = Array.isArray(data.models) ? data.models : [];
        setModelOptions(rows);
      }
    } catch (_) {}
  };

  // Load test controls
  const [ltRunning, setLtRunning] = useState(false);
  const [ltStatus, setLtStatus] = useState(null);
  const [ltForm, setLtForm] = useState({ totalRequests: 50, concurrent: 5, outputs: 1, model: 'seedream-3-0-t2i-250415', prompt: 'A scenic landscape at sunset', toggles: { MOCK_API: true, MOCK_SEEDREAM3: false, MOCK_SEEDREAM4: false, MOCK_VIDEO: false, MOCK_SEEDANCE: false, MOCK_SORA: false, MOCK_VEO31: false }, userEmailsText: '', useSpecificUsers: true, uiParity: true });

  const startLoadTest = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const userEmails = ltForm.useSpecificUsers
        ? ltForm.userEmailsText.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean)
        : [];
      const res = await phFetch(`${API_BASE}/api/admin/load-test/start`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totalRequests: ltForm.totalRequests,
          concurrent: ltForm.concurrent,
          model: ltForm.model,
          outputs: ltForm.outputs,
          prompt: ltForm.prompt,
          toggles: ltForm.toggles,
          uiParity: !!ltForm.uiParity,
          userEmails
        })
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) { alert(data.error || 'Failed to start'); return; }
      setLtRunning(true);
      pollLoadTest();
    } catch (e) {
      alert('Failed to start load test');
    }
  };

  const stopLoadTest = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      await phFetch(`${API_BASE}/api/admin/load-test/stop`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
      setLtRunning(false);
    } catch {}
  };

  const pollLoadTest = async () => {
    const token = localStorage.getItem('adminToken');
    const res = await phFetch(`${API_BASE}/api/admin/load-test/status`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json().catch(()=>({}));
    setLtStatus(data);
    if (data?.running) setTimeout(pollLoadTest, 1000);
    else setLtRunning(false);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return <FaCheckCircle className="text-green-400" />;
      case 'warning':
        return <FaExclamationTriangle className="text-yellow-400" />;
      case 'critical':
        return <FaTimesCircle className="text-red-400" />;
      default:
        return <FaHeartbeat className="text-gray-400" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-900/20 border-green-500/30';
      case 'warning':
        return 'bg-yellow-900/20 border-yellow-500/30';
      case 'critical':
        return 'bg-red-900/20 border-red-500/30';
      default:
        return 'bg-gray-900/20 border-gray-500/30';
    }
  };

  const formatMetricName = (name) => {
    return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-white">Loading metrics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 space-y-4">
        <div className="text-red-400">{toErrorText(error)}</div>
        <button
          onClick={fetchMetrics}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">System Health Monitoring</h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-md"
          >
            <FaSync className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Load Test Panel */}
      <div className="bg-gray-800 p-6 rounded-lg space-y-4">
        <h3 className="text-lg font-semibold text-white">Load Test (Admin)</h3>
        <div className="flex items-center space-x-2">
          <button onClick={fetchSettings} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm">Refresh Settings</button>
          {settingsLoading && <span className="text-gray-400 text-sm">Loading…</span>}
        </div>
        <div className="flex items-center justify-between bg-gray-700 rounded p-3">
          <div>
            <p className="text-white font-medium text-sm">Enable Admin Load Test</p>
            <p className="text-gray-300 text-xs">Allows starting load tests from this panel.</p>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={!!(settings?.enable_admin_load_test ?? false)}
              onChange={(e) => updateSetting('enable_admin_load_test', e.target.checked)}
              disabled={settingsLoading}
            />
            <div className="w-11 h-6 bg-gray-500 peer-focus:outline-none rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
              <div className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full transition-transform ${ (settings?.enable_admin_load_test ?? false) ? 'translate-x-5' : '' }`}></div>
            </div>
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-gray-300 text-sm mb-1">Total Requests</label>
            <input type="number" min="1" value={ltForm.totalRequests} onChange={(e)=>setLtForm({...ltForm, totalRequests: Number(e.target.value)})} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
          </div>
          <div>
            <label className="block text-gray-300 text-sm mb-1">Concurrent</label>
            <input type="number" min="1" value={ltForm.concurrent} onChange={(e)=>setLtForm({...ltForm, concurrent: Number(e.target.value)})} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
          </div>
          <div>
            <label className="block text-gray-300 text-sm mb-1">Outputs</label>
            <input type="number" min="1" max="4" value={ltForm.outputs} onChange={(e)=>setLtForm({...ltForm, outputs: Number(e.target.value)})} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-gray-300 text-sm mb-1">Model</label>
            <select value={ltForm.model} onChange={(e)=>setLtForm({...ltForm, model: e.target.value})} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white">
              {modelOptions.length === 0 ? (
                <option value="">Loading models…</option>
              ) : (
                modelOptions.map(m => (
                  <option key={m.id} value={m.model_key || ''}>{m.display_name || m.model_key}</option>
                ))
              )}
            </select>
          </div>
          <div className="md:col-span-5">
            <label className="block text-gray-300 text-sm mb-1">Prompt</label>
            <input type="text" value={ltForm.prompt} onChange={(e)=>setLtForm({...ltForm, prompt: e.target.value})} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" />
          </div>
          <div className="md:col-span-5">
            <div className="flex items-center justify-between">
              <label className="block text-gray-300 text-sm mb-1">Use only these users (emails, comma/space/newline separated)</label>
              <span className="text-xs px-2 py-1 rounded bg-blue-900/40 text-blue-300">Required</span>
            </div>
            <textarea value={ltForm.userEmailsText} onChange={(e)=>setLtForm({...ltForm, userEmailsText: e.target.value})} rows={3} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white" placeholder="test1@example.com, test2@example.com" />
          </div>
          <div className="md:col-span-5">
            <label className="block text-gray-300 text-sm mb-1">Mock API Overrides (this load test only)</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-white">
              {[
                { key: 'MOCK_API', label: 'Global MOCK_API' },
                { key: 'MOCK_SEEDREAM3', label: 'Mock Seedream 3' },
                { key: 'MOCK_SEEDREAM4', label: 'Mock Seedream 4' },
                { key: 'MOCK_VIDEO', label: 'Mock Video (global)' },
                { key: 'MOCK_SEEDANCE', label: 'Mock Seedance' },
                { key: 'MOCK_SORA', label: 'Mock Sora' },
                { key: 'MOCK_VEO31', label: 'Mock Veo 3.1' }
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                  <span className="text-sm">{label}</span>
                  <input
                    type="checkbox"
                    checked={!!ltForm.toggles[key]}
                    onChange={(e) => setLtForm({ ...ltForm, toggles: { ...ltForm.toggles, [key]: e.target.checked } })}
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">These overrides apply only to requests from this load test; global settings remain unchanged.</p>
            <label className="inline-flex items-center space-x-2 text-sm mt-2">
              <input type="checkbox" checked={ltForm.uiParity} onChange={(e)=>setLtForm({...ltForm, uiParity: e.target.checked})} />
              <span className="text-gray-300">UI parity (send exact UI payload; ignore overrides)</span>
            </label>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={startLoadTest} disabled={ltRunning} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-md">Start</button>
          <button onClick={stopLoadTest} disabled={!ltRunning} className="bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white px-4 py-2 rounded-md">Stop</button>
          <button onClick={pollLoadTest} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-md">Refresh Status</button>
        </div>
        {ltStatus && (
          <div className="text-gray-300 text-sm space-y-1">
            <div>Running: {ltStatus.running ? 'Yes' : 'No'}</div>
            <div>OK: {ltStatus.ok || 0} / Fail: {ltStatus.fail || 0} / Total: {ltStatus.total || 0}</div>
            {ltStatus.errors && (
              <div>
                Errors: {Object.entries(ltStatus.errors).map(([k,v])=>`${k}:${v}`).join(', ')}
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-yellow-300">Note: Requires ENABLE_ADMIN_LOAD_TEST=true on the backend. Uses real generation endpoint; costs/credits may apply unless MOCK_API is enabled.</p>
      </div>

      {/* Collector Controls */}
      <div className="bg-gray-800 p-4 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h3 className="text-lg font-semibold text-white">Metrics Collector</h3>
            <div className="flex items-center space-x-2">
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                collectorStatus?.isRunning ? 'bg-green-900/50 text-green-300' : 'bg-gray-900/50 text-gray-300'
              }`}>
                {collectorStatus?.isRunning ? 'Running' : 'Stopped'}
              </span>
              {collectorStatus?.isRunning && (
                <span className="text-xs text-gray-400">
                  Updates every {collectorStatus.updateInterval / 3600000}h
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={startCollector}
              disabled={collectorStatus?.isRunning}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1 rounded text-sm"
            >
              Start
            </button>
            <button
              onClick={stopCollector}
              disabled={!collectorStatus?.isRunning}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1 rounded text-sm"
            >
              Stop
            </button>
            <button
              onClick={triggerCollection}
              className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded text-sm"
            >
              Collect Now
            </button>
            <label className="flex items-center space-x-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              <span>Auto-refresh</span>
            </label>
          </div>
        </div>
        {lastUpdated && (
          <div className="text-xs text-gray-400 mt-2">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {metrics.map((metric) => (
          <div
            key={metric.id}
            className={`p-6 rounded-lg border ${getStatusColor(metric.status)}`}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                {formatMetricName(metric.metric_name)}
              </h3>
              {getStatusIcon(metric.status)}
            </div>
            
            <div className="space-y-2">
              <div className="flex items-baseline space-x-2">
                <span className="text-3xl font-bold text-white">
                  {metric.metric_value}
                </span>
                {metric.metric_unit && (
                  <span className="text-gray-400 text-sm">
                    {metric.metric_unit}
                  </span>
                )}
              </div>
              
              <div className="flex items-center space-x-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  metric.status === 'healthy' ? 'bg-green-900/50 text-green-300' :
                  metric.status === 'warning' ? 'bg-yellow-900/50 text-yellow-300' :
                  'bg-red-900/50 text-red-300'
                }`}>
                  {metric.status}
                </span>
              </div>
              
              {metric.metadata && (
                <div className="text-xs text-gray-400 mt-2 space-y-1">
                  {Object.entries(metric.metadata).map(([key, value]) => (
                    <div key={key}>
                      <span className="capitalize">{key.replace(/_/g, ' ')}:</span> {String(value)}
                    </div>
                  ))}
                </div>
              )}
              
              <div className="text-xs text-gray-500">
                {new Date(metric.recorded_at).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Summary Stats */}
      <div className="bg-gray-800 p-6 rounded-lg">
        <h3 className="text-lg font-semibold text-white mb-4">System Status Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-400">
              {metrics.filter(m => m.status === 'healthy').length}
            </div>
            <div className="text-gray-400">Healthy</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-400">
              {metrics.filter(m => m.status === 'warning').length}
            </div>
            <div className="text-gray-400">Warning</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-400">
              {metrics.filter(m => m.status === 'critical').length}
            </div>
            <div className="text-gray-400">Critical</div>
          </div>
        </div>
      </div>

      {/* No metrics message */}
      {metrics.length === 0 && (
        <div className="text-center py-8">
          <div className="text-gray-400">No metrics available</div>
          <div className="text-sm text-gray-500 mt-2">
            Create the system_health_metrics table in your database to see monitoring data
          </div>
        </div>
      )}
    </div>
  );
}

export default MonitoringTab;
