-- Deudas con "referencia": dentro de cada persona se agrupan por ref
-- (Mercado, Pet, Favor...). Se rellena desde la categoria de la tx ligada.

alter table public.debts add column if not exists ref text;

update public.debts d
set ref = c.name
from transactions t
join categories c on c.id = t.category_id
where d.tx_id = t.id
  and d.ref is null;
