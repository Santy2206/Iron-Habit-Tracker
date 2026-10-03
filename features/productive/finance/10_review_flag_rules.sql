-- Reglas que clasifican pero dejan el movimiento en la cola de Revision.
-- Caso: la notificacion de Nequi "el envio de plata por $X fue exitoso" no dice a quien se envio;
-- puede ser un gasto o un movimiento entre cuentas propias, asi que no se debe asumir "gusto".
alter table rules add column needs_review boolean not null default false;

insert into rules (priority, account_id, direction, pattern, type, category_id, needs_review)
select 60, a.id, 'out', 'env[ií]o de plata', 'expense', c.id, true
from accounts a, categories c
where a.name = 'Nequi' and c.name = 'Otros gustos';

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
        new.needs_review := matched.needs_review;
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
