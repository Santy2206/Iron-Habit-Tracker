-- Monto original de una transaccion partida (split): vive en la tx, no en la
-- nota de la deuda, asi sobrevive a ediciones de nota y a marcarla paid.

alter table public.transactions add column if not exists original_amount numeric;

create or replace view transactions_budgeted
with (security_invoker = true)
as
select t.id, t.account_id, t.occurred_at, t.direction, t.amount, t.type,
       t.category_id, t.counterparty, t.description, t.source, t.raw_text,
       t.dedupe_hash, t.needs_review, t.matched_rule_id, t.created_at,
       t.paired_with,
       date_trunc('month', t.occurred_at at time zone 'America/Bogota') as real_month,
       date_trunc('month', t.occurred_at at time zone 'America/Bogota')
         + case
             when extract(day from t.occurred_at at time zone 'America/Bogota')
                    >= (select income_cutoff_day from budget_split)
             then interval '1 month' else interval '0'
           end as budget_month,
       t.label,
       t.original_amount
from transactions t;

grant select on public.transactions_budgeted to authenticated;
