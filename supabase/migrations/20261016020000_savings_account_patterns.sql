-- Las cuentas de ahorro pueden absorber depositos trackeados por patron.
-- FNA: amount = saldo real a hoy (incluye los pagos ya registrados), por eso
-- since=2026-10-16: solo los depositos FNA NUEVOS se le suman, los viejos
-- quedan en "depositos sin cuenta" para no duplicarlos.
update public.budget_split set baseline_accounts = '[
  {"label": "FNA (Fondo Nacional del Ahorro)", "amount": 1800000, "pattern": "fondo nacional|fna", "since": "2026-10-16"},
  {"label": "Prestado a papa", "amount": 5500000},
  {"label": "Prestado a tio", "amount": 500000},
  {"label": "Nu (saldo previo al tracking)", "amount": 1340913, "pattern": "hym242|laura daniela marin"}
]'::jsonb
where id = true;
