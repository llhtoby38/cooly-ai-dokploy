"use client";

import React, { useEffect, useMemo, useState } from "react";
import phFetch from "../../services/phFetch";
import AppShell from "../../components/AppShell";
import { useApiBase } from "../../hooks/useApiBase";
import { useAuth } from "../../contexts/AuthContext";

export default function ChangePlanPage() {
  const { user } = useAuth();
  const API_BASE = useApiBase();
  const [billingMode, setBillingMode] = useState("monthly");
  const [plans, setPlans] = useState([]);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const currentPlanId = me?.subscription?.plan_id || null;
  const currentPeriodEnd = me?.subscription?.current_period_end || null;
  const currentBillingMode = me?.subscription?.billing_mode || null;

  useEffect(() => {
    const fetchMe = async () => {
      try {
        // Load base user
        const res = await phFetch(`${API_BASE}/api/user/me`);
        if (!res.ok) return;
        const j = await res.json();
        // Load subscription with billing mode
        const sres = await phFetch(`${API_BASE}/api/billing/me-subscription`);
        let subscription = j.subscription || null;
        if (sres.ok) {
          const sj = await sres.json();
          if (sj.subscription) subscription = sj.subscription;
        }
        setMe({ ...j, subscription });
      } catch {}
    };
    fetchMe();
  }, [API_BASE]);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const res = await phFetch(`${API_BASE}/api/billing/public/plans?billingMode=${billingMode}`);
        const data = await res.json();
        if (res.ok) setPlans(data.plans || []);
      } catch {}
    };
    fetchPlans();
  }, [API_BASE, billingMode]);

  const rankById = useMemo(() => {
    const m = new Map();
    plans.forEach((p, idx) => m.set(p.id, idx));
    return m;
  }, [plans]);

  const currentRank = currentPlanId != null && rankById.has(currentPlanId)
    ? rankById.get(currentPlanId)
    : -1;

  const handleChangePlan = async (planId) => {
    setLoading(true); setError(""); setMessage("");
    try {
      const r = await phFetch(`${API_BASE}/api/billing/change-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, billingMode })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to change plan');
      setMessage('Plan change submitted. Stripe will prorate automatically.');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (typeof window !== 'undefined') {
    window.location.replace('/billing');
  }
  return null;
}


