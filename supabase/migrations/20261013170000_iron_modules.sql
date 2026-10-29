-- IRON modules migration: Physical (weight/diet) + Intellectual (flashcards)
-- Finance tables already exist in the project (created by the Python app's
-- own migrations) and already have authenticated RLS policies.

-- ─── Weight entries (source of truth; weekly averages are computed client-side) ──
create table if not exists public.weight_entries (
  user_id    uuid not null references auth.users (id) on delete cascade,
  entry_date date not null,
  weight_lb  numeric(6,2) not null check (weight_lb > 0),
  source     text not null default 'manual',  -- 'manual' | 'gfit'
  created_at timestamptz not null default now(),
  primary key (user_id, entry_date)
);

-- ─── Diet targets (single row per user) ───────────────────────────────────────
create table if not exists public.diet_settings (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  phase           text not null default 'cut' check (phase in ('cut', 'bulk')),
  calorie_intake  numeric(7,1) not null default 2300,
  protein_g       numeric(6,1) not null default 215,
  carbs_g         numeric(6,1) not null default 149,
  fat_g           numeric(6,1) not null default 94,
  protein_per_lb  numeric(4,2) not null default 1.15,
  updated_at      timestamptz not null default now()
);

-- ─── Diet change history (drives "pending reevaluation" + trend attribution) ──
create table if not exists public.diet_history (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  changed_on     date not null default current_date,
  phase          text not null,
  calorie_intake numeric(7,1) not null,
  protein_g      numeric(6,1) not null,
  carbs_g        numeric(6,1) not null,
  fat_g          numeric(6,1) not null,
  created_at     timestamptz not null default now()
);

-- ─── Flashcards (SM-2 lite) ───────────────────────────────────────────────────
create table if not exists public.flashcards (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  deck          text not null default 'General',
  front         text not null,
  back          text not null,
  next_review   date not null default current_date,
  interval_days int not null default 0,
  ease          numeric(4,2) not null default 2.5,
  reps          int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists flashcards_due on public.flashcards (user_id, next_review);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.weight_entries enable row level security;
alter table public.diet_settings  enable row level security;
alter table public.diet_history   enable row level security;
alter table public.flashcards     enable row level security;

drop policy if exists own_weight on public.weight_entries;
create policy own_weight on public.weight_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_diet_settings on public.diet_settings;
create policy own_diet_settings on public.diet_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_diet_history on public.diet_history;
create policy own_diet_history on public.diet_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_flashcards on public.flashcards;
create policy own_flashcards on public.flashcards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── Realtime ────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.weight_entries;
alter publication supabase_realtime add table public.diet_settings;
alter publication supabase_realtime add table public.diet_history;
alter publication supabase_realtime add table public.flashcards;
