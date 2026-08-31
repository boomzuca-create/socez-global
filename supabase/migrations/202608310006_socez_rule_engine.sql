begin;

create table public.socez_rule_evaluations (
  id uuid primary key default gen_random_uuid(),
  model_run_id uuid not null references public.model_runs(id) on delete cascade,
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  model_version_id uuid not null references public.model_versions(id),
  rule_id smallint not null references public.model_rules(id),
  status text not null check (status in ('MATCH', 'NO_MATCH', 'INSUFFICIENT_DATA')),
  recommended_market public.market_type,
  recommended_selection text,
  evidence_strength smallint not null default 0 check (evidence_strength between 0 and 100),
  evidence jsonb not null default '{}'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now(),
  unique (model_run_id, fixture_id, rule_id),
  check (
    (status = 'MATCH' and recommended_market is not null and recommended_selection is not null)
    or status <> 'MATCH'
  )
);

create index socez_rule_evaluations_fixture_idx
on public.socez_rule_evaluations (fixture_id, evaluated_at desc);

create index socez_rule_evaluations_match_idx
on public.socez_rule_evaluations (model_run_id, status, rule_id);

create unique index if not exists final_picks_one_per_fixture_run
on public.final_picks (model_run_id, fixture_id);

create table public.verified_context_signals (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  rule_id smallint not null references public.model_rules(id) check (rule_id in (8, 10, 11)),
  recommended_market public.market_type not null,
  recommended_selection text not null,
  confidence smallint not null check (confidence between 0 and 100),
  source_tier text not null check (source_tier in ('TIER1', 'TIER2', 'TIER3')),
  source_url text not null check (source_url ~ '^https://'),
  source_published_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (fixture_id, rule_id, source_url),
  check (expires_at > verified_at)
);

create index verified_context_signals_fixture_idx
on public.verified_context_signals (fixture_id, rule_id, expires_at desc);

create table public.club_identity_profiles (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null unique references public.teams(id) on delete cascade,
  identity_type text not null check (identity_type in ('BIRD', 'ANIMAL')),
  identity_label text not null,
  source_url text not null check (source_url ~ '^https://'),
  verified_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.socez_rule_evaluations enable row level security;
alter table public.verified_context_signals enable row level security;
alter table public.club_identity_profiles enable row level security;

revoke all on public.socez_rule_evaluations, public.verified_context_signals, public.club_identity_profiles
from anon, authenticated;

update public.model_versions
set status = 'RETIRED'
where status = 'ACTIVE';

insert into public.model_versions (version, name, status, weights, thresholds, activated_at)
values (
  '1.1.0',
  'SOCEZ 11-Rule Evidence Model',
  'ACTIVE',
  '{"socez_rule_engine":1.0,"market_confirmation":0.0}'::jsonb,
  '{"minimum_rule_matches":1,"positive_expected_value_required":true,"best_available_forbidden":true,"conflicting_rule_directions":"reject","maximum_picks_per_fixture":1}'::jsonb,
  now()
)
on conflict (version) do update
set name = excluded.name,
    status = 'ACTIVE',
    weights = excluded.weights,
    thresholds = excluded.thresholds,
    activated_at = coalesce(public.model_versions.activated_at, excluded.activated_at);

update public.model_rules
set status = 'ACTIVE',
    definition = case id
      when 1 then '{"window_days":{"min":0,"max":7},"input":"latest completed head-to-head and its verified closing O/U line","decision":"reverse the previous decisive O/U result","missing_data":"INSUFFICIENT_DATA"}'::jsonb
      when 2 then '{"window_days":{"min_exclusive":7,"max":14},"input":"latest completed head-to-head and its verified closing O/U line","decision":"continue the previous decisive O/U result","missing_data":"INSUFFICIENT_DATA"}'::jsonb
      when 3 then '{"window_days":{"min":0,"max":7},"venue":"same home-away orientation","decision":"previous outright winner to cover Asian Handicap"}'::jsonb
      when 4 then '{"window_days":{"min":0,"max":7},"venue":"reversed home-away orientation","input":"verified closing Asian Handicap","decision":"previous handicap loser to cover"}'::jsonb
      when 5 then '{"scope":"same competition","sequence":["0-0","0-0"],"decision":"OVER"}'::jsonb
      when 6 then '{"scope":"all competitions","sequence":["1-1","1-1","1-1"],"decision":"OVER"}'::jsonb
      when 7 then '{"scope":"two latest matches","sequence":["2-0 FT and 2-0 HT","2-0 FT and 2-0 HT"],"decision":"OVER"}'::jsonb
      when 8 then '{"input":"verified previous-match event timeline","condition":"two total red cards and no goal after the second red","decision":"OVER","source_requirement":"TIER1"}'::jsonb
      when 9 then '{"input":"verified club identity profile for both clubs","condition":"bird or animal identity matchup","decision":"OVER","source_requirement":"TIER1"}'::jsonb
      when 10 then '{"input":"verified public manager criticism of an opponent player","decision":"criticising manager team not to cover","source_requirement":"TIER1"}'::jsonb
      when 11 then '{"input":"verified first match for a new manager and club-size context","decisions":{"big_vs_big":"OVER","small_new_manager_vs_big":"new manager side to cover"},"source_requirement":"TIER1"}'::jsonb
      else definition
    end,
    minimum_sample_size = 1
where id between 1 and 11;

update public.model_rules
set status = 'DISABLED'
where id = 12;

comment on table public.socez_rule_evaluations is
  'Private, auditable evaluation of all 11 SOCEZ pre-match rules for every scanned fixture.';
comment on table public.verified_context_signals is
  'Private verified inputs for SOCEZ rules 8, 10 and 11. Tier 1 is required for a match.';
comment on table public.club_identity_profiles is
  'Private verified club identity dictionary used by SOCEZ rule 9; no inferred identities are permitted.';

commit;
