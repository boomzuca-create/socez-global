begin;

create extension if not exists pgcrypto;

create type public.market_type as enum ('1X2', 'AH', 'OU');
create type public.pick_status as enum ('OPEN', 'PENDING', 'WIN', 'LOSS', 'PUSH', 'VOID');
create type public.risk_flag as enum ('GREEN', 'YELLOW', 'RED');
create type public.settlement_result as enum ('FULL_WIN', 'HALF_WIN', 'PUSH', 'HALF_LOSS', 'FULL_LOSS', 'VOID');
create type public.job_status as enum ('STARTED', 'SUCCEEDED', 'FAILED', 'SKIPPED');

create table public.regions (
  id smallint generated always as identity primary key,
  code text not null unique check (code in ('EUROPE', 'ASIA', 'AMERICAS', 'AFRICA', 'OCEANIA', 'INTERNATIONAL')),
  name text not null,
  sort_order smallint not null
);

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_competition_id text not null,
  region_id smallint not null references public.regions(id),
  country text not null,
  name text not null,
  season_label text,
  coverage_tier text not null default 'C' check (coverage_tier in ('A', 'B', 'C', 'BLOCKED')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_competition_id)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_team_id text not null,
  name text not null,
  normalized_name text not null,
  country text,
  badge_url text,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_team_id)
);

create table public.fixtures (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_fixture_id text not null,
  competition_id uuid not null references public.competitions(id),
  home_team_id uuid not null references public.teams(id),
  away_team_id uuid not null references public.teams(id),
  kickoff_at timestamptz not null,
  venue text,
  status text not null default 'SCHEDULED',
  home_score smallint check (home_score >= 0),
  away_score smallint check (away_score >= 0),
  regulation_result_confirmed boolean not null default false,
  data_quality smallint not null default 0 check (data_quality between 0 and 100),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_fixture_id),
  check (home_team_id <> away_team_id)
);

create table public.bookmakers (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_bookmaker_id text not null,
  name text not null,
  region_code text,
  reliability_weight numeric(5,4) not null default 1 check (reliability_weight > 0),
  is_active boolean not null default true,
  unique (provider, provider_bookmaker_id)
);

create table public.odds_snapshots (
  id bigint generated always as identity primary key,
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  bookmaker_id uuid not null references public.bookmakers(id),
  market public.market_type not null,
  selection text not null,
  line numeric(6,2),
  decimal_odds numeric(8,4) not null check (decimal_odds > 1),
  implied_probability numeric(8,7) check (implied_probability > 0 and implied_probability <= 1),
  captured_at timestamptz not null,
  is_in_play boolean not null default false,
  source_payload jsonb not null default '{}'::jsonb,
  unique (fixture_id, bookmaker_id, market, selection, line, captured_at)
);

create table public.model_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  name text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'BACKTEST', 'ACTIVE', 'RETIRED')),
  weights jsonb not null,
  thresholds jsonb not null,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.model_rules (
  id smallint primary key check (id between 1 and 12),
  code text not null unique,
  name text not null,
  market public.market_type,
  phase text not null check (phase in ('PREMATCH', 'LIVE')),
  status text not null default 'EXPERIMENTAL' check (status in ('EXPERIMENTAL', 'ACTIVE', 'DISABLED', 'DEFINITION_REQUIRED')),
  definition jsonb not null default '{}'::jsonb,
  current_weight numeric(6,5) not null default 0,
  minimum_sample_size integer not null default 100,
  updated_at timestamptz not null default now()
);

create table public.model_runs (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.model_versions(id),
  session_time time not null check (session_time in ('11:00', '18:00')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  fixtures_scanned integer not null default 0,
  fixtures_qualified integer not null default 0,
  status public.job_status not null default 'STARTED',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  idempotency_key text not null unique,
  check (window_end > window_start)
);

create table public.final_picks (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id),
  model_run_id uuid not null references public.model_runs(id),
  model_version_id uuid not null references public.model_versions(id),
  session_time time not null check (session_time in ('11:00', '18:00')),
  market public.market_type not null,
  selection text not null,
  line numeric(6,2),
  decimal_odds numeric(8,4) not null check (decimal_odds > 1),
  model_probability numeric(8,7) not null check (model_probability > 0 and model_probability <= 1),
  market_probability numeric(8,7) not null check (market_probability > 0 and market_probability <= 1),
  expected_value numeric(8,7) not null,
  confidence smallint not null check (confidence between 0 and 100),
  data_quality smallint not null check (data_quality between 0 and 100),
  risk_flag public.risk_flag not null,
  signals jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  stake_units numeric(8,3) not null default 1 check (stake_units > 0),
  status public.pick_status not null default 'OPEN',
  price_locked_at timestamptz not null,
  published_at timestamptz not null default now(),
  unique (fixture_id, model_version_id, market, selection, line)
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null unique references public.final_picks(id),
  result public.settlement_result not null,
  home_score smallint not null check (home_score >= 0),
  away_score smallint not null check (away_score >= 0),
  profit_units numeric(10,4) not null,
  settlement_detail jsonb not null default '{}'::jsonb,
  source_confirmations jsonb not null default '[]'::jsonb,
  settled_at timestamptz not null default now(),
  corrected_at timestamptz,
  correction_reason text
);

create table public.job_runs (
  id bigint generated always as identity primary key,
  job_name text not null,
  scheduled_for timestamptz not null,
  status public.job_status not null default 'STARTED',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  attempt smallint not null default 1,
  records_processed integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  error_message text,
  idempotency_key text not null unique
);

create table public.notification_logs (
  id bigint generated always as identity primary key,
  model_run_id uuid references public.model_runs(id),
  channel text not null check (channel in ('DASHBOARD', 'LINE')),
  status text not null check (status in ('QUEUED', 'SENT', 'FAILED', 'SKIPPED')),
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index fixtures_kickoff_idx on public.fixtures (kickoff_at);
create index fixtures_competition_idx on public.fixtures (competition_id, kickoff_at desc);
create index odds_fixture_market_idx on public.odds_snapshots (fixture_id, market, captured_at desc);
create index picks_published_idx on public.final_picks (published_at desc);
create index picks_status_idx on public.final_picks (status, published_at desc);
create index settlements_settled_idx on public.settlements (settled_at desc);
create index job_runs_name_scheduled_idx on public.job_runs (job_name, scheduled_for desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger competitions_set_updated_at before update on public.competitions for each row execute function public.set_updated_at();
create trigger teams_set_updated_at before update on public.teams for each row execute function public.set_updated_at();
create trigger fixtures_set_updated_at before update on public.fixtures for each row execute function public.set_updated_at();
create trigger model_rules_set_updated_at before update on public.model_rules for each row execute function public.set_updated_at();

insert into public.regions (code, name, sort_order) values
  ('EUROPE', 'Europe', 1),
  ('ASIA', 'Asia', 2),
  ('AMERICAS', 'Americas', 3),
  ('AFRICA', 'Africa', 4),
  ('OCEANIA', 'Oceania', 5),
  ('INTERNATIONAL', 'International', 6);

insert into public.model_versions (version, name, status, weights, thresholds) values (
  '1.0.0',
  'Global Football Pattern & Value Model',
  'DRAFT',
  '{"goal_model":0.35,"strength_form":0.25,"availability_context":0.20,"schedule_motivation":0.15,"pattern_signals":0.05}',
  '{"minimum_data_quality":85,"minimum_confidence":70,"minimum_expected_value":0.05,"minimum_bookmakers":3,"maximum_price_age_minutes":15}'
);

insert into public.model_rules (id, code, name, market, phase, status) values
  (1, 'REMATCH_REVERSAL_7D', 'Rematch within 7 days — O/U reversal', 'OU', 'PREMATCH', 'DEFINITION_REQUIRED'),
  (2, 'REMATCH_CONTINUATION_14D', 'Rematch in 8–14 days — O/U continuation', 'OU', 'PREMATCH', 'EXPERIMENTAL'),
  (3, 'SAME_VENUE_PRICE_REPEAT', 'Same venue rematch — price repeat', 'AH', 'PREMATCH', 'EXPERIMENTAL'),
  (4, 'REVERSED_VENUE_RECOVERY', 'Reversed venue rematch — price recovery', 'AH', 'PREMATCH', 'EXPERIMENTAL'),
  (5, 'DOUBLE_ZERO_DRAW_OVER', 'Two consecutive 0–0 league draws', 'OU', 'PREMATCH', 'EXPERIMENTAL'),
  (6, 'TRIPLE_ONE_DRAW_OVER', 'Three consecutive 1–1 results', 'OU', 'PREMATCH', 'EXPERIMENTAL'),
  (7, 'DOUBLE_TWO_ZERO_PROFILE', 'Two consecutive 2–0 first-half profiles', 'OU', 'PREMATCH', 'EXPERIMENTAL'),
  (8, 'TWO_RED_NO_GOAL_OVER', 'Two red cards with no subsequent goal', 'OU', 'PREMATCH', 'EXPERIMENTAL'),
  (9, 'CLUB_IDENTITY_PATTERN', 'Club identity / animal-pattern experiment', 'OU', 'PREMATCH', 'DEFINITION_REQUIRED'),
  (10, 'MANAGER_CRITICISM_SIGNAL', 'Manager criticism news signal', 'AH', 'PREMATCH', 'DEFINITION_REQUIRED'),
  (11, 'NEW_MANAGER_CONTEXT', 'New-manager first-match context', null, 'PREMATCH', 'DEFINITION_REQUIRED'),
  (12, 'MINUTE_SEVEN_LIVE_TOTAL', 'Minute-seven live total pattern', 'OU', 'LIVE', 'DISABLED');

alter table public.regions enable row level security;
alter table public.competitions enable row level security;
alter table public.teams enable row level security;
alter table public.fixtures enable row level security;
alter table public.bookmakers enable row level security;
alter table public.odds_snapshots enable row level security;
alter table public.model_versions enable row level security;
alter table public.model_rules enable row level security;
alter table public.model_runs enable row level security;
alter table public.final_picks enable row level security;
alter table public.settlements enable row level security;
alter table public.job_runs enable row level security;
alter table public.notification_logs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

create view public.public_current_picks
with (security_invoker = false)
as
select
  p.id,
  r.code as region,
  c.country,
  c.name as competition,
  f.kickoff_at,
  to_char(p.session_time, 'HH24:MI') as session_time,
  ht.name as home_team,
  at.name as away_team,
  p.market::text as market,
  p.selection,
  case when p.line is null then null else trim(to_char(p.line, 'FM999990.00')) end as line,
  p.decimal_odds,
  p.model_probability,
  p.market_probability,
  p.expected_value,
  p.confidence,
  p.data_quality,
  p.risk_flag::text as risk_flag,
  p.status::text as status,
  coalesce(array(select jsonb_array_elements_text(p.signals)), '{}') as signals
from public.final_picks p
join public.fixtures f on f.id = p.fixture_id
join public.competitions c on c.id = f.competition_id
join public.regions r on r.id = c.region_id
join public.teams ht on ht.id = f.home_team_id
join public.teams at on at.id = f.away_team_id
where p.status in ('OPEN', 'PENDING')
  and f.kickoff_at >= now() - interval '3 hours'
order by f.kickoff_at;

create view public.public_results
with (security_invoker = false)
as
select
  p.id,
  p.published_at,
  f.kickoff_at,
  r.code as region,
  c.country,
  c.name as competition,
  ht.name as home_team,
  at.name as away_team,
  p.market::text as market,
  p.selection,
  p.line,
  p.decimal_odds,
  p.stake_units,
  s.result::text as result,
  s.home_score,
  s.away_score,
  s.profit_units,
  s.settled_at,
  mv.version as model_version
from public.settlements s
join public.final_picks p on p.id = s.pick_id
join public.fixtures f on f.id = p.fixture_id
join public.competitions c on c.id = f.competition_id
join public.regions r on r.id = c.region_id
join public.teams ht on ht.id = f.home_team_id
join public.teams at on at.id = f.away_team_id
join public.model_versions mv on mv.id = p.model_version_id;

grant usage on schema public to anon, authenticated;
grant select on public.public_current_picks, public.public_results to anon, authenticated;

comment on view public.public_current_picks is 'Public, non-sensitive projection used by the GitHub Pages frontend.';
comment on view public.public_results is 'Public graded results with immutable selection price and model version.';

commit;
