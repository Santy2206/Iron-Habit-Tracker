-- NOTA: datos personales reemplazados por <MARCADORES>; los valores reales viven solo en la base de datos (rules / income_splits).
-- Corte de ingresos, separacion de pagos fijos (padre) y seguimiento del ahorro a enviar.

-- Los ingresos recibidos desde el dia `income_cutoff_day` cuentan para el mes siguiente
-- (el padre paga el 30 o la primera semana del mes siguiente). `tracking_start` marca desde
-- que mes se acumula el seguimiento de ahorro.
alter table budget_split add column if not exists income_cutoff_day smallint not null default 25
    check (income_cutoff_day between 1 and 31);
alter table budget_split add column if not exists tracking_start date not null default '2026-09-01';

-- Pagos fijos que llegan juntos pero se parten en dos: los primeros `base_amount` son
-- ingreso base y el resto (ej. intereses) va a ahorros.
create table income_splits (
    id              uuid primary key default gen_random_uuid(),
    name            text not null,
    pattern         text not null,                       -- regex sobre contraparte/descripcion
    base_amount     numeric(14,2) not null check (base_amount > 0),
    remainder_type  text not null default 'interest' check (remainder_type in ('interest', 'sponsorship')),
    active          boolean not null default true,
    created_at      timestamptz not null default now()
);
alter table income_splits enable row level security;
create policy income_splits_authenticated_all on income_splits
    for all to authenticated using (true) with check (true);

-- Padre: llama desde el <CELULAR_PADRE>. 500.000 de mesada = ingreso; el resto son intereses.
insert into income_splits (name, pattern, base_amount, remainder_type)
values ('Padre', '<CELULAR_PADRE>', 500000, 'interest');

-- Un pago del padre de hasta 500.000 es ingreso completo (sin pasar por revision).
insert into rules (priority, direction, pattern, type)
values (20, 'in', '<CELULAR_PADRE>', 'income');

-- Cuenta de Rappi (se capturara por notificaciones del celular).
insert into accounts (name, role) values ('RappiCuenta', 'operating');

-- apply_rules: ahora tambien parte los ingresos de income_splits en dos filas.
-- La fila sobrante lleva el hash `<hash>:split` y ya viene clasificada: el trigger no la toca.
create or replace function apply_rules()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
    matched rules%rowtype;
    sp income_splits%rowtype;
    extra numeric;
begin
    if new.dedupe_hash like '%:split' then
        return new;
    end if;

    select r.* into matched
    from rules r
    where r.active
      and (r.account_id is null or r.account_id = new.account_id)
      and (r.direction is null or r.direction = new.direction)
      and coalesce(new.counterparty, '') || ' ' || coalesce(new.description, '') ~* r.pattern
    order by r.priority
    limit 1;

    if found then
        new.type := matched.type;
        new.category_id := matched.category_id;
        new.matched_rule_id := matched.id;
        new.needs_review := false;
    else
        new.type := case new.direction when 'in' then 'income' else 'expense' end;
        new.category_id := null;
        new.matched_rule_id := null;
        new.needs_review := true;
    end if;

    if new.direction = 'in' then
        select s.* into sp
        from income_splits s
        where s.active
          and new.amount > s.base_amount
          and coalesce(new.counterparty, '') || ' ' || coalesce(new.description, '') ~* s.pattern
        order by length(s.pattern) desc
        limit 1;

        if found then
            extra := new.amount - sp.base_amount;
            insert into transactions (
                account_id, occurred_at, direction, amount, type, counterparty,
                description, source, raw_text, dedupe_hash, needs_review
            ) values (
                new.account_id, new.occurred_at, 'in', extra, sp.remainder_type, new.counterparty,
                coalesce(new.description, '') || ' [parte ' || sp.remainder_type || ']',
                new.source, new.raw_text, new.dedupe_hash || ':split', false
            );
            new.amount := sp.base_amount;
            new.type := 'income';
            new.category_id := null;
            new.matched_rule_id := null;
            new.needs_review := false;
        end if;
    end if;

    return new;
end;
$$;

-- monthly_budget: income/interest se asignan al mes de presupuesto segun income_cutoff_day.
create or replace view monthly_budget
with (security_invoker = true)
as
with bs as (
    select * from budget_split
),
tx as (
    select t.*,
           date_trunc('month', t.occurred_at at time zone 'America/Bogota') as real_month,
           date_trunc('month', t.occurred_at at time zone 'America/Bogota')
             + case when extract(day from t.occurred_at at time zone 'America/Bogota')
                         >= (select income_cutoff_day from bs)
                    then interval '1 month' else interval '0' end as budget_month
    from transactions t
),
months as (
    select real_month as month from tx
    union
    select budget_month from tx where type in ('income', 'interest')
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
    select case when type = 'interest' then budget_month else real_month end as month,
           sum(amount) filter (where type = 'sponsorship') as sponsorship_income,
           sum(amount) filter (where type = 'interest') as interest_income
    from tx where type in ('sponsorship', 'interest')
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
cross join bs
left join income_by_month i on i.month = m.month
left join spent_by_month_bucket sb on sb.month = m.month and sb.bucket = 'needs'
left join spent_by_month_bucket sw on sw.month = m.month and sw.bucket = 'wants'
left join savings_by_month sv on sv.month = m.month
left join unclassified_by_month u on u.month = m.month
left join extra_income_by_month e on e.month = m.month
order by m.month;

-- savings_progress: cuanto deberias haber enviado a ahorros (20% del ingreso base + intereses
-- + patrocinio), cuanto has enviado y cuanto falta, acumulado desde tracking_start.
create view savings_progress
with (security_invoker = true)
as
with per_month as (
    select month,
           savings_goal + interest_income + sponsorship_income as target,
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
