# Vercel Deploy — FMC

This repo deploys to Vercel as a full stack:

- React client → static build at `client/dist`
- Scraper → Vercel serverless function at `api/scrape/start.mjs` running
  Playwright + Lambda-compatible Chromium (`@sparticuz/chromium-min`)
- Supabase Edge Functions (for the OpenLigaDB / Kicker path) — already
  deployed independently to Supabase

## Step-by-step

### 1. Commit and push to GitHub

```powershell
cd C:\React-Project\FMC
git add .
git commit -m "Vercel-deployable scraper"
git push
```

### 2. Set environment variables in Vercel

**Required** — the scraper function will not work without these. Open
**Vercel → Project → Settings → Environment Variables** and add:

| Name | Value | Environments |
| --- | --- | --- |
| `SUPABASE_URL` | `https://zqazejdkjpilckclaxkp.supabase.co` | Production, Preview, Development |
| `SUPABASE_ANON_KEY` | (copy from `client/.env` — the `VITE_SUPABASE_ANON_KEY` value) | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY` | (copy from `server/.env`) | Production, Preview, Development |
| `VITE_SUPABASE_URL` | (same value as `SUPABASE_URL`) | Production, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | (same value as `SUPABASE_ANON_KEY`) | Production, Preview, Development |

The `VITE_*` versions are read by the client at build time; the non-prefixed
versions are read by the serverless function at runtime.

After adding, **redeploy** so the function picks up the new env (Deployments
→ ⋯ → Redeploy).

### 3. Test on the live URL

1. Open your Vercel URL (e.g. `https://fmc-rho-vert.vercel.app`)
2. Log in (`admin@football.com` / supabase password from your setup)
3. Scrape & Export → paste any URL → **Start Scrape**

The first scrape after a cold start downloads Chromium (~50 MB) and takes
~20-30 s. Subsequent scrapes are faster (~10-15 s) until the function goes
cold again.

## Pipeline routing

| URL pattern | Backend |
| --- | --- |
| `*.openligadb.de` | Supabase Edge Function `scrape-tick` (free API extractor) |
| `*.kicker.de` | Supabase Edge Function `scrape-tick` |
| Everything else | Vercel function `/api/scrape/start` (Playwright) |

## Limits

| | Vercel Hobby (free) | Vercel Pro |
| --- | --- | --- |
| Function `maxDuration` | 60 s (configured) | 300 s |
| Function memory | 1024 MB (configured) | up to 3008 MB |
| Cold start with Chromium | ~5-8 s extra | same |

If a single scrape exceeds 60 s, the function will time out. The step row
will be left in `running` state — the UI will eventually time-out its poll
loop. For long-running scrapes, upgrade to Vercel Pro and bump `maxDuration`
in `vercel.json` to 300.

## Local dev (unchanged)

```powershell
npm run dev
```

Runs Vite on `:5173` proxying `/api/*` to the local Express server on
`:5000`. The local Express server uses full `playwright` (bundled Chromium),
not the Lambda variant. Behaviour is identical, just heavier.

## Troubleshooting

**HTTP 405 on `/api/scrape/start` in production**
The function file wasn't deployed. Check `vercel.json` doesn't rewrite
`/api/*` to `index.html` — current config explicitly excludes `/api/`.
Redeploy from the dashboard.

**`SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars missing on Vercel`**
You forgot step 2 above. Add env vars, redeploy.

**`Function execution timed out`**
Cold start + Cloudflare challenge + heavy page took >60 s. Upgrade to Pro
and bump `maxDuration`, or retry (warm cache is faster).
