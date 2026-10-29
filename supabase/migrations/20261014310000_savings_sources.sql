-- Fuentes de ahorro: prestamos, inversiones y ahorros voluntarios que
-- aportan al savings progress. No son income: su rendimiento entra como
-- 'interest' / 'debt_repayment' (in) o el aporte como 'savings' (out).

create table if not exists savings_sources (
    id               uuid primary key default gen_random_uuid(),
    name             text not null,
    kind             text not null default 'other'
                     check (kind in ('loan', 'investment', 'voluntary', 'other')),
    direction        text not null default 'in' check (direction in ('in', 'out')),
    principal        numeric(14,2) not null default 0,   -- capital puesto/prestado
    rate_pct         numeric(6,3),                        -- % mensual
    expected_monthly numeric(14,2) not null default 0,   -- rendimiento/aporte esperado
    pattern          text,                                -- regex para cruzar transacciones
    active           boolean not null default true,
    note             text,
    sort_order       smallint not null default 0,
    created_at       timestamptz not null default now()
);

alter table savings_sources enable row level security;

create policy savings_sources_authenticated_all on savings_sources
    for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.savings_sources to authenticated;

do $$ begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = 'savings_sources'
    ) then
        alter publication supabase_realtime add table public.savings_sources;
    end if;
end $$;

insert into savings_sources (name, kind, direction, principal, rate_pct, expected_monthly, pattern, sort_order) values
    ('Prestamo tio',               'loan',      'in',  500000, 5, 20000,  null,                          1),
    ('FNA ahorro voluntario',      'voluntary', 'out', 0,      null, 200000, 'fondo nacional del ahorro', 2);
