-- Restore the per-rule cutoff in transactions_budgeted.budget_month:
-- a tx arriving on/after a matching rule's cutoff_day counts toward the
-- next budget month (e.g. the Accenture sponsorship paid ~Sep 29 counts
-- as October). Dropped by accident when the view was re-created with
-- label/original_amount columns.
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
               or exists (
                    select 1 from rules r
                    where r.active
                      and r.cutoff_day is not null
                      and (r.direction is null or r.direction = t.direction)
                      and extract(day from t.occurred_at at time zone 'America/Bogota') >= r.cutoff_day
                      and coalesce(t.counterparty, '') || ' ' || coalesce(t.description, '') ~* r.pattern
                  )
             then interval '1 month' else interval '0'
           end as budget_month,
       t.label,
       t.original_amount
from transactions t;

grant select on public.transactions_budgeted to authenticated;
