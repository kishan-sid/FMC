# Supabase

## Layout
```
supabase/
  config.toml
  migrations/
    20260519000000_init_schema.sql       # 8 module tables + auth trigger
    20260519000100_indexes_rls.sql       # indexes + RLS policies
    20260519000200_scrape_pipeline.sql   # scrape_jobs / steps / match_urls / intervals + realtime
    20260519000300_storage_bucket.sql    # private `exports` bucket + RLS
  functions/
    _shared/                             # cors, http, supabase client helpers
    bootstrap-profile/                   # ensure a profile row exists for the caller
    scrape-start/                        # create a scrape_jobs row + seed 6 steps
    scrape-tick/                         # advance ONE pending step (worker)
    scrape-cancel/                       # cancel a running job
    generate-export/                     # standalone export builder + Storage upload
    export-signed-url/                   # signed download URL for an exports row
    scrape-matchday/                     # (deprecated — superseded by scrape-start)
  scripts/
    confirm_users.sql                    # one-off: confirm seed users' emails
```

## Apply migrations
```
npx supabase link --project-ref zqazejdkjpilckclaxkp
npx supabase db push
```
Or paste each file into the Dashboard SQL Editor in numeric order.

## Deploy edge functions
```
npx supabase functions deploy bootstrap-profile
npx supabase functions deploy scrape-start
npx supabase functions deploy scrape-tick
npx supabase functions deploy scrape-cancel
npx supabase functions deploy generate-export
npx supabase functions deploy export-signed-url
```

The functions read `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` from the project secrets. Set them with:
```
npx supabase secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
```

## Endpoints — Scrape & Export pipeline

| Function | Method | Body | Returns |
|---|---|---|---|
| `scrape-start`      | POST | `{ source_url, source_type? }`       | `{ job, steps }` |
| `scrape-tick`       | POST | `{ job_id }`                          | `{ job, step }` — call repeatedly until `job.status === 'done'` |
| `scrape-cancel`     | POST | `{ job_id }`                          | `{ job }` |
| `generate-export`   | POST | `{ matchday_id?, format? }`           | `{ export }` |
| `export-signed-url` | POST | `{ export_id, expires_in? }`          | `{ url, expires_in, file, size_bytes }` |

### Typical UI flow
1. User pastes a URL → frontend calls `scrape-start`.
2. Frontend subscribes to `scrape_jobs` + `scrape_job_steps` on Realtime
   (already added to `supabase_realtime` publication by migration 0002).
3. A worker (cron, manual loop, or the UI itself) calls `scrape-tick`
   repeatedly until the job reports `done`.
4. The final tick (step 6) builds a CSV, uploads it to the `exports`
   bucket, and writes an `exports` row.
5. To download, the frontend calls `export-signed-url` and opens the
   returned URL.

## Tables (all user-scoped via RLS)
- `profiles`               — 1:1 with `auth.users`
- `matchdays`              — Spieltag entries
- `matches`                — fixture rows
- `players`                — player catalogue
- `match_events`           — goals / cards / subs
- `match_lineups`          — starter + bench per match (raw)
- `player_match_intervals` — computed on-pitch intervals + goals math
- `exports`                — generated report files (metadata)
- `activity_log`           — dashboard feed
- `scrape_jobs`            — pipeline run header
- `scrape_job_steps`       — 6 rows per job (live progress)
- `match_urls`             — URLs extracted from a matchday page
