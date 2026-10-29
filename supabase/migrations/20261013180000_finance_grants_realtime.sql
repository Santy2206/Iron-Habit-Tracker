-- Finance views need explicit SELECT grants for the `authenticated` role —
-- the Python app connects with the service key which bypasses grants, but the
-- web app queries them as the logged-in user.

grant select on public.monthly_budget to authenticated;
grant select on public.savings_progress to authenticated;

-- Live updates for the Finance module (transactions / food) — safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'food_purchases'
  ) then
    alter publication supabase_realtime add table public.food_purchases;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'food_items'
  ) then
    alter publication supabase_realtime add table public.food_items;
  end if;
end $$;
