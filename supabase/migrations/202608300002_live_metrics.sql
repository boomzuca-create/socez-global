begin;

create view public.public_performance_summary
with (security_invoker = false)
as
select
  r.code as region,
  r.name as label,
  count(*) filter (where s.result in ('FULL_WIN', 'HALF_WIN'))::integer as wins,
  count(*) filter (where s.result in ('FULL_LOSS', 'HALF_LOSS'))::integer as losses,
  count(*) filter (where s.result in ('PUSH', 'VOID'))::integer as pushes,
  coalesce(sum(s.profit_units), 0)::numeric(12,4) as profit_units
from public.regions r
left join public.competitions c on c.region_id = r.id
left join public.fixtures f on f.competition_id = c.id
left join public.final_picks p on p.fixture_id = f.id
left join public.settlements s on s.pick_id = p.id
where r.code <> 'INTERNATIONAL'
group by r.code, r.name, r.sort_order
order by r.sort_order;

create view public.public_profit_curve
with (security_invoker = false)
as
with daily as (
  select
    (s.settled_at at time zone 'Asia/Bangkok')::date as result_date,
    sum(s.profit_units)::numeric(12,4) as daily_profit
  from public.settlements s
  group by (s.settled_at at time zone 'Asia/Bangkok')::date
)
select
  result_date,
  daily_profit,
  sum(daily_profit) over (order by result_date)::numeric(12,4) as cumulative_profit
from daily
order by result_date;

create view public.public_system_health
with (security_invoker = false)
as
select distinct on (j.job_name)
  j.job_name,
  j.status::text as status,
  j.scheduled_for,
  j.started_at,
  j.completed_at,
  j.records_processed,
  case when j.status = 'FAILED' then 'Action required' else null end as public_message
from public.job_runs j
order by j.job_name, j.scheduled_for desc;

grant select on
  public.public_performance_summary,
  public.public_profit_curve,
  public.public_system_health
to anon, authenticated;

comment on view public.public_performance_summary is 'Public regional W/L/P and profit aggregates; half outcomes are graded by direction.';
comment on view public.public_profit_curve is 'Public daily and cumulative flat-stake profit in Bangkok calendar dates.';
comment on view public.public_system_health is 'Public non-sensitive latest status for each automated job.';

commit;
