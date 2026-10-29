-- Los compromisos marcados como ahorro (p.ej. FNA) se descuentan del envio pendiente a la cuenta de ahorro.
alter table monthly_commitments add column if not exists counts_as_savings boolean not null default false;
update monthly_commitments set counts_as_savings = true where name = 'FNA voluntary savings';
