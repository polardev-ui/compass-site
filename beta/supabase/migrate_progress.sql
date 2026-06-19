alter table public.watch_history add column if not exists position_seconds integer not null default 0;
alter table public.watch_history add column if not exists duration_seconds integer not null default 0;
alter table public.watch_history alter column season set default 0;
alter table public.watch_history alter column episode set default 0;
update public.watch_history set season = 0 where season is null;
update public.watch_history set episode = 0 where episode is null;

alter table public.watch_history drop constraint if exists watch_history_user_id_content_id_content_type_key;

alter table public.watch_history
  add constraint watch_history_user_content_episode_key
  unique (user_id, content_id, content_type, season, episode);
