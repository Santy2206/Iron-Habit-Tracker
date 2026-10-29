-- Deudas/favores: plata que adelanto a alguien (pass_through) y que me deben,
-- o que yo debo. No son income ni expense: solo seguimiento.
--   * tx_id        -> movimiento que origino la deuda (o el repago que yo hice)
--   * repaid_tx_id -> movimiento con el que se saldo
create table if not exists debts (
    id           uuid primary key default gen_random_uuid(),
    created_at   timestamptz not null default now(),
    counterparty text not null,
    direction    text not null default 'owed_to_me'
                 check (direction in ('owed_to_me', 'i_owe')),
    amount       numeric(14,2) not null,
    tx_id        uuid references transactions(id) on delete set null,
    repaid_tx_id uuid references transactions(id) on delete set null,
    status       text not null default 'open'
                 check (status in ('open', 'settled', 'cancelled')),
    settled_at   timestamptz,
    note         text
);

create index if not exists debts_status_idx on debts (status);

alter table debts enable row level security;

create policy debts_authenticated_all on debts
    for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.debts to authenticated;

do $$ begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = 'debts'
    ) then
        alter publication supabase_realtime add table public.debts;
    end if;
end $$;
