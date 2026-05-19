-- =====================================================================
--  Football Match Scrapper — initial schema
--  Modules: profiles, matchdays, matches, players, match_events,
--           match_lineups, exports, activity_log
--  Every row is owned by an auth.users record (`user_id`) so RLS can
--  scope reads/writes per-user. Admins (profiles.role = 'admin') get
--  full access via policy.
-- =====================================================================

-- Run as postgres so we have CREATE on schema public + auth.
-- Required when the SQL editor session lands on a less-privileged role.
set role postgres;

-- Make sure the public schema is actually usable.
grant usage  on schema public to anon, authenticated, service_role;
grant create on schema public to service_role;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. profiles  (1:1 with auth.users — holds role + display name)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  name        text not null,
  role        text not null default 'analyst' check (role in ('admin','analyst','viewer')),
  initials    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-create a profile row when a new auth user is inserted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role, initials)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'role', 'analyst'),
    upper(substr(coalesce(new.raw_user_meta_data ->> 'name', new.email), 1, 2))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. matchdays
-- ---------------------------------------------------------------------
create table if not exists public.matchdays (
  id          text primary key,                -- e.g. "md-33"
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text not null,                   -- "Spieltag 33"
  date        date not null,
  matches     int  not null default 0,
  scraped     int  not null default 0,
  status      text not null default 'queued' check (status in ('queued','running','complete','failed')),
  competition text not null default 'Bundesliga',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. matches
-- ---------------------------------------------------------------------
create table if not exists public.matches (
  id           text primary key,               -- e.g. "m-3301"
  user_id      uuid not null references auth.users(id) on delete cascade,
  matchday_id  text references public.matchdays(id) on delete cascade,
  kickoff      timestamptz not null,
  venue        text,
  competition  text not null default 'Bundesliga',
  status       text not null default 'queued' check (status in ('queued','running','scraped','failed')),
  events_count int  not null default 0,
  referee      text,
  attendance   int,

  home_code    text not null,
  home_name    text not null,
  home_color   text,
  home_score   int,
  home_formation text,

  away_code    text not null,
  away_name    text not null,
  away_color   text,
  away_score   int,
  away_formation text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. players  (catalogue — one row per player tracked)
-- ---------------------------------------------------------------------
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  external_id text,                            -- scraper-provided id
  name        text not null,
  team_code   text,
  position    text,
  shirt_num   int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, external_id)
);

-- ---------------------------------------------------------------------
-- 5. match_events  (goals, cards, subs)
-- ---------------------------------------------------------------------
create table if not exists public.match_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  match_id    text not null references public.matches(id) on delete cascade,
  minute      int not null,
  type        text not null check (type in ('goal','card','sub','var','other')),
  team        text not null check (team in ('home','away')),
  player      text,
  player_off  text,
  player_on   text,
  assist      text,
  detail      text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. match_lineups  (one row per player per match)
-- ---------------------------------------------------------------------
create table if not exists public.match_lineups (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  match_id      text not null references public.matches(id) on delete cascade,
  team          text not null check (team in ('home','away')),
  role          text not null check (role in ('starter','bench')),
  shirt_num     int,
  player_name   text not null,
  position      text,
  minutes_on    int default 0,
  minutes_off   int default 90,
  goals_for     int default 0,
  goals_against int default 0,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. exports  (generated report files)
-- ---------------------------------------------------------------------
create table if not exists public.exports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  file        text not null,
  size_bytes  bigint,
  rows        int,
  format      text not null check (format in ('xlsx','csv','json')),
  storage_path text,                           -- key in supabase storage bucket
  matchday_id text references public.matchdays(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 8. activity_log  (audit / dashboard feed)
-- ---------------------------------------------------------------------
create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  text        text not null,
  detail      text,
  tone        text not null default 'info' check (tone in ('success','info','warn','error')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','matchdays','matches','players']
  loop
    execute format(
      'drop trigger if exists trg_touch_%1$s on public.%1$s;
       create trigger trg_touch_%1$s before update on public.%1$s
         for each row execute function public.touch_updated_at();',
      t
    );
  end loop;
end$$;
