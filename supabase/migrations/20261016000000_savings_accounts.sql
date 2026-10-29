-- Savings baseline becomes a breakdown of named accounts (where the money lives).
-- "Me deben" (open owed_to_me debts) is added live by the frontend.
alter table public.budget_split
  add column if not exists baseline_accounts jsonb not null default '[]'::jsonb;

-- Seed current accounts. Nu gets only the pre-tracking portion
-- (2,959,000 actual balance - 1,618,087 already tracked via savings_progress).
update public.budget_split set
  baseline_accounts = '[
    {"label": "FNA (Fondo Nacional del Ahorro)", "amount": 1800000},
    {"label": "Prestado a papa", "amount": 5500000},
    {"label": "Prestado a tio", "amount": 500000},
    {"label": "Nu (saldo previo al tracking)", "amount": 1340913}
  ]'::jsonb,
  savings_baseline = 0
where id = true;
