-- Finance ledger for income and costs
CREATE TABLE IF NOT EXISTS finance_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  side TEXT NOT NULL CHECK (side IN ('income','cost')),
  category TEXT NOT NULL, -- subscription, one_off, refund, stripe_fee, provider_api, storage, other
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  quantity NUMERIC, -- optional measured units
  unit TEXT, -- tokens, sec, image, request
  model_key TEXT,
  provider TEXT,
  source TEXT, -- webhook, system, admin, backfill
  external_id TEXT, -- e.g., stripe invoice/charge id, provider request id
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_finance_ledger_created ON finance_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_ledger_category ON finance_ledger(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_ledger_model ON finance_ledger(model_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_ledger_provider ON finance_ledger(provider, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_finance_external ON finance_ledger(category, external_id) WHERE external_id IS NOT NULL;


