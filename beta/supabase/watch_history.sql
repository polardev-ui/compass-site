create table if not exists public.watch_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id integer not null,
  content_type text not null check (content_type in ('movie', 'tv')),
  title text not null,
  poster_path text,
  year text,
  season integer not null default 0,
  episode integer not null default 0,
  position_seconds integer not null default 0,
  duration_seconds integer not null default 0,
  watched_at timestamptz not null default now(),
  unique (user_id, content_id, content_type, season, episode)
);

create index if not exists watch_history_user_watched_idx
  on public.watch_history (user_id, watched_at desc);

alter table public.watch_history enable row level security;

create policy "watch_history_select_own"
  on public.watch_history for select
  using (auth.uid() = user_id);

create policy "watch_history_insert_own"
  on public.watch_history for insert
  with check (auth.uid() = user_id);

create policy "watch_history_update_own"
  on public.watch_history for update
  using (auth.uid() = user_id);

create policy "watch_history_delete_own"
  on public.watch_history for delete
  using (auth.uid() = user_id);
