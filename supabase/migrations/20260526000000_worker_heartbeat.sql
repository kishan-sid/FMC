-- Worker architecture columns.
-- The scrape pipeline no longer runs inside the Vercel function (datacenter
-- IPs blocked by Cloudflare-protected sources). It is now executed by a
-- local worker (server/src/worker.js) that polls this table for queued jobs.
--
-- claimed_at + worker_id record which worker picked up the job; heartbeat_at
-- lets us detect crashed workers and re-queue or fail their orphan jobs.

alter table scrape_jobs
  add column if not exists claimed_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists worker_id text;

create index if not exists idx_scrape_jobs_status_created
  on scrape_jobs (status, created_at);

create index if not exists idx_scrape_jobs_heartbeat
  on scrape_jobs (heartbeat_at)
  where status = 'running';
