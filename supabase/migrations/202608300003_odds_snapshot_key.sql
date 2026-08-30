begin;

alter table public.odds_snapshots
add column snapshot_key text;

update public.odds_snapshots
set snapshot_key = encode(
  digest(
    concat_ws(
      '|',
      fixture_id::text,
      bookmaker_id::text,
      market::text,
      selection,
      coalesce(line::text, 'NO_LINE'),
      captured_at::text
    ),
    'sha256'
  ),
  'hex'
);

alter table public.odds_snapshots
alter column snapshot_key set not null;

alter table public.odds_snapshots
add constraint odds_snapshots_snapshot_key_key unique (snapshot_key);

comment on column public.odds_snapshots.snapshot_key is
  'Deterministic provider snapshot identity; prevents duplicate 1X2 rows where line is null.';

commit;
