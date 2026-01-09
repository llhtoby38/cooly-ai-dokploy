/*
 Backfill subscriptions.billing_mode from Stripe

 Usage:
   cd backend && node scripts/backfill_billing_mode.js

 Requires env:
   STRIPE_SECRET_KEY
   DATABASE_URL / PREVIEW_DATABASE_URL (handled by ../src/db.js)
*/

// Load env from ../.env if present
try {
  require('dotenv').config({ path: '../.env' });
} catch {}

const Stripe = require('stripe');
const db = require('../src/db');

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  console.error('Missing STRIPE_SECRET_KEY');
  process.exit(1);
}

const stripe = new Stripe(stripeSecret, { apiVersion: '2024-06-20' });

async function backfill() {
  const client = await db.getClient();
  try {
    console.log('Fetching subscriptions with NULL billing_mode...');
    const { rows } = await client.query(
      `select stripe_subscription_id from subscriptions
       where billing_mode is null and stripe_subscription_id is not null`
    );
    console.log(`Found ${rows.length} rows to backfill.`);

    let ok = 0, failed = 0;
    for (const r of rows) {
      const subId = r.stripe_subscription_id;
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        const interval = sub?.items?.data?.[0]?.price?.recurring?.interval;
        const mode = interval === 'year' ? 'yearly' : (interval === 'month' ? 'monthly' : null);
        if (!mode) {
          console.warn(`Skip ${subId}: could not determine interval`);
          failed++;
          continue;
        }
        await client.query(
          'update subscriptions set billing_mode = $1 where stripe_subscription_id = $2',
          [mode, subId]
        );
        ok++;
        console.log(`Updated ${subId} → ${mode}`);
      } catch (e) {
        failed++;
        console.warn(`Failed ${subId}:`, e?.message || e);
      }
    }
    console.log(`Done. Updated=${ok} Failed=${failed}`);
  } finally {
    client.release();
  }
}

backfill().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});


