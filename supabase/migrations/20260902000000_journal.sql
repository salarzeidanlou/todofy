-- Cloud mirror of the local `journal_entries` table. Same UUIDs, per-user,
-- last-write-wins via `updated_at`, soft-deleted via `deleted_at`.

create table if not exists public.journal_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text,
  body       text not null default '',
  mood       smallint,
  entry_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists journal_entries_user_updated_idx
  on public.journal_entries (user_id, updated_at);

alter table public.journal_entries enable row level security;

create policy "own journal_entries" on public.journal_entries
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.journal_entries to authenticated;
