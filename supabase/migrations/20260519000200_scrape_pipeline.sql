-- =====================================================================
--  Scrape & Export pipeline
--  Adds tables to track each scrape run end-to-end so the UI on the
--  "Scrape & Export" screen can show live progress (6-step pipeline)
--  and a Recent Exports list.
--
--    scrape_jobs              header per pipeline run
--    scrape_job_steps         one row per pipeline step (live progress)
--    match_urls               URLs discovered from a matchday page
--    player_match_intervals   computed on-pitch intervals + goals math
--
--  All rows are scoped by user_id (RLS). Same owner-or-admin policy
--  pattern as the existing tables.
-- =====================================================================

set role postgres;

-- ---------------------------------------------------------------------
-- 1. scrape_jobs  (pipeline run header)
-- ---------------------------------------------------------------------
create table if not exists public.scrape_jobs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  source_url       text not null,
  source_type      text not null check (source_type in ('matchday','match')),
  matchday_id      text references public.matchdays(id) on delete set null,
  status           text not null default 'queued'
                   check (status in ('queued','running','done','failed','cancelled')),
  current_step     int  not null default 0,
  total_steps      int  not null default 6,
  progress_percent int  not null default 0 check (progress_percent between 0 and 100),
  error_message    text,
  export_id        uuid references public.exports(id) on delete set null,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);

-- ---------------------------------------------------------------------
-- 2. scrape_job_steps  (per-step live status)
-- ---------------------------------------------------------------------
create table if not exists public.scrape_job_steps (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.scrape_jobs(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  step_order       int  not null,
  name             text not null,
  status           text not null default 'pending'
                   check (status in ('pending','running','done','failed','skipped')),
  progress_percent int  not null default 0 check (progress_percent between 0 and 100),
  detail           text,
  started_at       timestamptz,
  finished_at      timestamptz,
  error            text,
  unique (job_id, step_order)
);

-- ---------------------------------------------------------------------
-- 3. match_urls  (URLs found while scraping a matchday)
-- ---------------------------------------------------------------------
create table if not exists public.match_urls (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  job_id       uuid references public.scrape_jobs(id) on delete cascade,
  matchday_id  text references public.matchdays(id) on delete cascade,
  url          text not null,
  status       text not null default 'queued'
               check (status in ('queued','running','scraped','failed','skipped')),
  match_id     text references public.matches(id) on delete set null,
  error        text,
  scraped_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (matchday_id, url)
);

-- ---------------------------------------------------------------------
-- 4. player_match_intervals  (output of timeline reconstruction)
-- ---------------------------------------------------------------------
create table if not exists public.player_match_intervals (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  match_id           text not null references public.matches(id) on delete cascade,
  player_id          uuid references public.players(id) on delete set null,
  player_name        text not null,
  team               text not null check (team in ('home','away')),
  start_minute       int  not null,
  end_minute         int  not null,
  on_pitch_minutes   int  generated always as (greatest(end_minute - start_minute, 0)) stored,
  goals_for          int  not null default 0,
  goals_against      int  not null default 0,
  red_card_minute    int,
  created_at         timestamptz not null default now(),
  unique (match_id, player_name, start_minute)
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
create index if not exists idx_jobs_user_created   on public.scrape_jobs(user_id, created_at desc);
create index if not exists idx_jobs_status         on public.scrape_jobs(status);
create index if not exists idx_jobs_matchday       on public.scrape_jobs(matchday_id);

create index if not exists idx_steps_job_order     on public.scrape_job_steps(job_id, step_order);
create index if not exists idx_steps_user          on public.scrape_job_steps(user_id);
create index if not exists idx_steps_status        on public.scrape_job_steps(status);

create index if not exists idx_match_urls_job      on public.match_urls(job_id);
create index if not exists idx_match_urls_matchday on public.match_urls(matchday_id);
create index if not exists idx_match_urls_status   on public.match_urls(status);

create index if not exists idx_intervals_match     on public.player_match_intervals(match_id);
create index if not exists idx_intervals_player    on public.player_match_intervals(player_name);
create index if not exists idx_intervals_user      on public.player_match_intervals(user_id);

-- ---------------------------------------------------------------------
-- Enable RLS + owner-or-admin policies (same pattern as init_schema)
-- ---------------------------------------------------------------------
alter table public.scrape_jobs             enable row level security;
alter table public.scrape_job_steps        enable row level security;
alter table public.match_urls              enable row level security;
alter table public.player_match_intervals  enable row level security;

do $$
declare
  t text;
  tbls text[] := array[
    'scrape_jobs','scrape_job_steps','match_urls','player_match_intervals'
  ];
begin
  foreach t in array tbls loop
    execute format('drop policy if exists "%1$s select owner or admin" on public.%1$s;', t);
    execute format(
      'create policy "%1$s select owner or admin" on public.%1$s
         for select using (user_id = auth.uid() or public.is_admin());', t);

    execute format('drop policy if exists "%1$s insert owner" on public.%1$s;', t);
    execute format(
      'create policy "%1$s insert owner" on public.%1$s
         for insert with check (user_id = auth.uid() or public.is_admin());', t);

    execute format('drop policy if exists "%1$s update owner or admin" on public.%1$s;', t);
    execute format(
      'create policy "%1$s update owner or admin" on public.%1$s
         for update using (user_id = auth.uid() or public.is_admin())
                     with check (user_id = auth.uid() or public.is_admin());', t);

    execute format('drop policy if exists "%1$s delete owner or admin" on public.%1$s;', t);
    execute format(
      'create policy "%1$s delete owner or admin" on public.%1$s
         for delete using (user_id = auth.uid() or public.is_admin());', t);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- Helper: seed the 6 standard steps for a new job
-- ---------------------------------------------------------------------
create or replace function public.seed_scrape_steps(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  steps text[] := array[
    'Fetching matchday page',
    'Extracting match URLs',
    'Scraping events + lineups',
    'Reconstructing player timelines',
    'Computing on-pitch goals',
    'Building Excel/CSV'
  ];
  i int;
begin
  select user_id into v_user from public.scrape_jobs where id = p_job_id;
  if v_user is null then
    raise exception 'scrape_jobs % not found', p_job_id;
  end if;

  for i in 1 .. array_length(steps, 1) loop
    insert into public.scrape_job_steps (job_id, user_id, step_order, name)
    values (p_job_id, v_user, i, steps[i])
    on conflict (job_id, step_order) do nothing;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Realtime publication — UI subscribes to live progress
-- ---------------------------------------------------------------------
do $$
begin
  -- supabase_realtime publication exists by default in Supabase projects
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.scrape_jobs;      exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.scrape_job_steps; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.activity_log;     exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.exports;          exception when duplicate_object then null; end;
  end if;
end$$;
