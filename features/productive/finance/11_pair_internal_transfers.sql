-- Emparejamiento automatico de transferencias entre cuentas propias.
-- Dos movimientos se emparejan si: cuentas distintas, sentidos opuestos, mismo valor exacto y
-- menos de 15 minutos de diferencia, y ambos son "candidatos" (sin clasificar o ya internos).
--   * Si alguno ya estaba CONFIRMADO como internal_transfer (p.ej. por la regla del nombre),
--     el otro tambien queda confirmado.
--   * Si ambos eran desconocidos, quedan como internal_transfer pero en Revision (sugerencia).

alter table transactions add column paired_with uuid references transactions(id) on delete set null;
create index transactions_paired_with_idx on transactions (paired_with);

create or replace function try_pair_transaction(n_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
    n transactions%rowtype;
    c transactions%rowtype;
    n_certain boolean;
    c_certain boolean;
    confirmed boolean;
begin
    select * into n from transactions where id = n_id;
    if not found or n.paired_with is not null or n.dedupe_hash like '%:split' then
        return;
    end if;
    if not (n.type = 'internal_transfer' or (n.needs_review and n.type in ('income', 'expense'))) then
        return;
    end if;

    select t.* into c
    from transactions t
    where t.id <> n.id
      and t.paired_with is null
      and t.account_id <> n.account_id
      and t.direction <> n.direction
      and t.amount = n.amount
      and abs(extract(epoch from (t.occurred_at - n.occurred_at))) <= 900
      and t.dedupe_hash not like '%:split'
      and (t.type = 'internal_transfer' or (t.needs_review and t.type in ('income', 'expense')))
    order by abs(extract(epoch from (t.occurred_at - n.occurred_at)))
    limit 1;
    if not found then
        return;
    end if;

    n_certain := n.type = 'internal_transfer' and not n.needs_review;
    c_certain := c.type = 'internal_transfer' and not c.needs_review;
    confirmed := n_certain or c_certain;

    update transactions
    set type = 'internal_transfer', paired_with = c.id, needs_review = not confirmed,
        category_id = case when n_certain then category_id else null end,
        matched_rule_id = case when n_certain then matched_rule_id else null end
    where id = n.id;

    update transactions
    set type = 'internal_transfer', paired_with = n.id, needs_review = not confirmed,
        category_id = case when c_certain then category_id else null end,
        matched_rule_id = case when c_certain then matched_rule_id else null end
    where id = c.id;
end;
$$;

create or replace function trg_pair_after_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    perform try_pair_transaction(new.id);
    return null;
end;
$$;

create trigger transactions_pair_after_insert
    after insert on transactions
    for each row
    execute function trg_pair_after_insert();

-- Si el usuario confirma una mitad como transferencia interna, se confirma la otra.
create or replace function trg_confirm_partner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if old.needs_review and not new.needs_review and new.type = 'internal_transfer' and new.paired_with is not null then
        update transactions
        set needs_review = false, type = 'internal_transfer', category_id = null
        where id = new.paired_with and needs_review;
    end if;
    return null;
end;
$$;

create trigger transactions_confirm_partner
    after update of needs_review on transactions
    for each row
    execute function trg_confirm_partner();

-- Empareja lo que ya existe.
do $$
declare
    r record;
begin
    for r in select id from transactions order by occurred_at loop
        perform try_pair_transaction(r.id);
    end loop;
end;
$$;
