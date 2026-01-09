-- Add reservation linkage to ledger for auditability and stronger idempotency semantics
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS reservation_id uuid NULL;

-- Non-unique index (we may record per-lot rows for a single reservation)
CREATE INDEX IF NOT EXISTS idx_credit_transactions_reservation_id
  ON credit_transactions (reservation_id);

-- Foreign key to reservations; keep rows if reservation is removed
ALTER TABLE credit_transactions
  ADD CONSTRAINT fk_credit_transactions_reservation
  FOREIGN KEY (reservation_id)
  REFERENCES credit_reservations(id)
  ON DELETE SET NULL;


