-- NOTA: datos personales reemplazados por <MARCADORES>; los valores reales viven solo en la base de datos (rules / income_splits).
-- Finance Tracker personal — datos base
-- Ejecutar despues de 01_schema.sql (y luego 03_rules_update.sql)
--
-- OJO con las regex: en PostgreSQL `\b` es "backspace", no limite de palabra.
-- El limite de palabra es `\y` (o `\m` inicio / `\M` fin).

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
insert into accounts (name, role) values
    ('Bancolombia', 'operating'),
    ('Nequi',       'operating'),
    ('RappiCard',   'credit'),
    ('Nu',          'savings');

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
insert into categories (name, bucket) values
    ('Vivienda',                 'needs'),
    ('Servicios',                'needs'),
    ('Mercado',                  'needs'),
    ('Transporte',               'needs'),
    ('Salud',                    'needs'),
    ('Educacion',                'needs'),
    ('Restaurantes y domicilios','wants'),
    ('Suscripciones',            'wants'),
    ('Entretenimiento',          'wants'),
    ('Compras',                  'wants'),
    ('Ahorro',                   'savings');

-- ---------------------------------------------------------------------------
-- rules
-- ---------------------------------------------------------------------------

-- 5: RappiCard — cualquier entrada en la cuenta RappiCard, o salida que
-- mencione la tarjeta, es pago/consumo de tarjeta de credito.
insert into rules (priority, account_id, direction, pattern, type)
select 5, id, 'in', '.', 'card_payment'
from accounts where name = 'RappiCard';

insert into rules (priority, direction, pattern, type)
values (5, 'out', '\ytarjeta\y.*rappi|rappicard', 'card_payment');

-- 10: Nu — salida hacia Nu = ahorro; entrada desde Nu = retiro de ahorro.
insert into rules (priority, direction, pattern, type)
values
    (10, 'out', '\ynu\y|nu colombia|nu bank', 'savings'),
    (10, 'in',  '\ynu\y|nu colombia|nu bank', 'savings_withdrawal');

-- 15: transferencias entre cuentas propias (nombre completo del titular).
insert into rules (priority, direction, pattern, type, active)
values (15, null, '<TITULAR_NOMBRE>', 'internal_transfer', true);

-- 20: ingresos — nomina/salario/pagador conocido.
insert into rules (priority, direction, pattern, type)
values (20, 'in', 'nomina|salario|pago\s*n[oó]mina', 'income');

-- 50: comercios conocidos -> expense + categoria.
insert into rules (priority, direction, pattern, type, category_id)
select 50, 'out', 'rappi(?!card)', 'expense', id from categories where name = 'Restaurantes y domicilios'
union all
select 50, 'out', '\y(exito|d1|ara|olimpica|justo\s*&\s*bueno|jumbo)\y', 'expense', id from categories where name = 'Mercado'
union all
select 50, 'out', '\yuber\y|\ydidi\y|\ycabify\y', 'expense', id from categories where name = 'Transporte'
union all
select 50, 'out', '\yenel\y|\yepm\y|\yclaro\y|\ymovistar\y|\ytigo\y|acueducto', 'expense', id from categories where name = 'Servicios'
union all
select 50, 'out', 'netflix|spotify|disney|hbo|amazon\s*prime|youtube\s*premium', 'expense', id from categories where name = 'Suscripciones';
