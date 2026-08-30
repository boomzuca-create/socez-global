begin;

create table if not exists public.market_candidates (
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
  market_score smallint not null check (market_score between 0 and 100),
  data_quality smallint not null check (data_quality between 0 and 100),
  risk_flag public.risk_flag not null,
  tier text not null check (tier in ('QUALIFIED', 'CONDITIONAL', 'BEST_AVAILABLE')),
  criteria jsonb not null default '{}'::jsonb,
  signals jsonb not null default '[]'::jsonb,
  price_locked_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists market_candidates_run_selection_key
on public.market_candidates (
  model_run_id,
  fixture_id,
  market,
  selection,
  coalesce(line, -9999::numeric)
);

create index if not exists market_candidates_fixture_created_idx
on public.market_candidates (fixture_id, created_at desc);

alter table public.market_candidates enable row level security;
revoke all on public.market_candidates from anon, authenticated;

-- Market-led records created before the SOCEZ hard gate are research data,
-- not SOCEZ Final Picks, and must not remain visible on the public view.
update public.final_picks
set status = 'VOID'
where status in ('OPEN', 'PENDING')
  and evidence ->> 'scope' = 'MARKET_LED_SELECTION_V1';

comment on table public.market_candidates is
  'Private research candidates. These records are never public Final Picks without SOCEZ 1-11 rule evidence.';

commit;
