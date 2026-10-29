-- Deudas pagadas con tarjeta de credito: cuando las cobran, esa plata va a
-- pagar la tarjeta, NO a ahorro. Se marcan para no sumarlas al global savings.
alter table public.debts
  add column if not exists exclude_from_savings boolean not null default false;

-- Backfill: deudas ligadas a transacciones en cuentas de credito (RappiCard)
update public.debts d
set exclude_from_savings = true
from public.transactions t
join public.accounts a on a.id = t.account_id
where d.tx_id = t.id
  and a.role = 'credit';
