const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const auth = require('../middleware/auth');
const db = require('../db');
const router = express.Router();
const { addSubscriptionCredits, addCredits } = require('../utils/credits');

// Helper to ensure a valid Stripe customer exists for a user; recreates if stale
async function ensureStripeCustomerId(userId, userEmail) {
  // Look up mapping
  let { rows: customerRows } = await db.query(
    'SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1',
    [userId]
  );

  let customerId = customerRows[0]?.stripe_customer_id || null;
  if (customerId) {
    // Verify the customer actually exists in current Stripe account/key
    try {
      const cust = await stripe.customers.retrieve(customerId);
      if (cust && !cust.deleted) {
        return customerId;
      }
    } catch (e) {
      // fall through to recreate
      console.warn(`⚠️ Stripe customer ${customerId} not found; recreating for user ${userId}`);
    }
  }

  // Create a new Stripe customer
  const customer = await stripe.customers.create({
    email: userEmail,
    metadata: { user_id: userId }
  });
  // Upsert mapping
  await db.query(
    `INSERT INTO stripe_customers (user_id, stripe_customer_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id`,
    [userId, customer.id]
  );
  return customer.id;
}

// Public pricing endpoints
router.get('/public/plans', async (req, res) => {
  try {
    const { billingMode } = req.query; // optional
    let q = `SELECT plan_key as id, display_name as name, price_cents, credits_per_period, billing_mode FROM subscription_plans WHERE is_active = TRUE`;
    const params = [];
    if (billingMode) {
      q += ` AND billing_mode = $1`;
      params.push(billingMode);
    }
    q += ` ORDER BY sort_order ASC`;
    const { rows } = await db.query(q, params);
    res.json({ plans: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load plans' });
  }
});

router.get('/public/packages', async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT id, display_name, credits, price_cents FROM credit_packages WHERE is_active = TRUE ORDER BY sort_order ASC`);
    res.json({ packages: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load packages' });
  }
});

// Create Stripe checkout session for subscription
router.post('/create-subscription', auth, async (req, res) => {
  const getFrontendUrl = () => {
    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    
    if (isLocal || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      return 'http://localhost:3000';
    }
    return process.env.FRONTEND_URL || 'https://cooly.ai';
  };
  
  const frontendUrl = getFrontendUrl();
  
  try {
    const { planId, billingMode } = req.body;
    
    if (!planId || !billingMode) {
      return res.status(400).json({ error: 'Plan ID and billing mode required' });
    }

    // Read subscription plan from DB
    const { rows: planRows } = await db.query(
      `SELECT * FROM subscription_plans WHERE plan_key = $1 AND billing_mode = $2 AND is_active = TRUE LIMIT 1`,
      [planId, billingMode]
    );
    const planRow = planRows[0];
    const plan = planRow ? { price: planRow.price_cents, credits: planRow.credits_per_period } : null;
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan or billing mode' });
    }

    // Ensure a valid Stripe customer (recreates if stale)
    const customerId = await ensureStripeCustomerId(req.user.userId, req.user.email);

    // Reuse or create Stripe Product/Price for this plan
    let stripePriceId = planRow.stripe_price_id;
    let stripeProductId = planRow.stripe_product_id;

    if (!stripePriceId) {
      if (!stripeProductId) {
        const product = await stripe.products.create({
          name: `${planId.charAt(0).toUpperCase() + planId.slice(1)} Plan`,
        });
        stripeProductId = product.id;
        await db.query('UPDATE subscription_plans SET stripe_product_id = $1 WHERE id = $2', [stripeProductId, planRow.id]);
      }

      const priceObj = await stripe.prices.create({
        unit_amount: plan.price,
        currency: 'usd',
        recurring: { interval: billingMode === 'monthly' ? 'month' : 'year' },
        product: stripeProductId,
      });
      stripePriceId = priceObj.id;
      await db.query('UPDATE subscription_plans SET stripe_price_id = $1 WHERE id = $2', [stripePriceId, planRow.id]);
    }

    // Create checkout session for subscription
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      subscription_data: {
        metadata: {
          user_id: req.user.userId,
          plan_id: planId,
          billing_mode: billingMode,
          credits_per_month: String(plan.credits)
        }
      },
      success_url: `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/billing/cancel`,
      metadata: {
        user_id: req.user.userId,
        plan_id: planId,
        billing_mode: billingMode,
        credits_per_month: plan.credits.toString()
      }
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Subscription checkout session error:', error);
    res.status(500).json({ error: 'Failed to create subscription checkout session' });
  }
});

// Create Stripe checkout session for credit purchase
router.post('/create-checkout-session', auth, async (req, res) => {
  // Auto-detect frontend URL based on environment
  const getFrontendUrl = () => {
    // Check if we're running locally by looking at the request origin
    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    
    if (isLocal || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      return 'http://localhost:3000';
    }
    return process.env.FRONTEND_URL || 'https://cooly.ai';
  };
  
  const frontendUrl = getFrontendUrl();
  try {
    const { credits, amount_usd_cents, returnTo } = req.body;
    
    if (!credits || !amount_usd_cents) {
      return res.status(400).json({ error: 'Credits and amount required' });
    }

    // Ensure a valid Stripe customer (recreates if stale)
    const customerId = await ensureStripeCustomerId(req.user.userId, req.user.email);

    // Build success URL with returnTo parameter if provided
    let successUrl = `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    if (returnTo) {
      successUrl += `&returnTo=${encodeURIComponent(returnTo)}`;
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${credits} Credits`,
              description: `Purchase ${credits} credits for Cooly AI`,
            },
            unit_amount: amount_usd_cents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: `${frontendUrl}/billing/cancel`,
      metadata: {
        user_id: req.user.userId,
        credits: credits.toString(),
        amount_usd_cents: amount_usd_cents.toString()
      }
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Checkout session error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Create customer portal session for subscription management
router.post('/create-portal-session', auth, async (req, res) => {
  try {
    // Auto-detect frontend URL based on environment (same logic as other endpoints)
    const getFrontendUrl = () => {
      const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
      if (isLocal || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        return 'http://localhost:3000';
      }
      return process.env.FRONTEND_URL || 'https://cooly.ai';
    };
    const frontendUrl = getFrontendUrl();

    const { rows: customerRows } = await db.query(
      'SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1',
      [req.user.userId]
    );

    if (customerRows.length === 0) {
      return res.status(404).json({ error: 'No billing account found' });
    }

    const portalConfigId = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
    const portalParams = {
      customer: customerRows[0].stripe_customer_id,
      return_url: `${frontendUrl}/account`,
    };
    if (portalConfigId) {
      portalParams.configuration = portalConfigId;
    }
    const session = await stripe.billingPortal.sessions.create(portalParams);

    res.json({ url: session.url });
  } catch (error) {
    console.error('Portal session error:', error);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// Start a portal flow that updates the subscription to a higher-priced plan and collects payment now
// body: { planId: string, billingMode: 'monthly' | 'yearly' }
router.post('/upgrade-via-portal', auth, async (req, res) => {
  try {
    const { planId, billingMode } = req.body || {};
    if (!planId || !billingMode) {
      return res.status(400).json({ error: 'Plan ID and billing mode required' });
    }

    // Resolve customer and active subscription
    const customerId = await ensureStripeCustomerId(req.user.userId, req.user.email);

    let { rows: subRows } = await db.query(
      "SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND status IN ('active','trialing') LIMIT 1",
      [req.user.userId]
    );
    let subscriptionId = subRows[0]?.stripe_subscription_id || null;
    // Ensure the subscription belongs to this customer
    let subOk = false;
    if (subscriptionId) {
      try {
        const s = await stripe.subscriptions.retrieve(subscriptionId);
        subOk = s?.customer === customerId;
      } catch (_) { subOk = false; }
    }
    if (!subOk) {
      const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 1 });
      subscriptionId = list?.data?.[0]?.id || null;
    }
    if (!subscriptionId) return res.status(404).json({ error: 'Active subscription not found for this customer' });

    // Ensure target price id exists
    const { rows: planRows } = await db.query(
      'SELECT * FROM subscription_plans WHERE plan_key = $1 AND billing_mode = $2 AND is_active = TRUE LIMIT 1',
      [planId, billingMode]
    );
    const planRow = planRows[0];
    if (!planRow) return res.status(400).json({ error: 'Invalid plan or billing mode' });

    let stripePriceId = planRow.stripe_price_id;
    let stripeProductId = planRow.stripe_product_id;
    if (!stripePriceId) {
      if (!stripeProductId) {
        const product = await stripe.products.create({ name: `${planId.charAt(0).toUpperCase() + planId.slice(1)} Plan` });
        stripeProductId = product.id;
        await db.query('UPDATE subscription_plans SET stripe_product_id = $1 WHERE id = $2', [stripeProductId, planRow.id]);
      }
      const priceObj = await stripe.prices.create({
        unit_amount: planRow.price_cents,
        currency: 'usd',
        recurring: { interval: billingMode === 'monthly' ? 'month' : 'year' },
        product: stripeProductId,
      });
      stripePriceId = priceObj.id;
      await db.query('UPDATE subscription_plans SET stripe_price_id = $1 WHERE id = $2', [stripePriceId, planRow.id]);
    }

    // Frontend return URL
    const getFrontendUrl = () => {
      const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
      if (isLocal || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        return 'http://localhost:3000';
      }
      return process.env.FRONTEND_URL || 'https://cooly.ai';
    };
    const frontendUrl = getFrontendUrl();

    // Create a portal session that opens the subscription update flow.
    // Proration and allowed prices are controlled by your Portal configuration in the Dashboard.
    const portalConfigId = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
    const portalParams = {
      customer: customerId,
      return_url: `${frontendUrl}/account`,
      flow_data: {
        type: 'subscription_update',
        subscription_update: {
          subscription: subscriptionId,
        },
      },
    };
    if (portalConfigId) portalParams.configuration = portalConfigId;
    const session = await stripe.billingPortal.sessions.create(portalParams);

    return res.json({ url: session.url });
  } catch (error) {
    console.error('upgrade-via-portal error:', error);
    return res.status(500).json({ error: 'Failed to start upgrade flow' });
  }
});

// Change subscription plan (upgrade/downgrade with proration)
// body: { planId: string, billingMode: 'monthly' | 'yearly' }
router.post('/change-plan', auth, async (req, res) => {
  try {
    const { planId, billingMode } = req.body || {};
    if (!planId || !billingMode) {
      return res.status(400).json({ error: 'Plan ID and billing mode required' });
    }

    // Find user's active subscription id from DB first
    let { rows: subRows } = await db.query(
      "SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND status IN ('active','trialing') LIMIT 1",
      [req.user.userId]
    );
    let subscriptionId = subRows[0]?.stripe_subscription_id || null;

    // Fallback: resolve from Stripe by customer id
    if (!subscriptionId) {
      const { rows: customerRows } = await db.query(
        'SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1',
        [req.user.userId]
      );
      if (customerRows.length > 0) {
        const list = await stripe.subscriptions.list({ customer: customerRows[0].stripe_customer_id, status: 'all', limit: 1 });
        subscriptionId = list?.data?.[0]?.id || null;
      }
    }
    if (!subscriptionId) {
      return res.status(404).json({ error: 'Active subscription not found' });
    }

    // Read target plan from DB
    const { rows: planRows } = await db.query(
      'SELECT * FROM subscription_plans WHERE plan_key = $1 AND billing_mode = $2 AND is_active = TRUE LIMIT 1',
      [planId, billingMode]
    );
    const planRow = planRows[0];
    if (!planRow) {
      return res.status(400).json({ error: 'Invalid plan or billing mode' });
    }

    // Ensure we have a price id for the plan
    let stripePriceId = planRow.stripe_price_id;
    let stripeProductId = planRow.stripe_product_id;
    if (!stripePriceId) {
      if (!stripeProductId) {
        const product = await stripe.products.create({
          name: `${planId.charAt(0).toUpperCase() + planId.slice(1)} Plan`,
        });
        stripeProductId = product.id;
        await db.query('UPDATE subscription_plans SET stripe_product_id = $1 WHERE id = $2', [stripeProductId, planRow.id]);
      }
      const priceObj = await stripe.prices.create({
        unit_amount: planRow.price_cents,
        currency: 'usd',
        recurring: { interval: billingMode === 'monthly' ? 'month' : 'year' },
        product: stripeProductId,
      });
      stripePriceId = priceObj.id;
      await db.query('UPDATE subscription_plans SET stripe_price_id = $1 WHERE id = $2', [stripePriceId, planRow.id]);
    }

    // Retrieve subscription to find its item id and current price info
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const item = subscription?.items?.data?.[0];
    const itemId = item?.id;
    const currentPriceId = item?.price?.id;
    const currentUnitAmount = item?.price?.unit_amount || 0;
    if (!itemId) {
      return res.status(400).json({ error: 'Subscription item not found' });
    }

    const targetUnitAmount = planRow.price_cents;
    const isUpgrade = Number(targetUnitAmount) > Number(currentUnitAmount);

    if (isUpgrade) {
      // Immediate upgrade: create prorations and bill now
      const updated = await stripe.subscriptions.update(subscriptionId, {
        items: [{ id: itemId, price: stripePriceId }],
        proration_behavior: 'create_prorations',
        metadata: {
          ...(subscription.metadata || {}),
          user_id: req.user.userId,
          plan_id: planId,
          billing_mode: billingMode,
          credits_per_month: String(planRow.credits_per_period),
        },
      });
      return res.json({ ok: true, mode: 'upgrade_immediate', subscriptionId: updated.id, status: updated.status, current_period_end: updated.current_period_end });
    } else {
      // Downgrade: schedule change at next renewal using Subscription Schedules
      try {
        const schedule = await stripe.subscriptionSchedules.create({
          from_subscription: subscriptionId,
          phases: [
            {
              items: [{ price: currentPriceId }],
              end_date: subscription.current_period_end,
            },
            {
              items: [{ price: stripePriceId }],
            },
          ],
        });
        return res.json({ ok: true, mode: 'downgrade_scheduled', scheduleId: schedule.id, effective_at: subscription.current_period_end });
      } catch (e) {
        console.error('Failed to create schedule; falling back to immediate non-prorated change:', e?.message || e);
        const updated = await stripe.subscriptions.update(subscriptionId, {
          items: [{ id: itemId, price: stripePriceId }],
          proration_behavior: 'none',
          metadata: {
            ...(subscription.metadata || {}),
            user_id: req.user.userId,
            plan_id: planId,
            billing_mode: billingMode,
            credits_per_month: String(planRow.credits_per_period),
          },
        });
        return res.json({ ok: true, mode: 'downgrade_immediate_no_proration', subscriptionId: updated.id, status: updated.status });
      }
      // If schedule succeeded, record a scheduled plan change event for visibility
      try {
        const effectiveAt = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null;
        await db.query(
          `INSERT INTO subscription_events (user_id, stripe_subscription_id, event_type, prev_plan_key, new_plan_key, plan_display_name, billing_mode, source, metadata, effective_at)
           SELECT $1, $2, 'plan_change_scheduled', $3, $4, sp.display_name, $5, 'system', $6, $7
           FROM subscription_plans sp WHERE sp.plan_key = $4 AND sp.billing_mode = $5 LIMIT 1`,
          [req.user.userId, subscriptionId, (subscription.metadata?.plan_id || null), planId, billingMode, JSON.stringify({ reason: 'downgrade_at_renewal' }), effectiveAt]
        );
      } catch (logErr) {
        console.warn('⚠️ Failed to log plan_change_scheduled:', logErr?.message || logErr);
      }
    }
  } catch (error) {
    console.error('Change plan error:', error);
    return res.status(500).json({ error: 'Failed to change plan' });
  }
});

// Cancel subscription (default: at period end)
// body: { atPeriodEnd?: boolean }
router.post('/cancel', auth, async (req, res) => {
  try {
    const atPeriodEnd = req.body?.atPeriodEnd !== false;

    let { rows: subRows } = await db.query(
      "SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND status IN ('active','trialing') LIMIT 1",
      [req.user.userId]
    );
    let subscriptionId = subRows[0]?.stripe_subscription_id || null;
    if (!subscriptionId) {
      const { rows: customerRows } = await db.query(
        'SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1',
        [req.user.userId]
      );
      if (customerRows.length > 0) {
        const list = await stripe.subscriptions.list({ customer: customerRows[0].stripe_customer_id, status: 'all', limit: 1 });
        subscriptionId = list?.data?.[0]?.id || null;
      }
    }
    if (!subscriptionId) {
      return res.status(404).json({ error: 'Active subscription not found' });
    }

    let updated;
    if (atPeriodEnd) {
      updated = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    } else {
      updated = await stripe.subscriptions.cancel(subscriptionId);
    }
    return res.json({ ok: true, status: updated.status, cancel_at_period_end: updated.cancel_at_period_end });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Resume subscription (unset cancel_at_period_end)
router.post('/resume', auth, async (req, res) => {
  try {
    let { rows: subRows } = await db.query(
      "SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND status IN ('active','trialing') LIMIT 1",
      [req.user.userId]
    );
    let subscriptionId = subRows[0]?.stripe_subscription_id || null;
    if (!subscriptionId) {
      const { rows: customerRows } = await db.query(
        'SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1',
        [req.user.userId]
      );
      if (customerRows.length > 0) {
        const list = await stripe.subscriptions.list({ customer: customerRows[0].stripe_customer_id, status: 'all', limit: 1 });
        subscriptionId = list?.data?.[0]?.id || null;
      }
    }
    if (!subscriptionId) {
      return res.status(404).json({ error: 'Active subscription not found' });
    }

    const updated = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
    return res.json({ ok: true, status: updated.status, cancel_at_period_end: updated.cancel_at_period_end });
  } catch (error) {
    console.error('Resume subscription error:', error);
    return res.status(500).json({ error: 'Failed to resume subscription' });
  }
});

// Get current user's subscription details with billing mode
router.get('/me-subscription', auth, async (req, res) => {
  try {
    // Dynamic data - ensure no caching
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    // Find latest or active subscription for this user
    const { rows: subRows } = await db.query(
      `SELECT stripe_subscription_id, plan_id, status, current_period_end
       FROM subscriptions
       WHERE user_id = $1
       ORDER BY (status IN ('active','trialing')) DESC, current_period_end DESC NULLS LAST
       LIMIT 1`,
      [req.user.userId]
    );
    if (subRows.length === 0) {
      return res.json({ subscription: null });
    }
    const sub = subRows[0];

    // Resolve billing mode from Stripe subscription item interval
    let billingMode = null;
    let stripeSubscriptionObj = null;
    try {
      if (sub.stripe_subscription_id) {
        stripeSubscriptionObj = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        const interval = stripeSubscriptionObj?.items?.data?.[0]?.price?.recurring?.interval;
        billingMode = interval === 'year' ? 'yearly' : (interval === 'month' ? 'monthly' : null);
      }
    } catch (e) {
      billingMode = null;
    }

    // Prefer Stripe's current_period_end if DB is missing
    const currentPeriodEnd = sub.current_period_end || (
      stripeSubscriptionObj?.current_period_end ? new Date(stripeSubscriptionObj.current_period_end * 1000) : null
    );

    // Pending scheduled change (plan change/cancel/resume in future)
    let pendingChange = null;
    try {
      if (sub.stripe_subscription_id) {
        const { rows: pendingRows } = await db.query(
          `SELECT event_type, new_plan_key, plan_display_name, billing_mode, effective_at
           FROM subscription_events
           WHERE stripe_subscription_id = $1
             AND event_type IN ('plan_change_scheduled','cancel_scheduled','resume_scheduled')
             AND effective_at IS NOT NULL AND effective_at > NOW()
           ORDER BY effective_at ASC
           LIMIT 1`,
          [sub.stripe_subscription_id]
        );
        if (pendingRows.length > 0) {
          const r = pendingRows[0];
          pendingChange = {
            event_type: r.event_type,
            new_plan_key: r.new_plan_key,
            plan_display_name: r.plan_display_name,
            billing_mode: r.billing_mode,
            effective_at: r.effective_at,
          };
        }
      }
    } catch (_) {}

    // Upcoming invoice (next charge)
    let nextInvoice = null;
    try {
      const { rows: custRows } = await db.query(
        'SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1 LIMIT 1',
        [req.user.userId]
      );
      const customerId = custRows[0]?.stripe_customer_id || null;
      if (customerId) {
        const upcomingParams = { customer: customerId };
        if (sub.stripe_subscription_id) {
          upcomingParams.subscription = sub.stripe_subscription_id;
        }
        const upcoming = await stripe.invoices.retrieveUpcoming(upcomingParams);
        if (upcoming) {
          const amount = (upcoming.amount_due ?? upcoming.total ?? 0);
          const dueAt = upcoming.next_payment_attempt ? new Date(upcoming.next_payment_attempt * 1000) : null;
          nextInvoice = {
            amount_cents: amount,
            currency: (upcoming.currency || 'usd'),
            due_at: dueAt,
          };
        }
      }
    } catch (e) {
      // Ignore if no upcoming invoice
    }

    return res.json({
      subscription: {
        plan_id: sub.plan_id,
        status: sub.status,
        current_period_end: currentPeriodEnd,
        billing_mode: billingMode,
        pending_change: pendingChange,
        next_invoice: nextInvoice,
      }
    });
  } catch (error) {
    console.error('me-subscription error:', error);
    return res.status(500).json({ error: 'Failed to load subscription' });
  }
});

// Stripe webhook handler
router.post('/webhook', async (req, res) => {
  console.log('🔔 Webhook received!');
  console.log('Headers:', req.headers);
  
  const sig = req.headers['stripe-signature'];
  let event;

  // Auto-detect webhook secret based on environment
  const getWebhookSecret = () => {
    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    
    if (isLocal) {
      // For local development, try CLI webhook secret first, fallback to production
      const cliSecret = process.env.STRIPE_WEBHOOK_SECRET_CLI;
      const prodSecret = process.env.STRIPE_WEBHOOK_SECRET;
      console.log('🔍 Local environment detected');
      console.log('🔍 CLI Secret available:', !!cliSecret);
      console.log('🔍 Production Secret available:', !!prodSecret);
      return cliSecret || prodSecret;
    }
    
    // For production, use the production webhook secret
    console.log('🔍 Production environment detected');
    return process.env.STRIPE_WEBHOOK_SECRET;
  };

  const webhookSecret = getWebhookSecret();
  console.log('🔍 Using webhook secret:', webhookSecret ? 'Available' : 'Missing!');

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log('✅ Webhook signature verified successfully');
    console.log('📋 Event type:', event.type);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');

    switch (event.type) {
      case 'checkout.session.completed':
        console.log('💰 Processing checkout.session.completed event');
        const session = event.data.object;
        console.log('📋 Session metadata:', session.metadata);
        
        // Only process one-off credit purchases here (mode === 'payment')
        if (session.mode !== 'payment') {
          console.log('➡️ Skipping checkout.session.completed (not a one-off payment)');
          break;
        }
        
        // Add credits to user
        const credits = session.metadata?.credits ? parseInt(session.metadata.credits) : 0;
        const amount_usd_cents = session.metadata?.amount_usd_cents ? parseInt(session.metadata.amount_usd_cents) : 0;
        const userId = session.metadata?.user_id;

        if (!userId || !Number.isFinite(credits) || credits <= 0) {
          console.warn('⚠️ Missing or invalid one-off purchase metadata, skipping credit grant');
          break;
        }
        
        console.log(`💳 Adding ${credits} credits (one-off) to user ${userId}`);

        // Create one-off lot with a savepoint so later inserts don't abort the whole txn
        await client.query('SAVEPOINT oneoff_grant');
        let lotId = null;
        let lotExpiresAt = null;
        let newCreditsBalance = 0;
        try {
          const { rows: insLot } = await client.query(
            `INSERT INTO credit_lots (user_id, source, amount, remaining, expires_at)
             VALUES ($1,'one_off',$2,$2, NOW() + interval '32 days')
             RETURNING id, expires_at`,
            [userId, credits]
          );
          lotId = insLot[0]?.id || null;
          lotExpiresAt = insLot[0]?.expires_at || null;

          const { rows: sumRows } = await client.query(
            `SELECT COALESCE(SUM(remaining),0) AS rem FROM credit_lots
             WHERE user_id=$1 AND remaining>0 AND closed_at IS NULL AND expires_at > NOW()`,
            [userId]
          );
          newCreditsBalance = Number(sumRows[0]?.rem || 0);
          await client.query('UPDATE users SET credits = $1 WHERE id = $2', [newCreditsBalance, userId]);
          await client.query(
            'INSERT INTO credit_transactions (user_id, description, amount, balance_after, lot_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
            [userId, 'Credits purchased', credits, newCreditsBalance, lotId, lotExpiresAt]
          );
        } catch (e) {
          console.warn('⚠️ one-off lot grant failed:', e?.message || e);
          await client.query('ROLLBACK TO SAVEPOINT oneoff_grant');
        }

        // Sync email_credit_tracking.current_balance to reflect the new balance after purchase
        try {
          const { rows: emailRow } = await client.query('SELECT email FROM users WHERE id=$1', [userId]);
          const userEmail = emailRow[0]?.email || null;
          if (userEmail && Number.isFinite(newCreditsBalance)) {
            const { rows: trRows } = await client.query(
              'SELECT free_balance FROM email_credit_tracking WHERE email = $1',
              [userEmail]
            );
            const freeBal = trRows.length > 0 ? (Number(trRows[0].free_balance) || 0) : 0;
            const newPaid = Math.max(newCreditsBalance - freeBal, 0);
            const { rowCount } = await client.query(
              'UPDATE email_credit_tracking SET current_balance = $1, paid_balance = $2, last_updated_at = NOW() WHERE email = $3',
              [newCreditsBalance, newPaid, userEmail]
            );
            if (rowCount === 0) {
              await client.query(
                'INSERT INTO email_credit_tracking (email, total_credits_given, current_balance, free_balance, paid_balance) VALUES ($1, $2, $3, $4, $5)',
                [userEmail, 0, newCreditsBalance, 0, newCreditsBalance]
              );
            }
          }
        } catch (syncErr) {
          console.warn('⚠️ Failed to sync email_credit_tracking on purchase:', syncErr.message || syncErr);
        }

        // Record the purchase (handle tables without default id)
        try {
          await client.query(
            'INSERT INTO credit_purchases (user_id, stripe_payment_intent, credits_added, amount_usd_cents) VALUES ($1, $2, $3, $4)',
            [userId, session.payment_intent, credits, amount_usd_cents]
          );
        } catch (e) {
          if (String(e?.code) === '23502') {
            // Missing default on id; insert with explicit UUID
            try {
              await client.query(
                'INSERT INTO credit_purchases (id, user_id, stripe_payment_intent, credits_added, amount_usd_cents) VALUES (gen_random_uuid(), $1, $2, $3, $4)',
                [userId, session.payment_intent, credits, amount_usd_cents]
              );
              console.warn('⚠️ credit_purchases.id had no default; inserted with gen_random_uuid()');
            } catch (e2) {
              console.warn('⚠️ credit_purchases insert failed:', e2?.message || e2);
            }
          } else {
            console.warn('⚠️ credit_purchases insert failed:', e?.message || e);
          }
        }

        // Finance ledger income & fees (one-off)
        try {
          await client.query(
            `INSERT INTO finance_ledger (user_id, side, category, amount_cents, source, external_id, metadata)
             VALUES ($1, 'income', 'one_off', $2, 'webhook', $3, $4)
             ON CONFLICT DO NOTHING`,
            [
              userId,
              amount_usd_cents || (session.amount_total ?? 0),
              session.id,
              JSON.stringify({ payment_intent: session.payment_intent, credits })
            ]
          );
        } catch (e) {
          console.warn('⚠️ ledger insert (one_off) failed:', e?.message || e);
        }
        // Emit analytics: Purchase Completed (one-off)
        try {
          const { capture } = require('../utils/analytics');
          capture({
            distinctId: userId,
            event: 'Purchase Completed',
            properties: {
              mode: 'one_off',
              credits,
              amount_usd_cents,
              stripe_session_id: session.id
            }
          });
        } catch (_) {}
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        console.log('🔄 Processing subscription event:', event.type);
        const subscription = event.data.object;
        // Idempotency: skip duplicate handling for this event id within process lifetime
        const processedSubUpdates = (global.__processedSubUpdates = global.__processedSubUpdates || new Set());
        if (event?.id && processedSubUpdates.has(event.id)) {
          console.log(`🔁 Skipping duplicate subscription.updated ${event.id}`);
          break;
        }
        if (event?.id) processedSubUpdates.add(event.id);
        
        // Get subscription metadata
        let subUserId = subscription.metadata.user_id;
        // Fallback: resolve user by Stripe customer id when metadata is missing (e.g., portal updates)
        if (!subUserId) {
          try {
            const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
            if (customerId) {
              const { rows: urows } = await client.query(
                'SELECT user_id FROM stripe_customers WHERE stripe_customer_id = $1 LIMIT 1',
                [customerId]
              );
              if (urows.length > 0) subUserId = urows[0].user_id;
            }
          } catch (e) {
            console.warn('⚠️ Failed to map subscription customer to user:', e.message || e);
          }
        }
        const priceIdFromStripe = subscription?.items?.data?.[0]?.price?.id || null;
        // Try to resolve plan from price id first (covers portal updates where metadata isn't refreshed)
        let resolvedPlanId = null;
        let resolvedCredits = null;
        // Always capture interval directly from the subscription item if available
        let resolvedInterval = subscription?.items?.data?.[0]?.price?.recurring?.interval || null; // 'month' | 'year'
        if (priceIdFromStripe) {
          try {
            const { rows: planLookup } = await client.query(
              'SELECT plan_key, credits_per_period FROM subscription_plans WHERE stripe_price_id = $1 LIMIT 1',
              [priceIdFromStripe]
            );
            if (planLookup.length > 0) {
              resolvedPlanId = planLookup[0].plan_key;
              resolvedCredits = planLookup[0].credits_per_period;
            }
          } catch (e) {
            console.warn('⚠️ Failed to map price to plan:', e.message || e);
          }
          // Fallback: inspect Stripe price/product when DB mapping missing
          if (!resolvedPlanId) {
            try {
              const price = await stripe.prices.retrieve(priceIdFromStripe, { expand: ['product'] });
              const productName = typeof price?.product === 'object' ? price.product?.name : null;
              const interval = price?.recurring?.interval || null; // 'month' | 'year'
              if (productName) {
                const key = String(productName).split(' ')[0].toLowerCase(); // e.g., 'Pro Plan' -> 'pro'
                const { rows: byName } = await client.query(
                  'SELECT plan_key, credits_per_period FROM subscription_plans WHERE plan_key = $1 AND billing_mode = $2 LIMIT 1',
                  [key, interval === 'year' ? 'yearly' : 'monthly']
                );
                if (byName.length > 0) {
                  resolvedPlanId = byName[0].plan_key;
                  resolvedCredits = byName[0].credits_per_period;
                }
              }
              resolvedInterval = interval;
            } catch (e) {
              console.warn('⚠️ Stripe price inspection failed:', e.message || e);
            }
          }
        }
        const planId = resolvedPlanId || subscription.metadata.plan_id || null;
        let creditsPerMonth = parseInt(
          subscription.metadata.credits_per_month || (resolvedCredits != null ? resolvedCredits : 0)
        );
        if (!Number.isFinite(creditsPerMonth) || creditsPerMonth <= 0) {
          try {
            const key = planId;
            if (key) {
              const { rows } = await client.query(
                'SELECT credits_per_period FROM subscription_plans WHERE plan_key = $1 AND billing_mode = $2 LIMIT 1',
                [key, (resolvedInterval === 'year' ? 'yearly' : 'monthly')]
              );
              creditsPerMonth = rows[0]?.credits_per_period || 0;
            }
          } catch {}
        }
        
        console.log(`📋 Subscription details: User ${subUserId}, Plan ${planId}, Credits ${creditsPerMonth}/month`);
        
        // Read previous subscription snapshot before upsert (to detect upgrades and billing mode switches)
        const { rows: existingSubRows } = await client.query(
          'SELECT plan_id, billing_mode FROM subscriptions WHERE stripe_subscription_id = $1 LIMIT 1',
          [subscription.id]
        );
        const prevPlanId = existingSubRows[0]?.plan_id || null;
        const prevBillingMode = existingSubRows[0]?.billing_mode || null;
        
        // Upsert subscription record
        const periodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null;
        if (!subUserId) {
          console.warn('⚠️ Subscription event without resolvable user; skipping upsert');
          break;
        }

        const billingModeForSub = resolvedInterval === 'year' ? 'yearly' : (resolvedInterval === 'month' ? 'monthly' : null);
        await client.query(
          `INSERT INTO subscriptions (user_id, stripe_subscription_id, status, plan_id, current_period_end, billing_mode)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (stripe_subscription_id) 
           DO UPDATE SET 
             status = EXCLUDED.status,
             plan_id = COALESCE(EXCLUDED.plan_id, subscriptions.plan_id),
             current_period_end = EXCLUDED.current_period_end,
             billing_mode = COALESCE(EXCLUDED.billing_mode, subscriptions.billing_mode)`,
          [subUserId, subscription.id, subscription.status, planId, periodEnd, billingModeForSub]
        );
        console.log(`🔄 Subscription upserted for user ${subUserId}: plan=${planId || 'unchanged'} status=${subscription.status}`);

        // Log subscription event to subscription_events
        try {
          const { rows: planInfo } = await client.query(
            'SELECT display_name, billing_mode FROM subscription_plans WHERE plan_key = $1 LIMIT 1',
            [planId]
          );
          const wantedMode = resolvedInterval ? (resolvedInterval === 'year' ? 'yearly' : 'monthly') : null;
          let planName = null;
          let billingModeSnap = wantedMode;
          if (planId) {
            if (wantedMode) {
              const withMode = await client.query(
                'SELECT display_name, billing_mode FROM subscription_plans WHERE plan_key = $1 AND billing_mode = $2 LIMIT 1',
                [planId, wantedMode]
              );
              if (withMode.rows.length > 0) {
                planName = withMode.rows[0].display_name;
                billingModeSnap = withMode.rows[0].billing_mode;
              }
            }
            if (!planName) {
              planName = planInfo[0]?.display_name || null;
              billingModeSnap = planInfo[0]?.billing_mode || billingModeSnap;
            }
          }

          if (event.type === 'customer.subscription.created') {
            await client.query(
              `INSERT INTO subscription_events (user_id, stripe_subscription_id, event_type, prev_plan_key, new_plan_key, plan_display_name, billing_mode, source, metadata, effective_at)
               VALUES ($1, $2, 'created', NULL, $3, $4, $5, 'webhook', $6, $7)`,
              [subUserId, subscription.id, planId, planName, billingModeSnap, JSON.stringify({ status: subscription.status }), periodEnd]
            );
          }

          // Plan change or cancel schedule updates
          if (event.type === 'customer.subscription.updated') {
            // Plan changed
            if (prevPlanId && planId && prevPlanId !== planId) {
              let creditsDeltaLogged = null;
              try {
                const { rows: prevRows } = await client.query('SELECT credits_per_period FROM subscription_plans WHERE plan_key = $1 LIMIT 1', [prevPlanId]);
                const { rows: newRows } = await client.query('SELECT credits_per_period FROM subscription_plans WHERE plan_key = $1 LIMIT 1', [planId]);
                creditsDeltaLogged = Number(newRows[0]?.credits_per_period || 0) - Number(prevRows[0]?.credits_per_period || 0);
              } catch {}
              await client.query(
                `INSERT INTO subscription_events (user_id, stripe_subscription_id, event_type, prev_plan_key, new_plan_key, plan_display_name, billing_mode, credits_delta, source, metadata, effective_at)
                 VALUES ($1, $2, 'plan_changed', $3, $4, $5, $6, $7, 'webhook', $8, $9)`,
                [subUserId, subscription.id, prevPlanId, planId, planName, billingModeSnap, creditsDeltaLogged, JSON.stringify({ status: subscription.status }), periodEnd]
              );
            }
            // Cancel scheduled
            if (subscription.cancel_at_period_end) {
              await client.query(
                `INSERT INTO subscription_events (user_id, stripe_subscription_id, event_type, prev_plan_key, new_plan_key, plan_display_name, billing_mode, source, metadata, effective_at)
                 VALUES ($1, $2, 'cancel_scheduled', $3, $4, $5, $6, 'webhook', $7, $8)`,
                [subUserId, subscription.id, prevPlanId || planId, planId, planName, billingModeSnap, JSON.stringify({ status: subscription.status }), periodEnd]
              );
            }
          }
        } catch (e) {
          console.warn('⚠️ Failed to log subscription event:', e?.message || e);
        }

        // Immediate credit top-up on upgrade (flat delta policy)
        try {
          if (prevPlanId && planId && prevPlanId !== planId) {
            const { rows: prevRows } = await client.query(
              'SELECT credits_per_period FROM subscription_plans WHERE plan_key = $1 LIMIT 1',
              [prevPlanId]
            );
            const { rows: newRows } = await client.query(
              'SELECT credits_per_period FROM subscription_plans WHERE plan_key = $1 LIMIT 1',
              [planId]
            );
            const prevCredits = Number(prevRows[0]?.credits_per_period || 0);
            const newCredits = Number(newRows[0]?.credits_per_period || 0);
            const delta = newCredits - prevCredits;
            if (delta > 0) {
              await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [delta, subUserId]);
              const { rows: bal } = await client.query('SELECT credits FROM users WHERE id = $1', [subUserId]);
              await client.query(
                'INSERT INTO credit_transactions (user_id, description, amount, balance_after) VALUES ($1, $2, $3, $4)',
                [subUserId, `Upgrade to ${planId} top-up`, delta, bal[0].credits]
              );
              console.log(`⚡ Upgrade top-up: +${delta} credits for user ${subUserId}`);
            }
          }
        } catch (e) {
          console.warn('⚠️ Failed upgrade top-up handling:', e.message || e);
        }

        // Add initial credits
        if (event.type === 'customer.subscription.created' && creditsPerMonth > 0) {
          if (resolvedInterval === 'month') {
            const cycleStart = subscription?.current_period_start ? new Date(subscription.current_period_start * 1000) : null;
            const cycleEnd = subscription?.current_period_end ? new Date(subscription.current_period_end * 1000) : null;
            console.log(`💳 Adding ${creditsPerMonth} monthly credits (lots) to user ${subUserId} (initial cycle)`);
            try {
              const result = await addSubscriptionCredits(subUserId, creditsPerMonth, planId || 'subscription', { cycleStart, cycleEnd });
              if (!result?.success) {
                console.error('addSubscriptionCredits failed:', result?.error);
              } else if (result?.lotCreated) {
                console.log('✅ Monthly credits (lots) added successfully');
              } else {
                console.log('⏭️ Initial subscription lot already exists (idempotent)');
              }
            } catch (e) {
              console.error('addSubscriptionCredits error (created):', e?.message || e);
            }
          } else if (resolvedInterval === 'year') {
            // Seed the first month's lot immediately based on month boundaries
            const now = new Date();
            const cycleStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
            const cycleEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
            console.log(`💳 Yearly plan: adding first monthly lot to user ${subUserId}`);
            try {
              const result = await addSubscriptionCredits(subUserId, creditsPerMonth, planId || 'subscription', { cycleStart, cycleEnd });
              if (!result?.success) {
                console.error('addSubscriptionCredits failed (yearly initial):', result?.error);
              } else if (result?.lotCreated) {
                console.log('✅ Yearly first-month lot added successfully');
              } else {
                console.log('⏭️ Yearly first-month lot already exists (idempotent)');
              }
            } catch (e) {
              console.error('addSubscriptionCredits error (yearly initial):', e?.message || e);
            }
          }
        }

        // If switching billing mode from monthly -> yearly, add the first month lot immediately (idempotent)
        try {
          const billingModeForSub = resolvedInterval === 'year' ? 'yearly' : (resolvedInterval === 'month' ? 'monthly' : null);
          if (event.type === 'customer.subscription.updated' && prevBillingMode === 'monthly' && billingModeForSub === 'yearly' && creditsPerMonth > 0) {
            const now2 = new Date();
            const cycleStart2 = new Date(Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth(), 1, 0, 0, 0));
            const cycleEnd2 = new Date(Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth() + 1, 1, 0, 0, 0));
            const result2 = await addSubscriptionCredits(subUserId, creditsPerMonth, planId || 'subscription', { cycleStart: cycleStart2, cycleEnd: cycleEnd2 });
            if (result2?.lotCreated) {
              console.log('✅ Added first monthly lot after switching to yearly');
            } else {
              console.log('⏭️ First monthly lot already exists after switching to yearly');
            }
          }
        } catch (e) {
          console.warn('⚠️ Failed to add yearly first-month lot on switch:', e?.message || e);
        }
        break;

      case 'customer.subscription.deleted':
        console.log('🗑️ Processing subscription cancellation');
        const cancelledSubscription = event.data.object;
        
        await client.query(
          'UPDATE subscriptions SET status = $1 WHERE stripe_subscription_id = $2',
          ['cancelled', cancelledSubscription.id]
        );
        try {
          // Resolve user id via mapping
          let subUserId3 = cancelledSubscription.metadata?.user_id || null;
          if (!subUserId3) {
            const customerId = typeof cancelledSubscription.customer === 'string' ? cancelledSubscription.customer : cancelledSubscription.customer?.id;
            if (customerId) {
              const { rows: urows } = await client.query('SELECT user_id FROM stripe_customers WHERE stripe_customer_id = $1 LIMIT 1', [customerId]);
              if (urows.length > 0) subUserId3 = urows[0].user_id;
            }
          }
          // Resolve plan key if possible
          let planKey3 = null;
          const priceId3 = cancelledSubscription?.items?.data?.[0]?.price?.id || null;
          if (priceId3) {
            const { rows: p } = await client.query('SELECT plan_key FROM subscription_plans WHERE stripe_price_id = $1 LIMIT 1', [priceId3]);
            if (p.length > 0) planKey3 = p[0].plan_key;
          }
          await client.query(
            `INSERT INTO subscription_events (user_id, stripe_subscription_id, event_type, prev_plan_key, new_plan_key, plan_display_name, billing_mode, source, metadata, effective_at)
             SELECT $1, $2, 'canceled', $3, $3, sp.display_name, sp.billing_mode, 'webhook', $4, NOW()
             FROM subscription_plans sp WHERE sp.plan_key = $3 LIMIT 1`,
            [subUserId3, cancelledSubscription.id, planKey3, JSON.stringify({ status: cancelledSubscription.status })]
          );
        } catch (e) {
          console.warn('⚠️ Failed to log cancellation event:', e?.message || e);
        }
        break;

      case 'invoice.paid':
      case 'invoice_payment.paid': { // some accounts emit underscore variant in test clock
        // No-op: single source of truth is invoice.payment_succeeded
        break; }

      case 'invoice.payment_succeeded':
      case 'invoice_payment.succeeded': { // underscore variant
        // Single source of truth for subscription billing
        const invoice = event.data.object;
        const reason = invoice?.billing_reason || 'unknown';
        console.log(`🧾 invoice ${invoice?.id} reason=${reason}`);
        // Process any subscription invoice for ledger. Credits only on renewal cycles.
        let subscriptionId = invoice.subscription || invoice?.lines?.data?.[0]?.subscription || null;
        if (!subscriptionId && invoice.customer) {
          const list = await stripe.subscriptions.list({ customer: invoice.customer, limit: 1 });
          subscriptionId = list?.data?.[0]?.id || null;
        }
        if (!subscriptionId) {
          console.warn('⚠️ invoice payment_succeeded without resolvable subscription id; skipping credit');
          // Still try to record ledger without subscription context
          try {
            await client.query(
              `INSERT INTO finance_ledger (user_id, side, category, amount_cents, source, external_id)
               SELECT sc.user_id, 'income', 'subscription', $1, 'webhook', $2
               FROM stripe_customers sc WHERE sc.stripe_customer_id = $3
               ON CONFLICT DO NOTHING`,
              [invoice.amount_paid || invoice.total || 0, invoice.id, invoice.customer || null]
            );
          } catch {}
          break;
        }
        const subs = await stripe.subscriptions.retrieve(subscriptionId);
        const subUserId2 = subs.metadata?.user_id;
        const creditsPerMonth2 = parseInt(subs.metadata?.credits_per_month || '0');
        if (!subUserId2) break;
        // Resolve plan key for logging/ledger
        const priceIdR = subs?.items?.data?.[0]?.price?.id || null;
        let planKeyR = subs?.metadata?.plan_id || null;
        if (priceIdR && !planKeyR) {
          const { rows: pl } = await client.query('SELECT plan_key FROM subscription_plans WHERE stripe_price_id = $1 LIMIT 1', [priceIdR]);
          planKeyR = pl[0]?.plan_key || null;
        }
        // Only add credits on renewal cycles
        if (reason === 'subscription_cycle' && creditsPerMonth2 > 0) {
          console.log(`🔁 (payment_succeeded) Credit top-up ${creditsPerMonth2} for user ${subUserId2}`);
          try {
            const line = invoice?.lines?.data?.[0];
            const cycleStart = line?.period?.start ? new Date(line.period.start * 1000) : null;
            const cycleEnd = line?.period?.end ? new Date(line.period.end * 1000) : null;
            const result = await addSubscriptionCredits(subUserId2, creditsPerMonth2, planKeyR || 'subscription', { cycleStart, cycleEnd });
            if (!result?.success) {
              console.error('addSubscriptionCredits failed (payment_succeeded):', result?.error);
            } else if (result?.lotCreated) {
              console.log(`✅ Subscription lot created for ${subUserId2} cycleStart=${cycleStart?.toISOString() || 'null'}`);
            } else {
              console.log(`⏭️ Subscription lot already exists (idempotent) for ${subUserId2} cycleStart=${cycleStart?.toISOString() || 'null'}`);
            }
          } catch (e) {
            console.error('addSubscriptionCredits error (payment_succeeded):', e?.message || e);
          }
        }
        try {
          const intervalR = subs?.items?.data?.[0]?.price?.recurring?.interval || null;
          const billingModeR = intervalR === 'year' ? 'yearly' : (intervalR === 'month' ? 'monthly' : null);
          let planNameR = null;
          if (planKeyR && billingModeR) {
            const { rows: pinfo } = await client.query('SELECT display_name FROM subscription_plans WHERE plan_key = $1 AND billing_mode = $2 LIMIT 1', [planKeyR, billingModeR]);
            planNameR = pinfo[0]?.display_name || null;
          }
          if (reason === 'subscription_cycle') {
            await client.query(
              `INSERT INTO subscription_events (user_id, stripe_subscription_id, event_type, new_plan_key, plan_display_name, billing_mode, amount_cents, source, metadata, effective_at)
               VALUES ($1, $2, 'renewed', $3, $4, $5, $6, 'webhook', $7, NOW())`,
              [subUserId2, subscriptionId, planKeyR, planNameR, billingModeR, invoice.amount_paid || invoice.total || 0, JSON.stringify({ invoice_id: invoice.id })]
            );
          }
        } catch (e) {
          console.warn('⚠️ Failed to log renewal event (payment_succeeded):', e?.message || e);
        }
        // Finance ledger income (idempotent on external_id) for any subscription invoice
        try {
          const interval = subs?.items?.data?.[0]?.price?.recurring?.interval || null;
          const billingModeMeta = interval === 'year' ? 'yearly' : (interval === 'month' ? 'monthly' : null);
          let planKeyMeta = planKeyR;
          const ledgerRes = await client.query(
            `INSERT INTO finance_ledger (user_id, side, category, amount_cents, source, external_id, metadata)
             VALUES ($1, 'income', 'subscription', $2, 'webhook', $3, $4)
             ON CONFLICT DO NOTHING`,
            [
              subUserId2,
              invoice.amount_paid || invoice.total || 0,
              invoice.id,
              JSON.stringify({ subscription_id: subscriptionId, plan_key: planKeyMeta, billing_mode: billingModeMeta })
            ]
          );
          if (ledgerRes.rowCount === 1) {
            console.log(`💰 Finance ledger recorded for invoice ${invoice.id}`);
          } else {
            console.log(`⏭️ Finance ledger already recorded (idempotent) for invoice ${invoice.id}`);
          }
        } catch (e) {
          console.warn('⚠️ ledger insert (payment_succeeded) failed:', e?.message || e);
        }
        break; }

      case 'test_helpers.test_clock.advancing':
      case 'test_helpers.test_clock.ready': {
        // Disabled: rely solely on invoice.payment_succeeded to grant credits
        console.log(`🕐 Test clock event ignored: ${event.type}`);
        break; }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    await client.query('COMMIT');
    res.json({ received: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  } finally {
    client.release();
  }
});

// Monthly credit scheduler endpoint (call this monthly via cron job)
router.post('/distribute-monthly-credits', async (req, res) => {
  try {
    console.log('🔄 Starting monthly credit distribution...');
    
    // Get all active yearly subscriptions
    const { rows: yearlySubs } = await db.query(`
      SELECT s.user_id, s.plan_id, sp.credits_per_period, s.current_period_end
      FROM subscriptions s
      JOIN subscription_plans sp ON s.plan_id = sp.plan_key
      WHERE s.status = 'active' 
      AND sp.billing_mode = 'yearly'
    `);
    
    console.log(`📊 Found ${yearlySubs.length} active yearly subscriptions`);
    
    // Compute precise monthly cycle window: [start of UTC month, start of next UTC month)
    // Allow testing by overriding with ?asOf=ISO8601 (e.g., 2025-10-01T00:00:00Z)
    const asOfParam = req.query?.asOf;
    const asOf = asOfParam ? new Date(asOfParam) : new Date();
    const now = Number.isFinite(asOf.getTime()) ? asOf : new Date();
    const cycleStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
    const cycleEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
    
    let distributedCount = 0;
    for (const sub of yearlySubs) {
      const creditsPerMonth = sub.credits_per_period;
      try {
        const result = await addSubscriptionCredits(sub.user_id, creditsPerMonth, sub.plan_id || 'subscription', { cycleStart, cycleEnd });
        if (result?.success && result?.lotCreated) {
          distributedCount++;
          console.log(`✅ Yearly monthly lot created for user ${sub.user_id} cycleStart=${cycleStart.toISOString()}`);
        } else if (result?.success) {
          console.log(`⏭️ Lot already exists for user ${sub.user_id} cycleStart=${cycleStart.toISOString()}`);
        } else {
          console.warn(`⚠️ addSubscriptionCredits failed for user ${sub.user_id}`);
        }
      } catch (e) {
        console.error(`❌ Monthly distribution failed for user ${sub.user_id}:`, e?.message || e);
      }
    }
    
    console.log(`🎉 Monthly credit distribution complete: ${distributedCount} users processed`);
    res.json({ 
      success: true, 
      distributedCount, 
      message: `Distributed credits to ${distributedCount} yearly subscribers` 
    });
    
  } catch (error) {
    console.error('❌ Monthly credit distribution error:', error);
    res.status(500).json({ error: 'Failed to distribute monthly credits' });
  }
});

module.exports = router; 

// Stripe webhook to grant monthly credits
// Add this at the end so raw body parsing doesn't conflict with app.js
const webhookPath = '/webhook';
router.post(webhookPath, express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event = req.body;
    if (endpointSecret && sig) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      } catch (err) {
        console.error('Stripe signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    } else if (typeof event === 'string') {
      event = JSON.parse(event);
    }

    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      // We expect metadata on the subscription or the customer mapping
      const subscriptionId = invoice.subscription;
      let userId = null, planKey = null, monthlyCredits = null;

      // Try pulling metadata from the price or subscription
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        planKey = sub?.items?.data?.[0]?.plan?.metadata?.plan_key || sub?.metadata?.plan_id || null;
        monthlyCredits = Number(sub?.items?.data?.[0]?.plan?.metadata?.credits_per_month || sub?.metadata?.credits_per_month || 0) || null;
        const customerId = sub.customer;
        const map = await db.query('select user_id from stripe_customers where stripe_customer_id=$1', [customerId]);
        userId = map.rows[0]?.user_id || null;
      } catch {}

      if (userId && monthlyCredits) {
        const result = await addSubscriptionCredits(userId, monthlyCredits, planKey || 'subscription');
        if (!result.success) {
          console.error('addSubscriptionCredits failed:', result.error);
        }
      } else {
        console.warn('Webhook invoice.payment_succeeded missing userId or monthlyCredits');
      }
    }

    return res.json({ received: true });
  } catch (e) {
    console.error('Stripe webhook error:', e);
    return res.status(500).json({ error: 'Webhook handler error' });
  }
});