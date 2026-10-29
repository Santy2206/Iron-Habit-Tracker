-- Recargas a cuentas propias ("Recargaste $10.000 en corresponsal Bancolombia"):
-- es plata que entra a la billetera desde efectivo/otra cuenta, no income.
-- Se marca internal_transfer directo (normalmente no llega la otra punta).
insert into rules (priority, direction, pattern, type, category_id, needs_review)
values (15, 'in', 'recargaste|corresponsal', 'internal_transfer', null, false);
