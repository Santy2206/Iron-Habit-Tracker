-- Remove duplicate diet_history logs: keep one row per
-- (user, day, phase, calories, macros)
delete from public.diet_history a
where exists (
  select 1
  from public.diet_history b
  where b.user_id = a.user_id
    and b.changed_on = a.changed_on
    and b.phase = a.phase
    and b.calorie_intake = a.calorie_intake
    and b.protein_g = a.protein_g
    and b.carbs_g = a.carbs_g
    and b.fat_g = a.fat_g
    and b.ctid < a.ctid
);
