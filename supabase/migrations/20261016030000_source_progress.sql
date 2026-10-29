-- Connect savings_sources to savings_progress: active "out" sources
-- (monthly commitments like the 200k FNA deposit) add their
-- expected_monthly to each month's savings target. Pausing a source
-- (active=false) stops it from adding to the goal automatically.
create or replace view savings_progress
with (security_invoker = true)
as
with per_month as (
    select month,
           savings_goal + interest_income + sponsorship_income + debt_repayment_income
             + family_savings_income + src.expected_out as target,
           savings_actual as sent
    from monthly_budget
    cross join (
        select coalesce(sum(expected_monthly), 0) as expected_out
        from savings_sources
        where active and direction = 'out' and expected_monthly > 0
    ) src
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
