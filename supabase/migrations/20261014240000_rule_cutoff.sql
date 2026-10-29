-- El corte de mes pasa a `rules`: cualquier fuente de ingreso con cutoff_day
-- (padre ~dia 30, Accenture ~dia 29-30) cuenta para el mes siguiente.
-- Reemplaza income_splits.cutoff_day.

alter table rules add column if not exists cutoff_day smallint
    check (cutoff_day is null or cutoff_day between 1 and 31);

update rules set cutoff_day = 25
where type = 'income' and pattern ~ 'miguel|d[ií]az';

update rules set cutoff_day = 25
where type = 'sponsorship' and pattern ~* 'accenture';

-- Las vistas dependen de income_splits.cutoff_day; hay que recrearlas.
drop view if exists public.transactions_budgeted cascade;
alter table income_splits drop column if exists cutoff_day;

create view transactions_budgeted
with (security_invoker = true)
as
select t.*,
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
           end as budget_month
from transactions t;

create view monthly_budget
with (security_invoker = true)
as
with bs as (
    select * from budget_split
),
tx as (
    select * from transactions_budgeted
),
months as (
    select real_month as month from tx
    union
    select budget_month from tx where direction = 'in'
),
income_by_month as (
    select budget_month as month, sum(amount) as total_income
    from tx where type = 'income' group by 1
),
spent_by_month_bucket as (
    select tx.real_month as month, c.bucket, sum(tx.amount) as total
    from tx join categories c on c.id = tx.category_id
    where tx.type = 'expense'
    group by 1, 2
),
savings_by_month as (
    select real_month as month,
           sum(case when type = 'savings' then amount
                    when type = 'savings_withdrawal' then -amount
                    else 0 end) as net_savings
    from tx where type in ('savings', 'savings_withdrawal') group by 1
),
unclassified_by_month as (
    select real_month as month, sum(amount) as unclassified_expense
    from tx where needs_review and direction = 'out' group by 1
),
extra_income_by_month as (
    select budget_month as month,
           sum(amount) filter (where type = 'sponsorship') as sponsorship_income,
           sum(amount) filter (where type = 'interest') as interest_income,
           sum(amount) filter (where type = 'debt_repayment') as debt_repayment_income,
           sum(amount) filter (where type = 'family_savings') as family_savings_income
    from tx where type in ('sponsorship', 'interest', 'debt_repayment', 'family_savings')
    group by 1
)
select
    m.month,
    coalesce(i.total_income, 0)                                   as income,
    coalesce(i.total_income, 0) * bs.needs_pct   / 100             as needs_goal,
    coalesce(sb.total, 0)                                          as needs_spent,
    coalesce(i.total_income, 0) * bs.needs_pct   / 100 - coalesce(sb.total, 0)   as needs_available,
    coalesce(i.total_income, 0) * bs.wants_pct   / 100             as wants_goal,
    coalesce(sw.total, 0)                                          as wants_spent,
    coalesce(i.total_income, 0) * bs.wants_pct   / 100 - coalesce(sw.total, 0)   as wants_available,
    coalesce(i.total_income, 0) * bs.savings_pct / 100             as savings_goal,
    coalesce(sv.net_savings, 0)                                    as savings_actual,
    coalesce(i.total_income, 0) * bs.savings_pct / 100 - coalesce(sv.net_savings, 0) as savings_available,
    coalesce(u.unclassified_expense, 0)                            as unclassified_expense,
    coalesce(e.sponsorship_income, 0)                              as sponsorship_income,
    coalesce(e.interest_income, 0)                                 as interest_income,
    coalesce(e.debt_repayment_income, 0)                           as debt_repayment_income,
    coalesce(e.family_savings_income, 0)                           as family_savings_income
from months m
cross join bs
left join income_by_month i on i.month = m.month
left join spent_by_month_bucket sb on sb.month = m.month and sb.bucket = 'needs'
left join spent_by_month_bucket sw on sw.month = m.month and sw.bucket = 'wants'
left join savings_by_month sv on sv.month = m.month
left join unclassified_by_month u on u.month = m.month
left join extra_income_by_month e on e.month = m.month
order by m.month;

create view savings_progress
with (security_invoker = true)
as
with per_month as (
    select month,
           savings_goal + interest_income + sponsorship_income + debt_repayment_income
             + family_savings_income as target,
           savings_actual as sent
    from monthly_budget
    where month >= date_trunc('month', (select tracking_start from budget_split)::timestamp)
)
select month,
       target,
       sent,
       sum(target) over (order by month) as cumulative_target,
       sum(sent) over (order by month) as cumulative_sent,
       sum(target) over (order by month) - sum(sent) over (order by month) as remaining
from per_month
order by month;

grant select on public.transactions_budgeted to authenticated;
grant select on public.monthly_budget to authenticated;
grant select on public.savings_progress to authenticated;
