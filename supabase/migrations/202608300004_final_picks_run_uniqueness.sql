begin;

-- A selection may legitimately be published again by a later model run.
-- Keep the audit history across runs while preventing duplicates inside one run.
alter table public.final_picks
drop constraint if exists final_picks_fixture_id_model_version_id_market_selection_li_key;

create unique index if not exists final_picks_run_selection_key
on public.final_picks (
  model_run_id,
  fixture_id,
  market,
  selection,
  coalesce(line, -9999::numeric)
);

comment on index public.final_picks_run_selection_key is
  'Prevents duplicate selections within one model run while preserving picks from earlier runs for audit.';

commit;
