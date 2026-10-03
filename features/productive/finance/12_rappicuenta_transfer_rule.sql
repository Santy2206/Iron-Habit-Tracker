-- Transferencias de RappiCuenta por Bre-B: la notificacion ("The $16.448,00 transfer via Bre-B was
-- successful...") no dice el destinatario, asi que quedan en Revision (o se emparejan solas con la
-- entrada en la otra cuenta, ver 11_pair_internal_transfers.sql).
insert into rules (priority, account_id, direction, pattern, type, category_id, needs_review)
select 60, a.id, 'out', 'transfer via bre-?b', 'expense', c.id, true
from accounts a, categories c
where a.name = 'RappiCuenta' and c.name = 'Otros gustos';
