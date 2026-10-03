-- NOTA: datos personales reemplazados por <MARCADORES>; los valores reales viven solo en la base de datos (rules / income_splits).
-- Nuevos tipos de ingreso que NO entran a la base del 50/30/20 (van a ahorros), gasto
-- desconocido = gusto por defecto, y la cuenta Daviplata.

-- 'sponsorship' (patrocinio, ej. <PATROCINADOR>) e 'interest' (intereses de dinero prestado).
alter table transactions drop constraint transactions_type_check;
alter table transactions add constraint transactions_type_check check (type in (
    'income', 'expense', 'savings', 'savings_withdrawal',
    'internal_transfer', 'card_payment', 'sponsorship', 'interest'
));
alter table rules drop constraint rules_type_check;
alter table rules add constraint rules_type_check check (type in (
    'income', 'expense', 'savings', 'savings_withdrawal',
    'internal_transfer', 'card_payment', 'sponsorship', 'interest'
));

-- <PATROCINADOR> = patrocinio: plata externa que se prefiere ahorrar, no cuenta como ingreso base.
insert into rules (priority, direction, pattern, type)
values (20, 'in', '<PATROCINADOR>', 'sponsorship');

-- Todo gasto sin regla es gusto (prioridad 99: cualquier regla especifica gana primero).
insert into rules (priority, direction, pattern, type, category_id)
select 99, 'out', '.', 'expense', id from categories where name = 'Otros gustos';

-- Daviplata: sus movimientos se capturaran por notificaciones del celular (webhook).
insert into accounts (name, role) values ('Daviplata', 'operating');

-- monthly_budget: agrega patrocinio e intereses (columnas al final).
create or replace view monthly_budget
with (security_invoker = true)
as
with months as (
    select distinct date_trunc('month', occurred_at at time zone 'America/Bogota') as month
    from transactions
),
income_by_month as (
    select date_trunc('month', occurred_at at time zone 'America/Bogota') as month,
           sum(amount) as total_income
    from transactions
    where type = 'income'
    group by 1
),
spent_by_month_bucket as (
    select date_trunc('month', t.occurred_at at time zone 'America/Bogota') as month,
           c.bucket,
           sum(t.amount) as total
    from transactions t
    join categories c on c.id = t.category_id
    where t.type = 'expense'
    group by 1, 2
),
savings_by_month as (
    select date_trunc('month', occurred_at at time zone 'America/Bogota') as month,
           sum(case when type = 'savings' then amount
                    when type = 'savings_withdrawal' then -amount
                    else 0 end) as net_savings
    from transactions
    where type in ('savings', 'savings_withdrawal')
    group by 1
),
unclassified_by_month as (
    select date_trunc('month', occurred_at at time zone 'America/Bogota') as month,
           sum(amount) as unclassified_expense
    from transactions
    where needs_review and direction = 'out'
    group by 1
),
extra_income_by_month as (
    select date_trunc('month', occurred_at at time zone 'America/Bogota') as month,
           sum(amount) filter (where type = 'sponsorship') as sponsorship_income,
           sum(amount) filter (where type = 'interest') as interest_income
    from transactions
    where type in ('sponsorship', 'interest')
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
    coalesce(e.interest_income, 0)                                 as interest_income
from months m
cross join budget_split bs
left join income_by_month i on i.month = m.month
left join spent_by_month_bucket sb on sb.month = m.month and sb.bucket = 'needs'
left join spent_by_month_bucket sw on sw.month = m.month and sw.bucket = 'wants'
left join savings_by_month sv on sv.month = m.month
left join unclassified_by_month u on u.month = m.month
left join extra_income_by_month e on e.month = m.month
order by m.month;
