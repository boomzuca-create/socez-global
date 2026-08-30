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
