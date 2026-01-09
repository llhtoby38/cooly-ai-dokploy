"use client";

import React, { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "../components/AppShell";
import { toErrorText } from "../utils/toErrorText";
import { useApiBase } from "../hooks/useApiBase";
import { useAuth } from "../contexts/AuthContext";
import { FaCheck, FaCrown, FaCoins } from "react-icons/fa";
import phFetch from "../services/phFetch";

function BillingContent() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const { user } = useAuth();
  const API_BASE = useApiBase();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [billingMode, setBillingMode] = useState("monthly"); // "monthly" or "yearly"

  // Plans and packages from API
  const [plans, setPlans] = useState([]);
  const [plansMonthlyRaw, setPlansMonthlyRaw] = useState([]); // [{id, name, price_cents, credits_per_period}]
  const [plansYearlyRaw, setPlansYearlyRaw] = useState([]);
  const [packages, setPackages] = useState([]);
  const [subscription, setSubscription] = useState(null); // { plan_id, billing_mode, status, current_period_end }

  useEffect(() => {
    const fetchPlansBoth = async () => {
      try {
        const [mRes, yRes] = await Promise.all([
          phFetch(`${API_BASE}/api/billing/public/plans?billingMode=monthly`),
          phFetch(`${API_BASE}/api/billing/public/plans?billingMode=yearly`)
        ]);
        if (mRes.ok) {
          const m = (await mRes.json()).plans || [];
          setPlansMonthlyRaw(m);
        }
        if (yRes.ok) {
          const y = (await yRes.json()).plans || [];
          setPlansYearlyRaw(y);
        }
      } catch {}
    };
    const fetchPackages = async () => {
      try {
        const res = await phFetch(`${API_BASE}/api/billing/public/packages`);
        const data = await res.json();
        if (res.ok) {
          setPackages(data.packages.map((x) => ({ credits: x.credits, price: x.price_cents / 100 })));
        }
      } catch {}
    };
    fetchPlansBoth();
    fetchPackages();
  }, [API_BASE]);

  // Map raw plans into current toggle view
  useEffect(() => {
    const source = billingMode === 'monthly' ? plansMonthlyRaw : plansYearlyRaw;
    const mapped = (source || []).map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price_cents / 100,
      credits: p.credits_per_period,
      billing_mode: billingMode,
      popular: billingMode === 'monthly' && p.id === 'essential',
      limitedPromo: billingMode === 'monthly' && p.id === 'hobby'
    }));
    setPlans(mapped);
  }, [billingMode, plansMonthlyRaw, plansYearlyRaw]);

  // Load current user's subscription (if any)
  useEffect(() => {
    const fetchSub = async () => {
      try {
        const res = await phFetch(`${API_BASE}/api/billing/me-subscription?ts=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          setSubscription(j.subscription || null);
        }
      } catch {}
    };
    fetchSub();
  }, [API_BASE]);

  // Set billing mode based on user's current subscription
  useEffect(() => {
    if (subscription?.billing_mode) {
      setBillingMode(subscription.billing_mode);
    }
  }, [subscription]);

  const currentPlans = plans;
  const isSubscribed = !!subscription;
  const currentPlanId = subscription?.plan_id || null;
  const currentBillingMode = subscription?.billing_mode || null;
  const activePlanCount = currentPlans.length;
  const isFivePlans = activePlanCount === 5;
  // Brick pattern for 5 plans: use 6 equal columns and make each card span 2 columns
  const mdColsClass = isFivePlans ? 'md:grid-cols-6' : 'md:grid-cols-2';
  const lgColsClass = isFivePlans ? 'lg:grid-cols-6' : 'lg:grid-cols-2';
  
  // Calculate discount that monthly subscriptions provide vs one-off purchases
  const calculateSubscriptionDiscount = () => {
    // Compare Starter plan (4500 credits for $9/month) vs one-off (4000 credits for $9)
    // Monthly: $9 for 4500 credits = $0.002 per credit
    // One-off: $9 for 4000 credits = $0.00225 per credit
    // Discount: (0.00225 - 0.002) / 0.00225 = 11.1%
    return "11%";
  };

  const handleSubscribe = async (planId) => {
    setLoading(true);
    setError("");

    try {
      const response = await phFetch(`${API_BASE}/api/billing/create-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planId,
          billingMode
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create subscription');
      }

      // Redirect to Stripe checkout
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePlan = async (planId) => {
    setLoading(true);
    setError("");
    try {
      const r = await phFetch(`${API_BASE}/api/billing/change-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, billingMode })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to change plan');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpgradeViaPortal = async (planId) => {
    setLoading(true);
    setError("");
    try {
      const r = await phFetch(`${API_BASE}/api/billing/upgrade-via-portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, billingMode })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to open Stripe');
      window.location.href = d.url;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Tooltip removed per request

  return (
    <AppShell
      selectedTool="billing"
      showMobilePrompt={false}
      showLeftSidebar={false}
      childrenMain={
        <div className="max-w-7xl mx-auto pt-10 px-4">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-white mb-4">
              {isSubscribed ? 'Change Plan' : 'Choose Your Plan'}
            </h1>
            <p className="text-xl text-gray-400 mb-8">
              {isSubscribed
                ? 'Scale up your creativity. Switch plans anytime.'
                : "Get credits monthly with our subscription plans or buy credits as needed"}
            </p>

            {isSubscribed && currentPlanId && (
              <div className="mb-6 inline-block bg-gray-800 border border-gray-700 text-gray-200 rounded px-4 py-2">
                Current: <span className="font-semibold text-white">{currentPlanId.charAt(0).toUpperCase() + currentPlanId.slice(1)}</span>
                {currentBillingMode && (
                  <span className="text-gray-400 ml-2">— {currentBillingMode === 'yearly' ? 'Yearly' : 'Monthly'}</span>
                )}
              </div>
            )}

            {/* Pending change and next invoice */}
            {isSubscribed && subscription?.pending_change && (
              <div className="mb-2 text-yellow-300">
                {(() => {
                  const pc = subscription.pending_change;
                  const name = pc.plan_display_name || (pc.new_plan_key ? pc.new_plan_key.charAt(0).toUpperCase() + pc.new_plan_key.slice(1) : '');
                  const mode = pc.billing_mode ? (pc.billing_mode === 'yearly' ? 'Yearly' : 'Monthly') : '';
                  const when = pc.effective_at ? new Date(pc.effective_at).toLocaleDateString() : '';
                  if (pc.event_type === 'cancel_scheduled') {
                    return <>Pending: will cancel at period end on <span className="font-medium text-yellow-200">{when}</span></>;
                  }
                  if (pc.event_type === 'resume_scheduled') {
                    return <>Pending: resume scheduled on <span className="font-medium text-yellow-200">{when}</span></>;
                  }
                  return <>Pending: will change to <span className="font-medium text-yellow-200">{name}</span>{mode ? <> — {mode}</> : null} on <span className="font-medium text-yellow-200">{when}</span></>;
                })()}
              </div>
            )}
            {isSubscribed && subscription?.next_invoice && (
              <div className="mb-6 text-gray-300">
                {(() => {
                  const ni = subscription.next_invoice;
                  const dollars = (Number(ni.amount_cents || 0) / 100).toFixed(2);
                  const when = ni.due_at ? new Date(ni.due_at).toLocaleString() : '—';
                  return <>Next charge: <span className="text-white font-semibold">${dollars}</span> on {when}</>;
                })()}
              </div>
            )}

            {/* Billing Toggle */}
            <div className="flex items-center justify-center gap-4 mb-8">
              <div className="flex bg-gray-700 rounded-lg p-1">
                <button
                  onClick={() => setBillingMode("yearly")}
                  className={`px-6 py-2 rounded-md font-semibold transition-all ${
                    billingMode === "yearly"
                      ? "bg-gray-600 text-white"
                      : "text-gray-300 hover:text-white"
                  }`}
                >
                  Yearly
                  <span className="ml-2 bg-green-600 text-white text-xs px-2 py-1 rounded">
                    -20%
                  </span>
                </button>
                <button
                  onClick={() => setBillingMode("monthly")}
                  className={`px-6 py-2 rounded-md font-semibold transition-all ${
                    billingMode === "monthly"
                      ? "bg-gray-600 text-white"
                      : "text-gray-300 hover:text-white"
                  }`}
                >
                  Monthly
                  <span className="ml-2 bg-green-600 text-white text-xs px-2 py-1 rounded">
                    -{calculateSubscriptionDiscount()}
                  </span>
                </button>
              </div>
            </div>
        </div>

        {/* Subscription renewal note removed per request */}

          {error && (
            <div className="mb-6 p-4 bg-red-900 bg-opacity-20 border border-red-500 text-red-400 rounded-lg text-center">
              {toErrorText(error)}
            </div>
          )}

          {/* Subscription Plans */}
          <div className={`grid grid-cols-1 ${mdColsClass} ${lgColsClass} gap-6 mb-4`}>
          {currentPlans.map((plan, idx) => {
              const isCurrent = isSubscribed && plan.id === currentPlanId && billingMode === (currentBillingMode || billingMode);
              const buttonText = isSubscribed ? (isCurrent ? 'Current Plan' : 'Change') : 'Subscribe';
              const onClick = () => {
                if (!isSubscribed) return handleSubscribe(plan.id);
                if (isCurrent) return;
                // Always route plan changes via Stripe Billing Portal (both upgrades and downgrades)
                return handleUpgradeViaPortal(plan.id);
              };
            // For 5 plans, span 2 columns per card. Offset the 4th and 5th to columns 2 and 4 respectively for brick pattern.
            const spanClass = isFivePlans ? 'md:col-span-2 lg:col-span-2' : '';
            const offsetClass = isFivePlans
              ? (idx === 3 ? 'md:col-start-2 lg:col-start-2' : (idx === 4 ? 'md:col-start-4 lg:col-start-4' : ''))
              : '';
            const isHobbyPromo = !!plan.limitedPromo;
            const variantClass = isHobbyPromo
              ? 'border-yellow-500 bg-yellow-900 bg-opacity-10'
              : (isCurrent
                  ? 'border-green-500 bg-green-900 bg-opacity-10'
                  : (plan.popular
                      ? 'border-blue-500 bg-blue-900 bg-opacity-10'
                      : 'border-gray-600 hover:border-gray-500'));
            const buttonColorClass = isHobbyPromo
              ? 'bg-yellow-500 hover:bg-yellow-600 text-black'
              : 'bg-blue-600 hover:bg-blue-700 text-white';
            return (
              <div
                key={plan.id}
                className={`relative bg-gray-800 rounded-lg border-2 p-6 transition-all hover:shadow-lg flex flex-col ${spanClass} ${offsetClass} ${variantClass}`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 z-10">
                    <span className="bg-blue-500 text-white text-xs sm:text-sm px-3 sm:px-4 py-1 rounded-full font-semibold whitespace-nowrap">
                      Most Popular
                    </span>
                  </div>
                )}
                {isHobbyPromo && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 z-10">
                    <span className="bg-yellow-500 text-black text-xs sm:text-sm px-3 sm:px-4 py-1 rounded-full font-semibold whitespace-nowrap">
                      Limited Time Offer
                    </span>
                  </div>
                )}

                <div className="text-center mb-6 flex-grow">
                  <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
                  <div className="mb-2">
                    <span className="text-4xl font-bold text-white">
                      ${plan.price}
                    </span>
                    <span className="text-gray-400 ml-2">
                      /{billingMode === "monthly" ? "month" : "year"}
                    </span>
                  </div>
                  {billingMode === "yearly" && (
                    <div className="text-sm text-green-400 mb-2">
                      {(() => {
                        const monthly = plans.find(p => p.id === plan.id && p.billing_mode === 'monthly');
                        const perMonth = (plan.price / 12).toFixed(2);
                        return `~$${perMonth}/month`;
                      })()}
                    </div>
                  )}
                  <div className="text-gray-400 text-lg">
                    <span className="font-bold text-white">{plan.credits.toLocaleString()}</span> credits per month
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    credits renew every month
                  </div>
                </div>

                <button
                  onClick={onClick}
                  disabled={loading || (isSubscribed && isCurrent)}
                  className={`w-full py-3 px-4 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonColorClass}`}
                >
                  {loading ? "Processing..." : buttonText}
                </button>
              </div>
            );})}
          </div>

          {/* Upgrade/Downgrade policy note (inline text) */}
          <p className="mt-0 text-sm text-gray-400 text-center">
            <span className="text-gray-300 font-medium">Upgrade policy:</span> Pay the price difference now and immediately receive extra credits equal to
            <span className="text-gray-200 font-semibold"> New plan credits − Current plan credits</span>.
          </p>
          <p className="mt-0 mb-8 text-sm text-gray-400 text-center">
            Your renewal date stays the same. Downgrades take effect at the next renewal.
          </p>

          {/* Credit Purchase Section */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center justify-center gap-2">
                <FaCoins className="text-yellow-500" />
                Or Buy Credits As Needed
              </h2>
              <p className="text-gray-400">
                Perfect for occasional users who don't need a monthly subscription
              </p>
              <p className="text-sm text-gray-400 mt-2">
                Note: One-off purchased credits expire <span className="font-semibold text-gray-300">32 days</span> after purchase.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {packages.map((pkg) => (
                <div
                  key={pkg.credits}
                  className="border border-gray-600 hover:border-gray-500 bg-gray-700 rounded-lg p-6 text-center transition-all hover:shadow-lg"
                >
                  <div className="mb-4">
                    <div className="mb-2">
                      <span className="text-2xl font-bold text-white">
                        {pkg.credits} Credits
                      </span>
                    </div>
                    <div className="text-3xl font-bold text-white">
                      ${pkg.price}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      // Create checkout session via POST (body)
                      const payload = { 
                        credits: pkg.credits, 
                        amount_usd_cents: Math.round(pkg.price * 100) 
                      };
                      // Pass returnTo so user returns to original page after payment
                      if (returnTo) {
                        payload.returnTo = returnTo;
                      }
                      phFetch(`${API_BASE}/api/billing/create-checkout-session`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                      })
                      .then(async (r) => {
                        const data = await r.json();
                        if (!r.ok) throw new Error(data.error || 'Failed to start checkout');
                        window.location.href = data.url;
                      })
                      .catch((e) => alert(e.message));
                    }}
                    className="w-full py-2 px-4 rounded-lg font-semibold transition-colors bg-gray-600 hover:bg-gray-500 text-white"
                  >
                    Buy Now
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-6 text-center text-sm text-gray-500">
              For reference: Seedream 4.0 image ≈ 30 credits per output. 
              Seedance 1.0 Lite (480p, 5s, 16:9) ≈ 70 credits.
            </div>
          </div>
        </div>
      }
    />
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    }>
      <BillingContent />
    </Suspense>
  );
}
