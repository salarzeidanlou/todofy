-- Keep deletion metadata separate from user content. A sync client first
-- inserts one immutable marker here, then physically deletes the corresponding
-- row from its content table. Other devices pull the marker and apply the
-- deletion locally, so hard deletes do not cause stale devices to resurrect
-- tasks, labels, associations, focus sessions, or journal entries.

create table public.sync_tombstones (
  user_id     uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  entity_type text not null check (
    entity_type in ('tasks', 'labels', 'task_labels', 'time_sessions', 'journal_entries')
  ),
  entity_id   text not null,
  deleted_at  timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key (user_id, entity_type, entity_id)
);

create index sync_tombstones_user_recorded_idx
  on public.sync_tombstones (user_id, recorded_at);

alter table public.sync_tombstones enable row level security;

create policy "read own sync_tombstones" on public.sync_tombstones
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "insert own sync_tombstones" on public.sync_tombstones
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert on public.sync_tombstones to authenticated;

-- Convert existing soft-deleted rows without retaining their content. These
-- statements run only when this migration is deliberately applied.
insert into public.sync_tombstones (user_id, entity_type, entity_id, deleted_at)
select user_id, 'tasks', id::text, deleted_at
from public.tasks where deleted_at is not null
on conflict do nothing;

insert into public.sync_tombstones (user_id, entity_type, entity_id, deleted_at)
select user_id, 'labels', id::text, deleted_at
from public.labels where deleted_at is not null
on conflict do nothing;

insert into public.sync_tombstones (user_id, entity_type, entity_id, deleted_at)
select user_id, 'task_labels', task_id::text || ':' || label_id::text, deleted_at
from public.task_labels where deleted_at is not null
on conflict do nothing;

insert into public.sync_tombstones (user_id, entity_type, entity_id, deleted_at)
select user_id, 'time_sessions', id::text, deleted_at
from public.time_sessions where deleted_at is not null
on conflict do nothing;

insert into public.sync_tombstones (user_id, entity_type, entity_id, deleted_at)
select user_id, 'journal_entries', id::text, deleted_at
from public.journal_entries where deleted_at is not null
on conflict do nothing;

-- Children first; parent deletes also cascade any remaining dependent rows.
delete from public.task_labels where deleted_at is not null;
delete from public.time_sessions where deleted_at is not null;
delete from public.journal_entries where deleted_at is not null;
delete from public.tasks where deleted_at is not null;
delete from public.labels where deleted_at is not null;
