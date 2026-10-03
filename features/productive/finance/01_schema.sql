-- Finance Tracker personal — esquema inicial
-- Montos siempre positivos; el sentido (in/out) va aparte.
-- Meses se calculan en hora de Bogota (America/Bogota).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
create table accounts (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,                 -- Bancolombia, Nequi, RappiCard, Nu
    role        text not null check (role in ('operating', 'credit', 'savings')),
    created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table categories (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    bucket      text not null check (bucket in ('needs', 'wants', 'savings', 'none')),
    created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- budget_split — una sola fila con los porcentajes 50/30/20
-- ---------------------------------------------------------------------------
create table budget_split (
    id              boolean primary key default true check (id),  -- fuerza fila unica
    needs_pct       numeric(5,2) not null default 50.00,
    wants_pct       numeric(5,2) not null default 30.00,
    savings_pct     numeric(5,2) not null default 20.00,
    updated_at      timestamptz not null default now(),
    constraint budget_split_sums_to_100
        check (needs_pct + wants_pct + savings_pct = 100.00)
);

insert into budget_split (id) values (true);

-- ---------------------------------------------------------------------------
-- rules — motor de clasificacion, gana la menor prioridad que matchee
-- ---------------------------------------------------------------------------
create table rules (
    id              uuid primary key default gen_random_uuid(),
    priority        int not null,
    account_id      uuid references accounts(id),      -- null = cualquier cuenta
    direction       text check (direction in ('in', 'out')),  -- null = cualquiera
    pattern         text not null,                       -- regex sobre comercio/descripcion
    type            text not null check (type in (
                        'income', 'expense', 'savings', 'savings_withdrawal',
                        'internal_transfer', 'card_payment'
                    )),
    category_id     uuid references categories(id),      -- null si el tipo no aplica categoria
    active          boolean not null default true,
    created_at      timestamptz not null default now()
);

create index rules_priority_idx on rules (priority) where active;

-- ---------------------------------------------------------------------------
-- transactions — tabla central donde convergen todas las fuentes
-- ---------------------------------------------------------------------------
create table transactions (
    id                  uuid primary key default gen_random_uuid(),
    account_id          uuid not null references accounts(id),
    occurred_at         timestamptz not null,
    direction           text not null check (direction in ('in', 'out')),
    amount              numeric(14,2) not null check (amount > 0),
    type                text check (type in (
                            'income', 'expense', 'savings', 'savings_withdrawal',
                            'internal_transfer', 'card_payment'
                        )),
    category_id         uuid references categories(id),
    counterparty         text,
    description          text,
    source               text not null check (source in ('email', 'notification', 'statement', 'manual')),
    raw_text             text,
    dedupe_hash          text not null unique,
    needs_review         boolean not null default false,
    matched_rule_id      uuid references rules(id),
    created_at           timestamptz not null default now()
);

create index transactions_occurred_at_idx on transactions (occurred_at);
create index transactions_account_idx on transactions (account_id);
create index transactions_needs_review_idx on transactions (needs_review) where needs_review;

-- ---------------------------------------------------------------------------
-- apply_rules() — trigger before insert: aplica la primera regla que matchee
-- ---------------------------------------------------------------------------
create or replace function apply_rules()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
    matched rules%rowtype;
begin
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

    return new;
end;
$$;

create trigger transactions_apply_rules
    before insert on transactions
    for each row
    execute function apply_rules();

-- ---------------------------------------------------------------------------
-- monthly_budget — vista: ingreso, meta, gastado/ahorrado y disponible por bolsa
-- ---------------------------------------------------------------------------
create view monthly_budget
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
    coalesce(u.unclassified_expense, 0)                            as unclassified_expense
from months m
cross join budget_split bs
left join income_by_month i on i.month = m.month
left join spent_by_month_bucket sb on sb.month = m.month and sb.bucket = 'needs'
left join spent_by_month_bucket sw on sw.month = m.month and sw.bucket = 'wants'
left join savings_by_month sv on sv.month = m.month
left join unclassified_by_month u on u.month = m.month
order by m.month;

-- ---------------------------------------------------------------------------
-- RLS — activo solo para usuarios autenticados, registro publico deshabilitado
-- ---------------------------------------------------------------------------
alter table accounts enable row level security;
alter table categories enable row level security;
alter table budget_split enable row level security;
alter table rules enable row level security;
alter table transactions enable row level security;

create policy accounts_authenticated_all on accounts
    for all to authenticated using (true) with check (true);
create policy categories_authenticated_all on categories
    for all to authenticated using (true) with check (true);
create policy budget_split_authenticated_all on budget_split
    for all to authenticated using (true) with check (true);
create policy rules_authenticated_all on rules
    for all to authenticated using (true) with check (true);
create policy transactions_authenticated_all on transactions
    for all to authenticated using (true) with check (true);
