-- Height drives the fat auto-estimate (height_cm / 2.2), editable in Settings.
alter table public.diet_settings
  add column if not exists height_cm numeric(5,1);
