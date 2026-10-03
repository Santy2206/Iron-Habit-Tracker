-- Reglas de comercios segun el titular (limite de palabra en Postgres = \y).

-- Categoria generica para gustos que no encajan en otra.
insert into categories (name, bucket) values ('Otros gustos', 'wants');

-- Necesidades (comida/mercado): Ara, Dollarcity, D' Foretti, D1, Ísimo y todo "Mercado".
-- Se excluye Mercadopago y Mercado Libre (pasarela de pago / compras), que no son mercado.
insert into rules (priority, direction, pattern, type, category_id)
select 50, 'out',
       'tiendas ara|jeronimo martins|dollarcity|foretti|tiendas d1|\ys\s*isimo\y|\yisimo\y|mercado(?!\s*(pago|libre))',
       'expense', id
from categories where name = 'Mercado';

-- Accival (fondo de inversion) no es ahorro: es gusto.
insert into rules (priority, direction, pattern, type, category_id)
select 50, 'out', 'accival|fondo de inversi[oó]n colectiva', 'expense', id
from categories where name = 'Otros gustos';

-- Por defecto, toda compra de RappiCard es gusto (las de necesidades ganan por prioridad 50).
insert into rules (priority, account_id, direction, pattern, type, category_id)
select 90, a.id, 'out', '.', 'expense', c.id
from accounts a, categories c
where a.name = 'RappiCard' and c.name = 'Otros gustos';
