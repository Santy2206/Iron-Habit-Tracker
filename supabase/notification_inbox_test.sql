begin;
set local row_security = on;
do $$ begin
  if current_database() not like 'iron%test' or current_setting('iron.test_database',true) is distinct from 'synthetic-local-only' then
    raise exception 'Run only in an explicitly marked local test database';
  end if;
end $$;

select set_config('iron.assign_owner','on',true);
insert into public.accounts(name,role) values ('Synthetic legacy account','operating');
select set_config('iron.assign_owner','off',true);

insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into public.accounts(id,user_id,name,role) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','RappiCard','credit'),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','RappiCard','credit'),
('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Nequi','operating'),
('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','RappiCuenta','operating');
insert into public.budget_split(user_id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into public.notification_capturers(id,user_id,secret_hash,label) values
('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',repeat('a',64),'synthetic fixture');

set local role service_role;
do $$
declare e public.notification_events; second_event public.notification_events; ignored_event public.notification_events;
begin
  e := public.receive_notification('40000000-0000-4000-8000-000000000001','synthetic-1','RappiCard','2026-10-20T10:00:00Z','synthetic purchase',repeat('b',64),false);
  e := public.finish_notification(e.id,e.user_id,'processed',null,'RappiCard',25000.50,'out');
  if e.status <> 'processed' or e.transaction_id is null then raise exception 'Missing transaction'; end if;
  e := public.receive_notification('40000000-0000-4000-8000-000000000001','synthetic-1','RappiCard','2026-10-20T10:00:00Z','synthetic purchase',repeat('b',64),false);
  e := public.finish_notification(e.id,e.user_id,'processed',null,'RappiCard',25000.50,'out');
  if (select count(*) from public.transactions) <> 1 then raise exception 'Retry duplicated'; end if;
  second_event := public.receive_notification('40000000-0000-4000-8000-000000000001','synthetic-2','RappiCard','2026-10-20T10:00:00Z','synthetic purchase',repeat('b',64),false);
  second_event := public.finish_notification(second_event.id,second_event.user_id,'processed',null,'RappiCard',25000.50,'out');
  if (select count(*) from public.transactions) <> 2 then raise exception 'Distinct equal events merged'; end if;
  begin
    perform public.receive_notification('40000000-0000-4000-8000-000000000001','synthetic-1','RappiCard',null,'changed',repeat('c',64),false);
    raise exception 'Identity conflict accepted';
  exception when data_exception then null; end;
  e := public.receive_notification('40000000-0000-4000-8000-000000000001','missing-account','RappiCard',now(),'synthetic',repeat('d',64),false);
  e := public.finish_notification(e.id,e.user_id,'processed',null,'RappiCuenta',1,'out');
  if e.status <> 'pending_review' or e.reason <> 'destination_account_missing' or e.transaction_id is not null then raise exception 'Incorrect fallback'; end if;
  perform public.receive_notification('40000000-0000-4000-8000-000000000001','evidence','RappiCard',now(),'synthetic evidence',repeat('f',64),false);
  perform public.receive_notification('40000000-0000-4000-8000-000000000001','transfer','Nequi',now(),'synthetic transfer',repeat('f',64),false);
  ignored_event := public.receive_notification('40000000-0000-4000-8000-000000000001','otp','Nequi',now(),'synthetic OTP',repeat('e',64),true);
  if ignored_event.raw_text is not null or ignored_event.status <> 'ignored' then raise exception 'Sensitive text persisted'; end if;
  begin
    perform public.finish_notification(e.id,'10000000-0000-4000-8000-000000000002','processed',null,'RappiCard',1,'out');
    raise exception 'CROSS_OWNER_ALLOWED';
  exception when raise_exception then
    if sqlerrm <> 'Unknown event' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
declare affected integer;
begin
  if (select count(*) from public.accounts) <> 2 then raise exception 'Accounts not isolated'; end if;
  if (select count(*) from public.transactions) <> 0 then raise exception 'Transactions exposed'; end if;
  if (select count(*) from public.notification_events) <> 0 then raise exception 'Inbox exposed'; end if;
  if exists(select 1 from public.transactions_budgeted) then raise exception 'View exposed another owner'; end if;
  if has_function_privilege(current_user,'public.receive_notification(uuid,text,text,timestamptz,text,text,boolean)','execute') then raise exception 'Privileged receipt callable'; end if;
  if has_table_privilege(current_user,'public.notification_capturers','select') then raise exception 'Capturer hashes exposed'; end if;
  if has_table_privilege(current_user,'public.accounts','truncate') then raise exception 'Client truncate privilege'; end if;
  if exists(select 1 from public.notification_source_status) then raise exception 'Diagnostic view exposed another owner'; end if;
  update public.accounts set name = 'unauthorized' where id = '30000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-owner update'; end if;
  delete from public.transactions where user_id = '10000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-owner delete'; end if;
  begin
    insert into public.accounts(user_id,name,role) values('10000000-0000-4000-8000-000000000001','forged-owner','operating');
    raise exception 'CROSS_OWNER_ALLOWED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare e public.notification_events; original_amount numeric; target uuid;
begin
  if (select count(*) from public.transactions) <> 2 then raise exception 'Owner cannot read transactions'; end if;
  select * into e from public.notification_events where event_id = 'missing-account';
  e := public.review_notification(e.id,'RappiCard',500,'in','card_payment','2026-10-20T10:00:00Z');
  if (select type from public.transactions where id = e.transaction_id) <> 'card_payment' then raise exception 'Card payment treated as consumption'; end if;
  update public.transactions set amount = 499 where id = e.transaction_id;
  e := public.review_notification(e.id,'RappiCard',999,'out','expense','2026-10-20T10:00:00Z');
  select amount into original_amount from public.transactions where id = e.transaction_id;
  if original_amount <> 499 then raise exception 'Manual correction overwritten'; end if;
  target := e.transaction_id;
  select * into e from public.notification_events where event_id = 'evidence';
  e := public.link_notification_evidence(e.id,target);
  if e.transaction_id <> target or (select count(*) from public.transactions) <> 3 then raise exception 'Evidence duplicated movement'; end if;
  select * into e from public.notification_events where event_id = 'transfer';
  e := public.review_notification(e.id,'Nequi',25000.50,'in','internal_transfer','2026-10-20T10:00:00Z');
  if (select sum(income) from public.monthly_budget) <> 0 then raise exception 'Internal transfer counted as income'; end if;
  if (select sum(unclassified_expense) from public.monthly_budget) <> 50001 then raise exception 'Card payment double-counted'; end if;
  if exists(select 1 from public.transactions where paired_with is not null) then raise exception 'Amount-only auto pairing'; end if;
  begin
    insert into public.transactions(account_id,occurred_at,direction,amount,type,source,dedupe_hash)
      values('30000000-0000-4000-8000-000000000002',now(),'out',1,'expense','manual','synthetic-cross-owner');
    raise exception 'CROSS_OWNER_ALLOWED';
  exception when raise_exception then
    if sqlerrm <> 'Cross-owner finance reference' then raise; end if;
  end;
end $$;
reset role;
set local role anon;
do $$
begin
  if has_table_privilege(current_user,'public.notification_events','select') then raise exception 'Anonymous inbox read'; end if;
  if has_function_privilege(current_user,'public.review_notification(uuid,text,numeric,text,text,timestamptz)','execute') then raise exception 'Anonymous review'; end if;
end $$;
reset role;
select public.assign_legacy_finance_owner('10000000-0000-4000-8000-000000000001');
do $$ begin
  if exists(select 1 from public.accounts where user_id is null) then raise exception 'Explicit legacy assignment failed'; end if;
end $$;

rollback;
