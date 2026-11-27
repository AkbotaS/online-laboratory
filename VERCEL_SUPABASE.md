# Vercel + Supabase

The browser UI remains a static deployment on Vercel. All `/api/*` requests are handled by `api/[...path].js`, and the server-side handler uses Supabase PostgREST with a secret server key. The project never calls Supabase directly from browser code.

## Database schema

Run `supabase/migrations/202611270001_online_laboratory.sql` once in the Supabase project's SQL Editor. The four tables have Row Level Security enabled and no `anon` or `authenticated` policies. Only the server-side `service_role` key can read or write them.

## Vercel environment

In the existing Vercel project `biology-lab-2026`, add these Production environment variables:

- `SUPABASE_URL`: `https://spurotpsncgsdrhrhkec.supabase.co`
- `SUPABASE_SECRET_KEY`: the project's server-side secret key (usually begins with `sb_secret_`). Keep it secret; never prefix it with `NEXT_PUBLIC_` and never commit it. The older `SUPABASE_SERVICE_ROLE_KEY` variable is also accepted if the project only has a legacy key.

Then redeploy the production branch. `/api/health` should return `ok: true`, `databaseConfigured: true`, and `adminConfigured: true` after migration.

## One-time migration

After the schema exists and before opening the new API to students, migrate the current project data using `scripts/migrate-supabase.mjs`. It inserts the existing scrypt password hashes, curriculum, settings, and analytics without deleting rows. Existing rows that differ from the selected source cause the script to stop instead of overwriting them. The current `data/learning-analytics` contains the same two accounts and curriculum as the protected backup, plus 14 additional raw events, so use the current directory to preserve the fuller event history. Keep the backup unchanged. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` only in the local process environment for the migration; do not add them to source control.

By default the script reads `data/learning-analytics`. A preserved copy can be selected by passing its `learning-analytics` directory as the first argument.
