# Vercel Deploy — FMC

This repo is wired so Vercel can deploy it with **zero UI configuration**. The included root `vercel.json` tells Vercel how to find and build the client app inside `client/`.

## What's already set up

- ✅ Root `vercel.json` — builds the client, outputs to `client/dist`, SPA fallback
- ✅ Root `package.json` `build` script — installs client deps and builds in one go
- ✅ `.gitignore` — `node_modules`, `dist`, `.env`, logs excluded
- ✅ Login is fully client-side (demo creds, no backend needed)

## Step-by-step

### 1. Commit and push to GitHub

```powershell
cd C:\React-Project\FMC
git add .
git commit -m "Football Match Scrapper UI — ready for Vercel"
git push -u origin main
```

> If `main` branch doesn't exist yet: `git branch -M main` before pushing.

### 2. Import on Vercel

1. Open https://vercel.com/new
2. Sign in with GitHub
3. Pick the **FMC** repo → **Import**
4. **Don't change any settings.** The root `vercel.json` already configures everything:
   - Build Command → `npm run build`
   - Output Directory → `client/dist`
   - Install Command → skipped (build script installs client deps)
5. Click **Deploy**

Build runs in ~30-60 seconds. You'll get a live URL like `https://fmc-<random>.vercel.app`.

### 3. Login on the deployed site

| Email | Password |
| --- | --- |
| `admin@football.com` | `admin123` |
| `analyst@football.com` | `analyst123` |

Validation is client-side (no server call).

## Notes

- `server/` is **not deployed** to Vercel. It stays in the repo so you can wire up real scraping later (Render, Railway, or convert to Vercel serverless).
- Every push to `main` triggers an automatic redeploy.
- To redeploy manually: open the project in Vercel dashboard → **Deployments** → ⋯ → **Redeploy**.

## Verify locally before pushing

```powershell
cd C:\React-Project\FMC
npm run build
# Should produce client/dist/index.html + client/dist/assets/*
```
