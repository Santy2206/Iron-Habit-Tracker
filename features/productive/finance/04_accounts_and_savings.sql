-- NOTA: datos personales reemplazados por <MARCADORES>; los valores reales viven solo en la base de datos (rules / income_splits).
-- Aclaraciones del titular sobre cuentas y ahorro.

-- Dia de corte del extracto (RappiCard: 20 de cada mes). Aun no lo usa el dashboard.
alter table accounts add column if not exists statement_day smallint
    check (statement_day between 1 and 31);
update accounts set statement_day = 20 where name = 'RappiCard';

-- Fondo Nacional del Ahorro: cada pago es un envio a ahorro.
insert into rules (priority, direction, pattern, type)
values (10, 'out', 'fondo nacional del ahorro', 'savings');

-- La cuenta de ahorro (llave <LLAVE_AHORRO>) es de la pareja, con una boveda para el titular,
-- y ella NO le devuelve ahorro por ese medio. Por eso una entrada desde Nubank no es
-- un retiro de ahorro: se desactiva esa regla y esos movimientos quedan por revisar.
update rules set active = false where priority = 10 and type = 'savings_withdrawal';

update transactions
set type = 'income', category_id = null, matched_rule_id = null, needs_review = true
where type = 'savings_withdrawal';
