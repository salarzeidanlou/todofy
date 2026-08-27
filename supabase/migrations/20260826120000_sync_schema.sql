-- Cloud mirror of the local SQLite tables for account sync.
-- Ids are the same UUIDs the client generates on-device, so a row round-trips
-- unchanged. Every table is per-user (`user_id`), carries `updated_at` for
-- last-write-wins ordering, and `deleted_at` as a soft-delete tombstone.

create table if not exists public.labels (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  color      text not null default '#6c7cff',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null,
  notes        text,
  due_date     date,
  remind_at    timestamptz,
  status       text not null default 'active',
  priority     smallint not null default 4,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  order_index  double precision not null default 0,
  pinned       boolean not null default false,
  repeat       text,
  subtasks     jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table if not exists public.task_labels (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id    uuid not null references public.tasks (id) on delete cascade,
  label_id   uuid not null references public.labels (id) on delete cascade,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (task_id, label_id)
);

create table if not exists public.time_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id    uuid not null references public.tasks (id) on delete cascade,
  start_at   timestamptz not null,
  end_at     timestamptz,
  seconds    integer,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Pull queries scan by (user_id, updated_at); the FK index speeds session joins.
create index if not exists labels_user_updated_idx on public.labels (user_id, updated_at);
create index if not exists tasks_user_updated_idx on public.tasks (user_id, updated_at);
create index if not exists task_labels_user_updated_idx on public.task_labels (user_id, updated_at);
create index if not exists time_sessions_user_updated_idx on public.time_sessions (user_id, updated_at);
create index if not exists time_sessions_task_idx on public.time_sessions (task_id);

-- Row-level security: a user can only ever see or touch their own rows.
alter table public.labels enable row level security;
alter table public.tasks enable row level security;
alter table public.task_labels enable row level security;
alter table public.time_sessions enable row level security;

create policy "own labels" on public.labels
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own tasks" on public.tasks
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own task_labels" on public.task_labels
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own time_sessions" on public.time_sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- RLS decides which rows; these grant the signed-in role table-level DML at all.
-- No grants to `anon` — sync always runs authenticated.
grant select, insert, update, delete on public.labels to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.task_labels to authenticated;
grant select, insert, update, delete on public.time_sessions to authenticated;
