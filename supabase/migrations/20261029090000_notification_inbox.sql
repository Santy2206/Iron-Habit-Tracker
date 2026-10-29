begin;

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','transactions','rules','income_splits','food_items','food_purchases','debts','monthly_commitments','savings_sources','budget_split','unparsed_notifications'] loop
    execute format('alter table public.%I add column user_id uuid references auth.users(id)', t);
    execute format('alter table public.%I alter column user_id set default auth.uid()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select,insert,update,delete on public.%I to authenticated', t);
    execute format('create policy finance_owner_guard on public.%I as restrictive to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create index on public.%I(user_id)', t);
  end loop;
end $$;

revoke all on public.app_secrets from anon, authenticated;

alter table public.accounts drop constraint accounts_name_key;
alter table public.accounts add unique(user_id, name);
alter table public.categories drop constraint categories_name_key;
alter table public.categories add unique(user_id, name);
alter table public.food_items drop constraint food_items_name_key;
alter table public.food_items add unique(user_id, name);
alter table public.budget_split drop constraint budget_split_pkey;
alter table public.budget_split add column row_id uuid not null default gen_random_uuid() primary key;
alter table public.budget_split add unique(user_id, id);

create table public.notification_capturers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  secret_hash text not null unique check (secret_hash ~ '^[a-f0-9]{64}$'),
  label text not null check (length(label) between 1 and 80),
  allowed_sources text[] not null default array['Bancolombia','Nequi','RappiCard','RappiCuenta'],
  enabled boolean not null default true
);
alter table public.notification_capturers enable row level security;
revoke all on public.notification_capturers from anon, authenticated;
grant all on public.notification_capturers to service_role;

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  capturer_id uuid not null references public.notification_capturers(id),
  event_id text not null check (length(event_id) between 1 and 128),
  source text not null check (length(source) between 1 and 80),
  product text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  raw_text text check (octet_length(raw_text) <= 8192),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'received' check (status in ('received','processed','pending_review','ignored','error')),
  reason text,
  parser_version text,
  transaction_id uuid references public.transactions(id),
  unique(capturer_id, event_id)
);
alter table public.notification_events enable row level security;
create policy own_notification_events on public.notification_events for select to authenticated using (user_id = auth.uid());
revoke all on public.notification_events from anon, authenticated;
grant select on public.notification_events to authenticated;
grant all on public.notification_events to service_role;
create index on public.notification_events(user_id, source, received_at desc);
create view public.notification_source_status with (security_invoker = true) as
  select distinct on (user_id, source) id,user_id,source,received_at,occurred_at,status,reason,transaction_id
  from public.notification_events order by user_id,source,received_at desc,id desc;
revoke all on public.notification_source_status from anon, authenticated;
grant select on public.notification_source_status to authenticated;
alter table public.transactions add column notification_event_id uuid unique references public.notification_events(id);

create function public.guard_finance_references() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare fk record; referenced_owner uuid; v jsonb := to_jsonb(new);
begin
  if current_user in ('postgres','service_role') and current_setting('iron.assign_owner', true) = 'on' then return new; end if;
  if new.user_id is null then raise exception 'Finance owner required'; end if;
  for fk in
    select c.confrelid::regclass as target, a.attname as local_key, b.attname as remote_key
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute b on b.attrelid = c.confrelid and b.attnum = c.confkey[1]
    where c.contype = 'f' and c.conrelid = tg_relid and array_length(c.conkey,1) = 1
      and exists(select 1 from pg_attribute x where x.attrelid = c.confrelid and x.attname = 'user_id' and not x.attisdropped)
  loop
    if v ->> fk.local_key is not null then
      execute format('select user_id from %s where %I::text = $1', fk.target, fk.remote_key) into referenced_owner using v ->> fk.local_key;
      if referenced_owner is distinct from new.user_id then raise exception 'Cross-owner finance reference'; end if;
    end if;
  end loop;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','transactions','rules','income_splits','food_items','food_purchases','debts','monthly_commitments','savings_sources','budget_split','unparsed_notifications'] loop
    execute format('create trigger zz_guard_finance_references before insert or update on public.%I for each row execute function public.guard_finance_references()', t);
  end loop;
end $$;

create function public.assign_legacy_finance_owner(owner_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t text;
begin
  if not exists(select 1 from auth.users where id = owner_id) then raise exception 'Unknown owner'; end if;
  perform set_config('iron.assign_owner', 'on', true);
  foreach t in array array['accounts','categories','transactions','rules','income_splits','food_items','food_purchases','debts','monthly_commitments','savings_sources','budget_split','unparsed_notifications'] loop
    execute format('update public.%I set user_id = $1 where user_id is null', t) using owner_id;
  end loop;
  perform set_config('iron.assign_owner', 'off', true);
end $$;
revoke all on function public.assign_legacy_finance_owner(uuid) from public, anon, authenticated;
grant execute on function public.assign_legacy_finance_owner(uuid) to service_role;

create function public.receive_notification(p_capturer uuid, p_event_id text, p_source text, p_occurred_at timestamptz, p_text text, p_hash text, p_sensitive boolean)
returns public.notification_events language plpgsql security definer set search_path = public, pg_temp as $$
declare c notification_capturers%rowtype; e notification_events%rowtype;
begin
  select * into c from notification_capturers where id = p_capturer and enabled;
  if not found or not (p_source = any(c.allowed_sources)) then raise exception 'Unauthorized source'; end if;
  insert into notification_events(user_id,capturer_id,event_id,source,occurred_at,raw_text,payload_hash,status,reason)
    values(c.user_id,c.id,p_event_id,p_source,p_occurred_at,case when p_sensitive then null else p_text end,p_hash,
      case when p_sensitive then 'ignored' else 'received' end,case when p_sensitive then 'sensitive' end)
    on conflict(capturer_id,event_id) do nothing;
  select * into e from notification_events where capturer_id = c.id and event_id = p_event_id;
  if e.payload_hash <> p_hash then raise exception 'Event identity conflict' using errcode = '22000'; end if;
  return e;
end $$;
revoke all on function public.receive_notification(uuid,text,text,timestamptz,text,text,boolean) from public,anon,authenticated;
grant execute on function public.receive_notification(uuid,text,text,timestamptz,text,text,boolean) to service_role;

create function public.finish_notification(p_id uuid, p_owner uuid, p_status text, p_reason text, p_product text default null, p_amount numeric default null, p_direction text default null, p_counterparty text default null)
returns public.notification_events language plpgsql security definer set search_path = public, pg_temp as $$
declare e notification_events%rowtype; a accounts%rowtype; tx uuid;
begin
  select * into e from notification_events where id = p_id and user_id = p_owner for update;
  if not found then raise exception 'Unknown event'; end if;
  if e.transaction_id is not null or e.status in ('processed','ignored') then return e; end if;
  if p_status not in ('pending_review','ignored','error','processed') then raise exception 'Invalid status'; end if;
  if p_status = 'processed' then
    select * into a from accounts where user_id = p_owner and name = p_product;
    if not found then
      p_status := 'pending_review'; p_reason := 'destination_account_missing';
    elsif p_product = 'RappiCard' and a.role <> 'credit' then
      p_status := 'pending_review'; p_reason := 'product_role_mismatch';
    elsif e.occurred_at is null then
      p_status := 'pending_review'; p_reason := 'notification_time_missing';
    elsif p_amount is null or p_amount <= 0 or p_amount > 999999999999.99 or p_amount <> round(p_amount,2) or p_direction is null or p_direction not in ('in','out') then
      raise exception 'Invalid movement';
    else
      insert into transactions(user_id, account_id,occurred_at,direction,amount,type,counterparty,source,description,dedupe_hash,needs_review,notification_event_id)
        values(p_owner,a.id,e.occurred_at,p_direction,p_amount,case when p_direction = 'out' then 'expense' else 'income' end,
          left(p_counterparty,160),'notification','Notification capture','notification-event:' || e.id,true,e.id) returning id into tx;
    end if;
  end if;
  update notification_events set status = p_status, reason = left(p_reason,120), product = p_product,
    parser_version = 'conservative-v1',transaction_id = tx where id = e.id returning * into e;
  return e;
end $$;
revoke all on function public.finish_notification(uuid,uuid,text,text,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.finish_notification(uuid,uuid,text,text,text,numeric,text,text) to service_role;

create or replace function public.trg_pair_after_insert() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  return null;
end $$;

create or replace function public.trg_confirm_partner() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  return null;
end $$;

create or replace function public.try_pair_transaction(n_id uuid) returns void language plpgsql set search_path = public, pg_temp as $$
begin
  return;
end $$;

create or replace function public.apply_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare matched rules%rowtype; sp income_splits%rowtype; extra numeric;
begin
  if new.notification_event_id is not null or new.dedupe_hash like '%:split' then return new; end if;
  select r.* into matched from rules r where r.active and r.user_id = new.user_id
    and (r.account_id is null or r.account_id = new.account_id)
    and (r.direction is null or r.direction = new.direction)
    and coalesce(new.counterparty,'') || ' ' || coalesce(new.description,'') ~* r.pattern order by r.priority limit 1;
  if found then
    new.type := matched.type; new.category_id := matched.category_id; new.matched_rule_id := matched.id; new.needs_review := matched.needs_review;
  else
    new.type := coalesce(new.type,case when new.direction = 'in' then 'income' else 'expense' end);
    if new.direction = 'in' and new.category_id is null then
      select id into new.category_id from categories where user_id = new.user_id and name = 'Other';
    end if;
    new.matched_rule_id := null;
    new.needs_review := true;
  end if;
  if new.direction = 'in' then
    select s.* into sp from income_splits s where s.active and s.user_id = new.user_id and new.amount > s.base_amount
      and coalesce(new.counterparty,'') || ' ' || coalesce(new.description,'') ~* s.pattern order by length(s.pattern) desc limit 1;
    if found then
      extra := new.amount - sp.base_amount;
      insert into transactions(user_id,account_id,occurred_at,direction,amount,type,counterparty,description,source,raw_text,dedupe_hash,needs_review)
        values(new.user_id,new.account_id,new.occurred_at,'in',extra,sp.remainder_type,new.counterparty,
          coalesce(new.description,'') || ' [parte ' || sp.remainder_type || ']',new.source,new.raw_text,new.dedupe_hash || ':split',false);
      new.amount := sp.base_amount; new.type := sp.base_type;
      if sp.base_type <> 'income' then new.category_id := null; end if;
      new.matched_rule_id := null; new.needs_review := false;
    end if;
  end if;
  return new;
end $$;

create or replace view public.transactions_budgeted with (security_invoker = true) as
select t.id,t.account_id,t.occurred_at,t.direction,t.amount,t.type,t.category_id,t.counterparty,t.description,t.source,t.raw_text,
  t.dedupe_hash,t.needs_review,t.matched_rule_id,t.created_at,t.paired_with,
  date_trunc('month',t.occurred_at at time zone 'America/Bogota') as real_month,
  date_trunc('month',t.occurred_at at time zone 'America/Bogota') + case when
    extract(day from t.occurred_at at time zone 'America/Bogota') >= (select b.income_cutoff_day from public.budget_split b where b.user_id = t.user_id)
    or exists(select 1 from public.rules r where r.user_id = t.user_id and r.active and r.cutoff_day is not null
      and (r.account_id is null or r.account_id = t.account_id) and (r.direction is null or r.direction = t.direction)
      and extract(day from t.occurred_at at time zone 'America/Bogota') >= r.cutoff_day
      and coalesce(t.counterparty,'') || ' ' || coalesce(t.description,'') ~* r.pattern)
    then interval '1 month' else interval '0' end as budget_month,
  t.label,t.original_amount
from public.transactions t;

revoke execute on function public.reapply_rules() from public,anon,authenticated,service_role;

create function public.review_notification(p_id uuid, p_product text, p_amount numeric, p_direction text, p_kind text, p_occurred_at timestamptz)
returns public.notification_events language plpgsql security definer set search_path = public, pg_temp as $$
declare e notification_events%rowtype; a accounts%rowtype; tx uuid;
begin
  select * into e from notification_events where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'Unknown event'; end if;
  if e.transaction_id is not null then return e; end if;
  if e.status = 'ignored' or p_kind is null or p_kind not in ('expense','income','card_payment','internal_transfer')
    or p_amount is null or p_amount <= 0 or p_amount > 999999999999.99 or p_amount <> round(p_amount,2)
    or p_direction is null or p_direction not in ('in','out') or p_occurred_at is null or not isfinite(p_occurred_at)
    or p_occurred_at < '1970-01-01'::timestamptz or p_occurred_at >= '2201-01-01'::timestamptz then raise exception 'Invalid review'; end if;
  select * into a from accounts where user_id = auth.uid() and name = p_product;
  if not found then raise exception 'Destination account missing'; end if;
  insert into transactions(user_id,account_id,occurred_at,direction,amount,type,source,description,dedupe_hash,needs_review,notification_event_id)
    values(e.user_id,a.id,p_occurred_at,p_direction,p_amount,p_kind,'notification','Manually reviewed notification',
      'notification-event:' || e.id,false,e.id) returning id into tx;
  update notification_events set status = 'processed', reason = 'manual_review', product = p_product, transaction_id = tx
    where id = e.id returning * into e;
  return e;
end $$;
revoke all on function public.review_notification(uuid,text,numeric,text,text,timestamptz) from public,anon;
grant execute on function public.review_notification(uuid,text,numeric,text,text,timestamptz) to authenticated;

create function public.link_notification_evidence(p_id uuid, p_transaction uuid) returns public.notification_events
language plpgsql security definer set search_path = public, pg_temp as $$
declare e notification_events%rowtype;
begin
  select * into e from notification_events where id = p_id and user_id = auth.uid() for update;
  if not found or not exists(select 1 from transactions where id = p_transaction and user_id = auth.uid()) then raise exception 'Unknown evidence'; end if;
  if e.transaction_id is not null or e.status = 'ignored' then return e; end if;
  update notification_events set status = 'processed',reason = 'manually_linked_evidence',transaction_id = p_transaction
    where id = e.id returning * into e;
  return e;
end $$;
revoke all on function public.link_notification_evidence(uuid,uuid) from public,anon;
grant execute on function public.link_notification_evidence(uuid,uuid) to authenticated;

commit;
