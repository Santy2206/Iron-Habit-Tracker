-- NOTA: datos personales reemplazados por <MARCADORES>; los valores reales viven solo en la base de datos (rules / income_splits).
-- Ajustes de reglas tras ver correos reales de Bancolombia y Nequi.

-- CORRECCION: en las regex de PostgreSQL `\b` es "backspace", no limite de palabra
-- (el limite de palabra es `\y`). Las reglas sembradas con `\b` nunca coincidian.
update rules set pattern = replace(pattern, '\b', '\y') where position('\b' in pattern) > 0;
-- Typo del seed: "%26" en vez de "&" en Justo & Bueno.
update rules set pattern = replace(pattern, '%26', '&') where position('%26' in pattern) > 0;

-- 15: transferencias entre cuentas propias — nombre del titular o numero de Nequi propio.
update rules
set pattern = '<TITULAR_NOMBRE>|<NEQUI_PROPIO>'
where priority = 15 and type = 'internal_transfer';

-- 10: Nu/Nubank. "Nubank" no matcheaba con \bnu\b.
update rules
set pattern = '\ynu\y|nu colombia|nu bank|nubank'
where priority = 10 and type in ('savings', 'savings_withdrawal');

-- 10: llave Bre-B de la cuenta de ahorros exclusiva (<LLAVE_AHORRO>) = envio a ahorro.
insert into rules (priority, direction, pattern, type)
values (10, 'out', '<LLAVE_AHORRO>', 'savings');

-- 50: telecomunicaciones (ETB) -> Servicios.
insert into rules (priority, direction, pattern, type, category_id)
select 50, 'out', 'telecomunicaciones de bogota|\metb\M', 'expense', id
from categories where name = 'Servicios';

-- Re-aplica las reglas a los movimientos aun pendientes de revision (needs_review),
-- sin tocar los que ya se clasificaron a mano. Util despues de ajustar reglas.
create or replace function reapply_rules()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
    updated integer;
begin
    update transactions t
    set type = r.type,
        category_id = r.category_id,
        matched_rule_id = r.id,
        needs_review = false
    from (
        select t2.id as tid,
               (select r2.id
                from rules r2
                where r2.active
                  and (r2.account_id is null or r2.account_id = t2.account_id)
                  and (r2.direction is null or r2.direction = t2.direction)
                  and coalesce(t2.counterparty, '') || ' ' || coalesce(t2.description, '') ~* r2.pattern
                order by r2.priority
                limit 1) as rid
        from transactions t2
        where t2.needs_review
    ) m
    join rules r on r.id = m.rid
    where t.id = m.tid;

    get diagnostics updated = row_count;
    return updated;
end;
$$;
