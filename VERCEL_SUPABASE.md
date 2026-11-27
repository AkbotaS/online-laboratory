# Vercel + Supabase

The browser UI remains a static deployment on Vercel. The rewrite in `vercel.json` sends all API routes, including `/api/auth/login`, to `api/laboratory.js`. The handler connects to Supabase on the server.

## Preview with existing accounts

Run `npm run preview` and open port 3000. In a fresh checkout, supply the existing database URL and a current secret key through the environment's private server settings. A preview on a trusted computer can also read the existing local `data/learning-analytics` directory. For a private copy in another location, set `ONLINE_LAB_DATA_DIR` to the directory containing `learning-analytics`. The preview uses the stored password hashes and skips admin provisioning.

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
