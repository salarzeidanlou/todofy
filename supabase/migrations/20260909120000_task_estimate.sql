-- Estimated effort per task, in minutes. Nullable: most tasks never get one,
-- and NULL is what the client sends for "no estimate".
--
-- Additive and idempotent, so clients older than this feature keep working —
-- they simply never write the column, and it stays NULL for their rows.

alter table public.tasks
  add column if not exists estimate_minutes integer;

alter table public.tasks
  drop constraint if exists tasks_estimate_minutes_positive;

-- Guard the column at the database as well as in the client, so a bad write
-- from any source cannot store a zero or negative estimate.
alter table public.tasks
  add constraint tasks_estimate_minutes_positive
  check (estimate_minutes is null or estimate_minutes > 0);
