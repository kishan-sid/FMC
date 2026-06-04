// Live football data via API-Football (api-sports.io v3).
//
// The server holds the API key (never exposed to the browser) and proxies a
// small set of endpoints the UI needs. A short in-memory cache keeps us well
// inside the free tier (100 requests/day): the "all live matches" list is one
// request shared by every visitor, and per-match lineups/events are cached too.
//
//   GET /api/live/matches            → all in-play matches (score, league, clock)
//   GET /api/live/by-date?date=YYYY-MM-DD → fixtures for a day
//   GET /api/live/fixture/:id        → one fixture + lineups + events (who's on)
//   GET /api/live/status             → key present? remaining quota (best-effort)
import { Router } from "express";
import axios from "axios";

const router = Router();

const API_BASE = "https://v3.football.api-sports.io";
const KEY = () => process.env.API_FOOTBALL_KEY || "";

// ---- tiny TTL cache -------------------------------------------------
const cache = new Map(); // key -> { at, ttl, data }
function getCached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  return null;
}
function setCached(key, data, ttl) {
  cache.set(key, { at: Date.now(), ttl, data });
}

async function apiGet(path, params, { ttl = 30000, cacheKey } = {}) {
  const key = cacheKey || `${path}?${new URLSearchParams(params || {})}`;
  const cached = getCached(key);
  if (cached) return cached;
  if (!KEY()) {
    const err = new Error("API_FOOTBALL_KEY is not set on the server");
    err.status = 503;
    throw err;
  }
  const res = await axios.get(`${API_BASE}${path}`, {
    params,
    headers: { "x-apisports-key": KEY() },
    timeout: 15000,
  });
  setCached(key, res.data, ttl);
  return res.data;
}

// ---- mappers: API-Football shape → compact UI shape -----------------
function mapFixture(f) {
  const fx = f.fixture || {};
  const lg = f.league || {};
  const t = f.teams || {};
  const g = f.goals || {};
  return {
    id: fx.id,
    date: fx.date,
    status: fx.status?.short || "NS",        // NS, 1H, HT, 2H, FT, LIVE…
    statusLong: fx.status?.long || "",
    elapsed: fx.status?.elapsed ?? null,     // live minute
    venue: fx.venue?.name || "",
    league: { id: lg.id, name: lg.name, country: lg.country, logo: lg.logo, round: lg.round },
    home: { id: t.home?.id, name: t.home?.name, logo: t.home?.logo, score: g.home },
    away: { id: t.away?.id, name: t.away?.name, logo: t.away?.logo, score: g.away },
  };
}

const LIVE_STATUSES = new Set(["1H", "2H", "ET", "BT", "P", "LIVE", "HT"]);
export function isLive(short) { return LIVE_STATUSES.has(short); }

// ---- routes ---------------------------------------------------------

// All in-play matches worldwide — ONE upstream request, cached 20s.
router.get("/matches", async (_req, res) => {
  try {
    const data = await apiGet("/fixtures", { live: "all" }, { ttl: 20000, cacheKey: "live:all" });
    const matches = (data.response || []).map(mapFixture);
    res.json({ count: matches.length, matches });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, matches: [] });
  }
});

// Fixtures for a given day (default today).
router.get("/by-date", async (req, res) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    const data = await apiGet("/fixtures", { date }, { ttl: 120000, cacheKey: `date:${date}` });
    const matches = (data.response || []).map(mapFixture);
    res.json({ date, count: matches.length, matches });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, matches: [] });
  }
});

// One fixture: details + lineups (who is on the pitch / bench) + events.
router.get("/fixture/:id", async (req, res) => {
  try {
    const id = String(req.params.id).replace(/\D/g, "");
    if (!id) return res.status(400).json({ error: "invalid fixture id" });

    // Live matches change fast → short TTL; finished matches → long TTL.
    const [fxData, lineupData, eventData] = await Promise.all([
      apiGet("/fixtures", { id }, { ttl: 30000, cacheKey: `fx:${id}` }),
      apiGet("/fixtures/lineups", { fixture: id }, { ttl: 30000, cacheKey: `lu:${id}` }),
      apiGet("/fixtures/events", { fixture: id }, { ttl: 30000, cacheKey: `ev:${id}` }),
    ]);

    const fixture = (fxData.response || [])[0] ? mapFixture(fxData.response[0]) : null;
    const lineups = (lineupData.response || []).map((l) => ({
      teamId: l.team?.id,
      teamName: l.team?.name,
      teamLogo: l.team?.logo,
      formation: l.formation || "",
      coach: l.coach?.name || "",
      startXI: (l.startXI || []).map((p) => ({
        num: p.player?.number, name: p.player?.name, pos: p.player?.pos, grid: p.player?.grid,
      })),
      substitutes: (l.substitutes || []).map((p) => ({
        num: p.player?.number, name: p.player?.name, pos: p.player?.pos,
      })),
    }));
    const events = (eventData.response || []).map((e) => ({
      minute: e.time?.elapsed ?? 0,
      extra: e.time?.extra ?? null,
      teamId: e.team?.id,
      teamName: e.team?.name,
      player: e.player?.name,
      assist: e.assist?.name,
      type: e.type,        // Goal, Card, subst
      detail: e.detail,    // Normal Goal, Yellow Card, Substitution…
    }));

    res.json({ fixture, lineups, events });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get("/status", (_req, res) => {
  res.json({ configured: Boolean(KEY()) });
});

export default router;
