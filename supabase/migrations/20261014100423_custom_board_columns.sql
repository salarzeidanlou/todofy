-- Board definitions are account-scoped; the built-in IDs repeat across users.
-- Deleted columns retain replacement metadata to resolve stale offline tasks.
create table public.board_columns (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (id in ('todo','doing','blocked','done') or id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  order_index double precision not null check (order_index > '-Infinity'::float8 and order_index < 'Infinity'::float8),
  wip_limit integer check (wip_limit between 1 and 9999),
  updated_at timestamptz not null,
  deleted_at timestamptz,
  replacement_id text,
  recorded_at timestamptz not null default now(),
  primary key (user_id,id),
  check (id not in ('todo','done') or deleted_at is null),
  check (id != 'done' or wip_limit is null),
  check (deleted_at is null or (replacement_id is not null and replacement_id != id and replacement_id != 'done'))
);
create index board_columns_user_recorded_idx on public.board_columns(user_id,recorded_at);
alter table public.board_columns enable row level security;
create policy "read own board_columns" on public.board_columns for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "insert own board_columns" on public.board_columns for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "update own board_columns" on public.board_columns for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select,insert,update on public.board_columns to authenticated;

-- Only real changes advance recorded_at. Seed metadata never overwrites a
-- customized cloud column; a deletion is terminal even against a newer rename.
create or replace function public.sync_board_columns(changes jsonb)
returns void language sql security invoker set search_path = public as $$
  insert into public.board_columns(user_id,id,name,color,order_index,wip_limit,updated_at,deleted_at,replacement_id)
  select (select auth.uid()),id,btrim(name),lower(color),order_index,wip_limit,updated_at,deleted_at,replacement_id
  from jsonb_to_recordset(changes) as incoming(
    id text,name text,color text,order_index double precision,wip_limit integer,
    updated_at timestamptz,deleted_at timestamptz,replacement_id text
  )
  on conflict(user_id,id) do update set
    name=excluded.name,color=excluded.color,order_index=excluded.order_index,wip_limit=excluded.wip_limit,
    updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,replacement_id=excluded.replacement_id,
    recorded_at=now()
  where (board_columns.deleted_at is null and
    (excluded.updated_at > board_columns.updated_at or excluded.deleted_at is not null))
    or (board_columns.deleted_at is not null and excluded.deleted_at is not null and excluded.updated_at > board_columns.updated_at);
$$;
revoke execute on function public.sync_board_columns(jsonb) from public,anon;
grant execute on function public.sync_board_columns(jsonb) to authenticated;

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
