# Deploy — FMC

The app is split across three environments:

- **Client (React)** → static build hosted on Vercel
- **Enqueue API** → Vercel serverless function at `api/scrape/start.mjs`
  (only creates the job row in Supabase; does NOT run the scrape)
- **Scrape worker** → Node process running on a residential-IP machine,
  polling Supabase for queued jobs and executing the scrape pipeline
  (Playwright + Chromium)

## Why a local worker?

Sources like `matchcenter.football.ch` and `matchcenter.afv.ch` are protected
by Cloudflare and explicitly block all known cloud-provider IP ranges
(Vercel, AWS, GCP, etc.) regardless of headers or behavior. Free public
proxies and free-tier scraping APIs cannot reliably bypass this.

The only free, reliable answer is to send the outbound HTTP requests from a
residential IP — i.e. a regular home or office machine. So scraping runs in
a small Node worker on that machine, and Vercel just handles the UI and the
"please scrape this URL" enqueue request.

The UI subscribes to Supabase realtime on `scrape_jobs` /
`scrape_job_steps`, so it sees worker progress live with no extra
infrastructure.

## Step-by-step

### 1. Apply the worker DB migration

In **Supabase → SQL Editor**, run the contents of
`supabase/migrations/20260526000000_worker_heartbeat.sql`. This adds
`claimed_at`, `heartbeat_at`, and `worker_id` columns to `scrape_jobs`
plus the supporting indexes.

### 2. Push UI + enqueue API to Vercel

```powershell
git add .
git commit -m "Worker architecture"
git push
```

Vercel will redeploy the static client and the now-tiny
`api/scrape/start.mjs` (which just enqueues).

### 3. Set environment variables in Vercel

Open **Vercel → Project → Settings → Environment Variables** and confirm
these are set (you should already have them from the previous deployment):

| Name | Value | Environments |
| --- | --- | --- |
| `SUPABASE_URL` | `https://zqazejdkjpilckclaxkp.supabase.co` | Production, Preview, Development |
| `SUPABASE_ANON_KEY` | (from `client/.env`) | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY` | (from `server/.env`) | Production, Preview, Development |
| `VITE_SUPABASE_URL` | same as `SUPABASE_URL` | Production, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | same as `SUPABASE_ANON_KEY` | Production, Preview, Development |
| `SCRAPE_DO_API_KEY` | (from `server/.env`) | Production, Preview, Development |

When `SCRAPE_DO_API_KEY` is set, `api/scrape/start.mjs` runs the full
pipeline on Vercel using scrape.do's residential proxy + JS render — so
scrapes work even when the local worker is offline. Get a token at
https://dashboard.scrape.do. `ZENROWS_API_KEY` is an alternative provider
with the same behavior (scrape.do takes priority when both are set).
`SCRAPERAPI_KEY` is an optional second-tier fallback.

### 4. Set up the worker machine

This can be any machine with:

- A regular residential / office internet connection (NOT a cloud VPS)
- Node.js 18+ installed
- Always-on (or at least on whenever scrapes need to run)

Suitable: a desktop PC, an old laptop, a Raspberry Pi 4+, a NAS that runs
Docker.

#### Clone and install

```powershell
git clone <repo-url> C:\React-Project\FMC
cd C:\React-Project\FMC
npm run install:all
npx playwright install chromium
```

(`npx playwright install chromium` downloads the headless browser. Only
needed once per machine.)

#### Configure environment

Create `server/.env` with:

```
SUPABASE_URL=https://zqazejdkjpilckclaxkp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<copy from Supabase → Project Settings → API>
```

The worker uses the service role key, so it bypasses RLS and can write
results back for any user that submits a scrape job.

#### Smoke test

```powershell
npm run worker --prefix server
```

You should see:

```
[worker] started · id=<hostname>-<pid> · poll=3000ms
```

From the live UI, submit a scrape. Within ~3 seconds the worker logs:

```
[worker] claimed job <uuid> · <source_url>
[worker] completed job <uuid>
```

Stop with `Ctrl+C`.

### 5. Run the worker permanently with PM2

```powershell
npm install -g pm2 pm2-windows-startup
pm2-startup install
cd C:\React-Project\FMC\server
pm2 start src/worker.js --name fmc-worker --max-memory-restart 800M
pm2 save
```

PM2 will now:

- Auto-restart the worker if it crashes
- Auto-start the worker when Windows boots
- Capture logs at `C:\Users\<you>\.pm2\logs\fmc-worker-out.log`

Useful commands:

| Command | What it does |
| --- | --- |
| `pm2 status` | See worker process state |
| `pm2 logs fmc-worker` | Tail live logs |
| `pm2 restart fmc-worker` | Manual restart (e.g. after `git pull`) |
| `pm2 stop fmc-worker` | Stop the worker |
| `pm2 delete fmc-worker` | Remove from PM2 (does NOT auto-restart anymore) |

### 6. Test end-to-end

1. Open the live URL (`fmc-rho-vert.vercel.app`)
2. Log in
3. Paste a Cloudflare-protected URL (e.g. `matchcenter.football.ch/...`)
4. Click **Start Scrape**
5. The pipeline progresses through all 6 steps; the export appears in
   Recent Exports

If the worker is off, the job stays in `queued` status indefinitely. Start
the worker and it picks up the queue.

## Local development

Local dev mirrors production: the Express server handles enqueue requests,
and a separate worker process (started by the same `npm run dev`) executes
them.

```powershell
npm run dev
```

This runs three processes via `concurrently`:

- **SERVER** (`:5000`) — enqueue API
- **WORKER** — polls Supabase, runs scrapes
- **CLIENT** (`:5173`) — Vite dev server

Vite proxies `/api/*` to `:5000`. The worker writes results back to
Supabase, and the client sees them via realtime subscriptions.

To run individually:

```powershell
npm run dev:server    # express enqueue API only
npm run dev:worker    # worker only
npm run dev:client    # vite UI only
```

## Pipeline routing

| URL pattern | Backend |
| --- | --- |
| `*.openligadb.de` | Supabase Edge Function `scrape-tick` (free API extractor) |
| `*.kicker.de` | Supabase Edge Function `scrape-tick` |
| Everything else | Vercel enqueue → local worker (Playwright) |

## Troubleshooting

**Scrape stays "Queued" forever**
Worker is off. Check `pm2 status` on the worker machine. If the worker
process is missing or stopped, `pm2 restart fmc-worker`. Worker offline =
nothing in the queue gets processed.

**Job marked "failed" with "Worker crashed (no heartbeat for >90s)"**
The worker process exited mid-scrape (OOM, network loss, machine reboot).
PM2 will restart it automatically; resubmit the job manually. The
heartbeat check prevents orphan jobs from sitting in `running` state
forever.

**HTTP 405 on `/api/scrape/start` in production**
Check `vercel.json` rewrites — current config excludes `/api/`. Redeploy
from the Vercel dashboard.

**`SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars missing on Vercel`**
Re-check step 3 above, then redeploy so the function picks up the new env.

**Worker logs "Cannot find module 'playwright'"**
Run `npm install` inside `server/` and then `npx playwright install
chromium` on the worker machine.
