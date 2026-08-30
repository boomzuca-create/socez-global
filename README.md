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
