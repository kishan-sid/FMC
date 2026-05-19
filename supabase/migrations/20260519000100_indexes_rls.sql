-- =====================================================================
--  Indexes + Row Level Security
--  Every public table is scoped by `user_id`. Admins (profiles.role =
--  'admin') get full access via the is_admin() helper.
-- =====================================================================

set role postgres;

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
create index if not exists idx_matchdays_user_date    on public.matchdays    (user_id, date desc);
create index if not exists idx_matchdays_status       on public.matchdays    (status);

create index if not exists idx_matches_user_kickoff   on public.matches      (user_id, kickoff desc);
create index if not exists idx_matches_matchday       on public.matches      (matchday_id);
create index if not exists idx_matches_status         on public.matches      (status);
create index if not exists idx_matches_home_code      on public.matches      (home_code);
create index if not exists idx_matches_away_code      on public.matches      (away_code);

create index if not exists idx_players_user_name      on public.players      (user_id, name);
create index if not exists idx_players_team           on public.players      (team_code);

create index if not exists idx_events_match           on public.match_events (match_id, minute);
create index if not exists idx_events_user            on public.match_events (user_id);
create index if not exists idx_events_type            on public.match_events (type);

create index if not exists idx_lineups_match          on public.match_lineups (match_id);
create index if not exists idx_lineups_user           on public.match_lineups (user_id);

create index if not exists idx_exports_user_created   on public.exports      (user_id, created_at desc);
create index if not exists idx_exports_matchday       on public.exports      (matchday_id);

create index if not exists idx_activity_user_created  on public.activity_log (user_id, created_at desc);
create index if not exists idx_activity_tone          on public.activity_log (tone);

-- ---------------------------------------------------------------------
-- is_admin() helper — used by every RLS policy below
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.matchdays     enable row level security;
alter table public.matches       enable row level security;
alter table public.players       enable row level security;
alter table public.match_events  enable row level security;
alter table public.match_lineups enable row level security;
alter table public.exports       enable row level security;
alter table public.activity_log  enable row level security;

-- ---------------------------------------------------------------------
-- Profiles — users see/edit their own profile; admins see all
-- ---------------------------------------------------------------------
drop policy if exists "profiles read self or admin"  on public.profiles;
create policy "profiles read self or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles update self or admin" on public.profiles;
create policy "profiles update self or admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
              with check (id = auth.uid() or public.is_admin());

drop policy if exists "profiles insert self" on public.profiles;
create policy "profiles insert self" on public.profiles
  for insert with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- Generic "owner or admin" policies for every data table
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  tbls text[] := array[
    'matchdays','matches','players',
    'match_events','match_lineups','exports','activity_log'
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
