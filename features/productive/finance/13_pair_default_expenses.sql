-- El emparejamiento tambien debe considerar gastos que cayeron en la regla por defecto
-- (prioridad 99: "todo gasto desconocido es gusto"): en la practica estan sin clasificar.
create or replace function is_pair_candidate(t transactions)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
    select t.type = 'internal_transfer'
        or (t.needs_review and t.type in ('income', 'expense'))
        or (t.type = 'expense' and t.matched_rule_id in (select id from rules where priority = 99));
$$;

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
    if not is_pair_candidate(n) then
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
      and is_pair_candidate(t)
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
