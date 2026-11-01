-- Priority profiles are account-scoped, and there are always exactly four of
-- them. They are never created or deleted, so their primary key is the priority
-- number itself and they need neither UUIDs nor tombstones: only contents
-- change. Every reminder column is nullable, meaning "follow the account's
-- global reminder settings".
create table if not exists public.priority_profiles (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  priority smallint not null check (priority between 1 and 4),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sound text check (sound in ('none','chime','ping','bell','custom')),
  volume integer check (volume between 0 and 100),
  ramp boolean,
  notification_style text check (notification_style in ('custom','native')),
  -- 0 means "fire once", which is a choice rather than an absent override.
  repeat_minutes integer check (repeat_minutes between 0 and 1440),
  updated_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key (user_id,priority)
);
create index if not exists priority_profiles_user_recorded_idx
  on public.priority_profiles(user_id,recorded_at);
alter table public.priority_profiles enable row level security;
-- Dropped first so re-running this file is safe, as the setup guide promises.
drop policy if exists "read own priority_profiles" on public.priority_profiles;
create policy "read own priority_profiles" on public.priority_profiles for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "insert own priority_profiles" on public.priority_profiles;
create policy "insert own priority_profiles" on public.priority_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "update own priority_profiles" on public.priority_profiles;
create policy "update own priority_profiles" on public.priority_profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- No delete: a profile that could be removed would come back as a seed on the
-- next sync, which is indistinguishable from a reset nobody asked for.
grant select,insert,update on public.priority_profiles to authenticated;

-- Only a strictly newer revision wins, so the seeded profiles a fresh device
-- pushes on its first round cannot overwrite the ones customized elsewhere.
-- The custom sound's *bytes* are deliberately absent: they stay on the device
-- that loaded them, and only the choice of "custom" travels.
create or replace function public.sync_priority_profiles(changes jsonb)
returns void language sql security invoker set search_path = public as $$
  insert into public.priority_profiles(
    user_id,priority,name,color,sound,volume,ramp,notification_style,repeat_minutes,updated_at)
  select (select auth.uid()),priority,btrim(name),lower(color),sound,volume,ramp,
         notification_style,repeat_minutes,updated_at
  from jsonb_to_recordset(changes) as incoming(
    priority smallint,name text,color text,sound text,volume integer,ramp boolean,
    notification_style text,repeat_minutes integer,updated_at timestamptz
  )
  on conflict(user_id,priority) do update set
    name=excluded.name,color=excluded.color,sound=excluded.sound,volume=excluded.volume,
    ramp=excluded.ramp,notification_style=excluded.notification_style,
    repeat_minutes=excluded.repeat_minutes,updated_at=excluded.updated_at,recorded_at=now()
  where excluded.updated_at > priority_profiles.updated_at;
$$;
revoke execute on function public.sync_priority_profiles(jsonb) from public,anon;
grant execute on function public.sync_priority_profiles(jsonb) to authenticated;

create or replace function public.sync_pull(since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'board_columns', coalesce((
      select jsonb_agg(to_jsonb(t) - 'recorded_at')
      from public.board_columns t
      where t.user_id = (select auth.uid()) and t.recorded_at > since
    ), '[]'::jsonb),
    'priority_profiles', coalesce((
      select jsonb_agg(to_jsonb(t) - 'recorded_at')
      from public.priority_profiles t
      where t.user_id = (select auth.uid()) and t.recorded_at > since
    ), '[]'::jsonb),
    'labels', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.labels t
      where t.user_id = (select auth.uid()) and t.updated_at > since
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.tasks t
      where t.user_id = (select auth.uid()) and t.updated_at > since
    ), '[]'::jsonb),
    'task_labels', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.task_labels t
      where t.user_id = (select auth.uid()) and t.updated_at > since
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.time_sessions t
      where t.user_id = (select auth.uid()) and t.updated_at > since
    ), '[]'::jsonb),
    'journal', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.journal_entries t
      where t.user_id = (select auth.uid()) and t.updated_at > since
    ), '[]'::jsonb),
    'tombstones', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.sync_tombstones t
      where t.user_id = (select auth.uid()) and t.recorded_at > since
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.sync_pull(timestamptz) from public, anon;
grant execute on function public.sync_pull(timestamptz) to authenticated;
