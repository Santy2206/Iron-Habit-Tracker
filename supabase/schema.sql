-- IRON Habit Tracker — Supabase schema
-- Run this in Supabase Dashboard -> SQL Editor

create extension if not exists "pgcrypto";

create type capital_category as enum
  ('productive', 'intellectual', 'social', 'spiritual', 'physical');

-- ─── Calendar events (time blocks) ────────────────────────────────────────────
create table public.events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  description   text,
  category      capital_category not null default 'productive',
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  all_day       boolean not null default false,
  gcal_event_id text unique,
  source        text not null default 'local',          -- 'local' | 'gcal'
  task_id       uuid,
  synced_at     timestamptz,
  deleted       boolean not null default false,          -- soft-delete pending gcal push
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─── Kanban tasks (work / projects) ───────────────────────────────────────────
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  description text,
  status      text not null default 'backlog',          -- backlog|todo|in_progress|review|done
  priority    text not null default 'medium',           -- low|medium|high|urgent
  category    capital_category,
  labels      text[] not null default '{}',
  subtasks    jsonb not null default '[]',              -- [{id,title,done}]
  due_date    date,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.events
  add constraint events_task_fk foreign key (task_id)
  references public.tasks (id) on delete set null;

-- ─── Personal to-do list ──────────────────────────────────────────────────────
create table public.todos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  done       boolean not null default false,
  urgent     boolean not null default false,
  due_date   date,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

-- ─── Google OAuth tokens (server-side only, no client read) ──────────────────
create table public.google_tokens (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);

-- ─── Google Calendar incremental sync state ───────────────────────────────────
create table public.gcal_sync (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  sync_token          text,
  channel_resource_id text,
  channel_expiration  timestamptz,
  last_synced_at      timestamptz
);

-- ─── Row Level Security ───────────────────────────────────────────────────────
alter table public.events        enable row level security;
alter table public.tasks         enable row level security;
alter table public.todos         enable row level security;
alter table public.google_tokens enable row level security;
alter table public.gcal_sync     enable row level security;

create policy "own events"  on public.events  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tasks"   on public.tasks   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own todos"   on public.todos   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own sync"    on public.gcal_sync for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- google_tokens: intentionally no policy -> only service_role can read/write tokens.

create index events_user_time   on public.events (user_id, start_at);
create index events_gcal        on public.events (gcal_event_id);
create index tasks_user_status  on public.tasks (user_id, status, position);
create index todos_user         on public.todos (user_id, done, position);

-- Realtime: enable postgres changes so phone + PC update live
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.todos;

-- updated_at trigger
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();
