-- Tasas de asignacion dinamicas ya viven en budget_split (needs/wants/savings_pct).
-- Aqui agregamos la meta global de ahorro: saldo base acumulado antes del
-- tracking, objetivo total (ej. fondo de emergencia) y sub-metas ordenadas.

alter table public.budget_split
  add column if not exists savings_baseline numeric(14,2) not null default 0,
  add column if not exists global_savings_target numeric(14,2) not null default 0,
  add column if not exists savings_goals jsonb not null default '[]'::jsonb;

-- realtime para que el resumen reaccione al editar porcentajes/metas
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'budget_split'
  ) then
    alter publication supabase_realtime add table public.budget_split;
  end if;
end $$;
