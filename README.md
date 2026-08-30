# SOCEZ Global

Global Football Pattern & Value analytics dashboard. The frontend is a static React/Vite application deployed to GitHub Pages; Supabase owns the database, public API views, Edge Functions and scheduled processing.

## Milestone 1

- Investment-grade responsive dashboard
- 11:00 and 18:00 qualified-pick sessions
- Regional performance overview
- Results, Model Lab and System Health views
- Supabase client with honest preview-data fallback
- Initial database schema, RLS and public read-only views
- Tested 1X2, Asian Handicap and O/U quarter-line settlement helpers
- GitHub Actions verification and Pages deployment

## Milestone 2

- API-Football normalization adapter
- Secure Supabase Edge Function for fixture ingestion
- Bangkok 11:00–18:00 and 18:00–05:00 session filtering
- Provider job idempotency and audit logging
- Live regional metrics and cumulative-profit views
- Dashboard separation between real Supabase data and illustrative preview data

## Milestone 3

- Quota-aware API-Football pre-match odds ingestion
- Strict normalization for 1X2, Asian Handicap and Goals O/U
- Approved global bookmaker set: Bet365, Pinnacle, Betfair, William Hill and Unibet
- Deterministic snapshot identity so retries cannot duplicate line-less 1X2 prices
- Free-plan provider limit of three odds pages per date is recorded in `job_runs`; incomplete coverage never produces guessed picks

## Milestone 4

- Primary prices still prefer Bet365, Pinnacle, Betfair, William Hill and Unibet
- Other API-Football bookmakers are retained as explicit lower-weight fallback sources instead of being silently discarded
- Market-led ranking removes bookmaker margin and compares consensus fair probability with the best available price
- Every match may publish one Primary Bet, with no daily or per-session pick ceiling when multiple matches pass the threshold
- Free-plan odds calls are targeted directly at in-scope fixtures (up to 40 per session) so the page limit is not wasted on out-of-scope competitions
- Every published card shows the overall SOCEZ score and criterion percentages: value, consensus, bookmaker coverage, data quality and freshness
- Scores at 75% or above are qualified investments; 70–74% are conditional; when none reaches 70%, one clearly labelled Best Available candidate is published
- A blank day is allowed only when there is no complete usable 1X2, Handicap or O/U market—not merely because no source from the primary five appears
- Fixture scope is intentionally limited to the Premier League, La Liga, Bundesliga, Ligue 1 and Serie A, plus domestic competitions in Armenia, Australia, Austria, Belgium, Denmark, Finland, Hungary, Malaysia, Mexico, Netherlands, Norway, Portugal, Scotland, Sweden, Switzerland, USA and Chile

## Local development

```bash
npm install
npm run dev
```

The public project URL and publishable key have safe built-in defaults. To override them locally, copy `.env.example` to `.env.local` and update:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

Never add a Supabase secret key, service-role key, database password, football-data provider key or LINE channel token to the frontend or repository.

## Apply the database migration

Open Supabase **SQL Editor**, copy the complete contents of:

`supabase/migrations/202608300001_initial_schema.sql`

Run it once. The migration creates the normalized data model, enables RLS and exposes only these read-only views to the public client:

- `public_current_picks`
- `public_results`

Until the migration is applied, the frontend intentionally shows clearly labelled preview data.

After Milestone 2, also run:

`supabase/migrations/202608300002_live_metrics.sql`

This adds public, aggregate-only performance and system-health views. It does not expose raw odds, provider payloads or job error details.

Before enabling Milestone 3 odds synchronization, also run:

`supabase/migrations/202608300003_odds_snapshot_key.sql`

This adds a deterministic private snapshot key used for idempotent odds ingestion.

## API-Football ingestion

The `sync-fixtures` Edge Function uses the official API-Football v3 endpoint and keeps provider credentials server-side.

Required Supabase function secrets:

```text
API_FOOTBALL_KEY=your_api_football_key
CRON_SECRET=a_long_random_value
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied automatically by the hosted Supabase Functions runtime. Never copy them into frontend code.

Deploy with the Supabase CLI after linking the project:

```bash
supabase link --project-ref qkiradbwrajrqgnyjhvd
supabase secrets set API_FOOTBALL_KEY=YOUR_KEY CRON_SECRET=YOUR_RANDOM_SECRET
supabase functions deploy sync-fixtures --no-verify-jwt
```

The repository also includes `.github/workflows/deploy-supabase-functions.yml`.
For automatic deployments, create a GitHub Actions repository secret named
`SUPABASE_ACCESS_TOKEN`, then run **Deploy Supabase Edge Functions** from the
Actions tab. Future changes under `supabase/functions/` are deployed when they
reach `main`.

Authorized test call:

```bash
curl -X POST \
  "https://qkiradbwrajrqgnyjhvd.supabase.co/functions/v1/sync-fixtures?session=morning" \
  -H "x-cron-secret: YOUR_RANDOM_SECRET"
```

## GitHub Pages

1. Merge the milestone pull request into `main`.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. The `Deploy SOCEZ Global to GitHub Pages` workflow verifies and publishes `dist/`.

Expected URL:

`https://boomzuca-create.github.io/socez-global/`

## Automation schedule

Automation remains disabled until a football data provider is configured. Supabase Cron will later use Bangkok time converted to UTC:

| Function | Bangkok | UTC |
|---|---:|---:|
| Morning prediction | 11:00 | 04:00 |
| Evening prediction | 18:00 | 11:00 |
| Daily settlement | 06:00 | 23:00 previous day |

All scheduled jobs must create a unique idempotency key and write their outcome to `job_runs`.
