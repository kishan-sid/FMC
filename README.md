# Football Match Scrapper

Full-stack starter: React (Vite + Tailwind) frontend + Express backend, runnable together with one command.

## Structure

```
Football-Match-Scrapper/
├── client/      # React + Vite + Tailwind
├── server/      # Express API (ES modules)
└── package.json # Root: concurrently runs both
```

## Setup

```powershell
npm run install:all
```

## Run (dev — both together)

```powershell
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:5000
- Vite proxies `/api/*` → server, so frontend calls `/api/...` directly.

## Useful scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run server + client together |
| `npm run dev:server` | Only backend |
| `npm run dev:client` | Only frontend |
| `npm run build` | Build client for production |
| `npm start` | Start server (after building client) |
