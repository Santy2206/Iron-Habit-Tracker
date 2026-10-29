-- Refine: an "out" source's expected_monthly only counts toward a
-- month's savings target from the month the source was created —
-- historical months before the source existed aren't charged.
create or replace view savings_progress
with (security_invoker = true)
as
with per_month as (
    select month,
           savings_goal + interest_income + sponsorship_income + debt_repayment_income
             + family_savings_income + src.expected_out as target,
           savings_actual as sent
    from monthly_budget
    cross join lateral (
        select coalesce(sum(s.expected_monthly), 0) as expected_out
        from savings_sources s
        where s.active
          and s.direction = 'out'
          and s.expected_monthly > 0
          and date_trunc('month', s.created_at) <= monthly_budget.month
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
