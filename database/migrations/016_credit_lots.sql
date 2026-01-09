-- 016_credit_lots.sql
-- Introduce per-lot credit tracking with expiries

create table if not exists public.credit_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('subscription','one_off','adjustment')),
  plan_key text null,
  cycle_start timestamptz null,
  amount integer not null check (amount >= 0),
  remaining integer not null check (remaining >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz null
);

create index if not exists idx_credit_lots_user_expires on public.credit_lots(user_id, expires_at) where closed_at is null;
create index if not exists idx_credit_lots_user_remaining on public.credit_lots(user_id) where remaining > 0 and closed_at is null;

-- Optional link from transactions to lots for audit
alter table if exists public.credit_transactions
  add column if not exists lot_id uuid null references public.credit_lots(id),
  add column if not exists expires_at timestamptz null;


