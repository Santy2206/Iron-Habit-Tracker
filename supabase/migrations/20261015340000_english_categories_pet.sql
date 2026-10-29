-- Categorias en ingles + nueva "Pet" en needs (gastos de mascota: la mitad es
-- mia, la otra mitad la pone Daniela -> se trackea en debts).
update categories set name = 'Education'               where name = 'Educacion';
update categories set name = 'Groceries'               where name = 'Mercado';
update categories set name = 'Health'                  where name = 'Salud';
update categories set name = 'Utilities'               where name = 'Servicios';
update categories set name = 'Transport'               where name = 'Transporte';
update categories set name = 'Housing'                 where name = 'Vivienda';
update categories set name = 'Allowance'               where name = 'Mesada';
update categories set name = 'Savings'                 where name = 'Ahorro';
update categories set name = 'Shopping'                where name = 'Compras';
update categories set name = 'Entertainment'           where name = 'Entretenimiento';
update categories set name = 'Other wants'             where name = 'Otros gustos';
update categories set name = 'Restaurants & delivery'  where name = 'Restaurantes y domicilios';
update categories set name = 'Subscriptions'           where name = 'Suscripciones';

insert into categories (name, bucket)
select 'Pet', 'needs'
where not exists (select 1 from categories where name = 'Pet');
