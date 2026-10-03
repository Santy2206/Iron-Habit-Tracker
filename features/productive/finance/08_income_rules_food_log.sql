-- NOTA: datos personales reemplazados por <MARCADORES>; los valores reales viven solo en la base de datos (rules / income_splits).
-- Ajustes de ingresos fijos, deudas por cobrar, categoria "Other" y registro de comida.

-- Sin corte: un pago del dia 30 cuenta para ese mismo mes (mes calendario).
alter table budget_split alter column income_cutoff_day drop not null;
update budget_split set income_cutoff_day = null;

-- Nuevo tipo: dinero que te devuelven (deudas por cobrar). Va a ahorros.
alter table transactions drop constraint transactions_type_check;
alter table transactions add constraint transactions_type_check check (type in (
    'income', 'expense', 'savings', 'savings_withdrawal',
    'internal_transfer', 'card_payment', 'sponsorship', 'interest', 'debt_repayment'
));
alter table rules drop constraint rules_type_check;
alter table rules add constraint rules_type_check check (type in (
    'income', 'expense', 'savings', 'savings_withdrawal',
    'internal_transfer', 'card_payment', 'sponsorship', 'interest', 'debt_repayment'
));
alter table income_splits drop constraint income_splits_remainder_type_check;
alter table income_splits add constraint income_splits_remainder_type_check
    check (remainder_type in ('interest', 'sponsorship', 'debt_repayment'));
alter table income_splits add column base_type text not null default 'income'
    check (base_type in ('income', 'interest', 'sponsorship', 'debt_repayment'));

-- Categorias de ingreso (sin bolsa).
insert into categories (name, bucket) values ('Mesada', 'none'), ('Freelance', 'none'), ('Other', 'none');

-- Efectivo: para compras de comida anotadas desde el celular.
insert into accounts (name, role) values ('Efectivo', 'operating');

-- Padre (<NOMBRE_PADRE> / <CELULAR_PADRE>): 500.000 mesada = ingreso, el resto (275.000) = intereses.
update income_splits
set pattern = '<NOMBRE_PADRE>|<CELULAR_PADRE>', base_amount = 500000
where name = 'Padre';
update rules
set pattern = '<NOMBRE_PADRE>|<CELULAR_PADRE>',
    category_id = (select id from categories where name = 'Mesada')
where priority = 20 and type = 'income' and pattern = '<CELULAR_PADRE>';

-- Tio (<NOMBRE_TIO>): 20.000 mensuales = intereses; lo que pase de eso = devolucion de deuda.
insert into income_splits (name, pattern, base_amount, base_type, remainder_type)
values ('Tio', '<NOMBRE_TIO>', 20000, 'interest', 'debt_repayment');
insert into rules (priority, direction, pattern, type)
values (20, 'in', '<NOMBRE_TIO>', 'interest');

-- Comida pagada en efectivo desde la app movil = gasto de Mercado (necesidad).
insert into rules (priority, account_id, direction, pattern, type, category_id)
select 40, a.id, 'out', 'comida:', 'expense', c.id
from accounts a, categories c
where a.name = 'Efectivo' and c.name = 'Mercado';

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
        if new.direction = 'in' then
            select id into new.category_id from categories where name = 'Other';
        end if;
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
            new.type := sp.base_type;
            if sp.base_type <> 'income' then
                new.category_id := null;
            end if;
            new.matched_rule_id := null;
            new.needs_review := false;
        end if;
    end if;

    return new;
end;
$$;

-- Entradas pendientes que quedaron sin categoria: "Other".
update transactions
set category_id = (select id from categories where name = 'Other')
where direction = 'in' and type = 'income' and needs_review and category_id is null;

-- monthly_budget: agrega debt_repayment_income; savings_progress lo suma a la meta.
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
           sum(amount) filter (where type = 'interest') as interest_income,
           sum(amount) filter (where type = 'debt_repayment') as debt_repayment_income
    from tx where type in ('sponsorship', 'interest', 'debt_repayment')
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
    coalesce(e.debt_repayment_income, 0)                           as debt_repayment_income
from months m
cross join bs
left join income_by_month i on i.month = m.month
left join spent_by_month_bucket sb on sb.month = m.month and sb.bucket = 'needs'
left join spent_by_month_bucket sw on sw.month = m.month and sw.bucket = 'wants'
left join savings_by_month sv on sv.month = m.month
left join unclassified_by_month u on u.month = m.month
left join extra_income_by_month e on e.month = m.month
order by m.month;

create or replace view savings_progress
with (security_invoker = true)
as
with per_month as (
    select month,
           savings_goal + interest_income + sponsorship_income + debt_repayment_income as target,
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

-- Registro de comida (reemplaza el checklist de Notion): catalogo + compras por mes.
create table food_items (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    group_name  text not null,
    sort_order  int not null default 0,
    active      boolean not null default true,
    created_at  timestamptz not null default now()
);
create table food_purchases (
    id              uuid primary key default gen_random_uuid(),
    item_id         uuid not null references food_items(id) on delete cascade,
    purchased_at    date not null default current_date,
    amount          numeric(14,2) not null check (amount > 0),
    expression      text,
    note            text,
    paid_cash       boolean not null default false,
    transaction_id  uuid references transactions(id) on delete set null,
    created_at      timestamptz not null default now()
);
create index food_purchases_date_idx on food_purchases (purchased_at);
alter table food_items enable row level security;
alter table food_purchases enable row level security;
create policy food_items_authenticated_all on food_items
    for all to authenticated using (true) with check (true);
create policy food_purchases_authenticated_all on food_purchases
    for all to authenticated using (true) with check (true);

insert into food_items (name, group_name, sort_order) values
    ('Blackberry', 'Carbs', 1), ('Cinnamon', 'Carbs', 2), ('Kiwis', 'Carbs', 3), ('Oats', 'Carbs', 4),
    ('Orange', 'Carbs', 5), ('Spaghetti', 'Carbs', 6), ('Papaya', 'Carbs', 7), ('Dough', 'Carbs', 8),
    ('Banana', 'Carbs', 9), ('Pumpkin', 'Carbs', 10), ('Onion', 'Carbs', 11), ('Spinach', 'Carbs', 12),
    ('Cheese de la cuesta', 'Eggs and Dairy', 1), ('Kefir', 'Eggs and Dairy', 2),
    ('Eggs', 'Eggs and Dairy', 3), ('Greek yogurt', 'Eggs and Dairy', 4),
    ('Almonds', 'Nuts and seeds (Fats)', 1), ('Avocado', 'Nuts and seeds (Fats)', 2),
    ('Peanuts', 'Nuts and seeds (Fats)', 3), ('Flaxseed', 'Nuts and seeds (Fats)', 4),
    ('Sunflower seeds', 'Nuts and seeds (Fats)', 5),
    ('Trout', 'Protein', 1), ('Chicken Breast', 'Protein', 2), ('Beef (2 lb)', 'Protein', 3);

-- Compras de septiembre que ya tenias anotadas en Notion (sin dia exacto: se usa el 1).
insert into food_purchases (item_id, purchased_at, amount, expression, note, paid_cash)
select i.id, date '2026-09-01', v.amount, v.expr, 'importado de Notion (septiembre)', false
from food_items i
join (values ('Eggs', 5200, '5200'), ('Eggs', 2600, '2600'), ('Eggs', 13500, '13500'), ('Eggs', 5200, '5200'),
             ('Chicken Breast', 11500, '11.500')) as v(name, amount, expr) on v.name = i.name;
