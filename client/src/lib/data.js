// Live data layer — reads scraped results from Supabase.
//
// Each fetcher returns data already mapped into the shape the views expect
// (the same shape the demo `mockData.js` used), so the presentational
// components stay unchanged. When a query returns nothing (e.g. no scrape has
// run yet) the caller can fall back to the sample data so the UI still renders.
import { supabase } from "./supabase.js";

// Deterministic team colour from the team name (DB doesn't store colours).
const PALETTE = [
  "#dc0000", "#fde100", "#e30613", "#1961b5", "#65b32e", "#c8102e",
  "#1d9053", "#eb1923", "#5b5b5b", "#ba3733", "#dd0741", "#e32219",
];
export function colorForTeam(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const mapStatus = (s) =>
  s === "scraped" || s === "complete" ? "scraped"
  : s === "running" ? "running"
  : "queued";

export async function fetchSummary() {
  const [{ count: matches }, { count: players }, { count: events }, { count: mds }] =
    await Promise.all([
      supabase.from("matches").select("id", { count: "exact", head: true }),
      supabase.from("players").select("id", { count: "exact", head: true }),
      supabase.from("match_events").select("id", { count: "exact", head: true }),
      supabase.from("matchdays").select("id", { count: "exact", head: true }),
    ]);
  const { data: lastExport } = await supabase
    .from("exports").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!matches && !players && !events) return null; // nothing scraped yet
  return {
    matchesScraped: matches ?? 0,
    playersTracked: players ?? 0,
    eventsParsed: events ?? 0,
    matchdaysScraped: mds ?? 0,
    successRate: 100,
    lastRun: lastExport?.created_at ? lastExport.created_at.slice(0, 16).replace("T", " ") : "—",
  };
}

export async function fetchMatchdays() {
  const { data } = await supabase
    .from("matchdays")
    .select("id, label, date, matches, scraped, status")
    .order("date", { ascending: false });
  return data ?? [];
}

export async function fetchMatches(matchdayId) {
  let q = supabase
    .from("matches")
    .select("id, matchday_id, kickoff, venue, competition, status, events_count, home_code, home_name, home_score, away_code, away_name, away_score")
    .order("kickoff", { ascending: true });
  if (matchdayId) q = q.eq("matchday_id", matchdayId);
  const { data } = await q;
  return (data ?? []).map((m) => ({
    id: m.id,
    matchday: m.matchday_id,
    date: m.kickoff ? m.kickoff.slice(0, 16).replace("T", " ") : "",
    venue: m.venue || "",
    competition: m.competition || "Match",
    status: mapStatus(m.status),
    eventsCount: m.events_count || 0,
    home: { code: m.home_code || "?", name: m.home_name || "Home", color: colorForTeam(m.home_name), score: m.home_score },
    away: { code: m.away_code || "?", name: m.away_name || "Away", color: colorForTeam(m.away_name), score: m.away_score },
  }));
}

export async function fetchMatchDetail(matchId) {
  let match;
  if (matchId) {
    const { data } = await supabase.from("matches").select("*").eq("id", matchId).maybeSingle();
    match = data;
  }
  if (!match) {
    // Default to the most recently kicked-off scraped match.
    const { data } = await supabase
      .from("matches").select("*").eq("status", "scraped")
      .order("kickoff", { ascending: false }).limit(1).maybeSingle();
    match = data;
  }
  if (!match) return null;

  const [{ data: events }, { data: lineups }] = await Promise.all([
    supabase.from("match_events").select("*").eq("match_id", match.id).order("minute", { ascending: true }),
    supabase.from("match_lineups").select("*").eq("match_id", match.id),
  ]);

  const side = (team) => (lineups ?? []).filter((l) => l.team === team);
  const toPlayer = (l) => ({
    num: l.shirt_num ?? "", name: l.player_name, position: l.position || "",
    minutesOn: l.minutes_on ?? 0, minutesOff: l.minutes_off ?? 90,
    goalsFor: l.goals_for ?? 0, goalsAgainst: l.goals_against ?? 0,
  });

  return {
    id: match.id,
    date: match.kickoff ? match.kickoff.slice(0, 16).replace("T", " ") : "",
    venue: match.venue || "",
    competition: match.competition || "Match",
    referee: match.referee || "—",
    attendance: match.attendance || 0,
    home: { code: match.home_code || "?", name: match.home_name || "Home", color: colorForTeam(match.home_name), score: match.home_score ?? 0, formation: match.home_formation || "" },
    away: { code: match.away_code || "?", name: match.away_name || "Away", color: colorForTeam(match.away_name), score: match.away_score ?? 0, formation: match.away_formation || "" },
    events: (events ?? []).map((e) => ({
      minute: e.minute, type: e.type, team: e.team,
      player: e.player, assist: e.assist, detail: e.detail || "",
      playerOff: e.player_off, playerOn: e.player_on,
    })),
    lineups: {
      home: { starters: side("home").filter((l) => l.role === "starter").map(toPlayer), bench: side("home").filter((l) => l.role === "bench").map(toPlayer) },
      away: { starters: side("away").filter((l) => l.role === "starter").map(toPlayer), bench: side("away").filter((l) => l.role === "bench").map(toPlayer) },
    },
  };
}

export async function fetchPlayers() {
  const { data } = await supabase
    .from("match_lineups")
    .select("player_name, position, team, shirt_num, minutes_on, minutes_off, goals_for, goals_against, match_id, matches(home_code, away_code)")
    .limit(2000);
  if (!data?.length) return [];

  // Aggregate per player across all scraped matches.
  const byPlayer = new Map();
  for (const l of data) {
    const teamCode = l.team === "home" ? l.matches?.home_code : l.matches?.away_code;
    const key = `${l.player_name}|${teamCode || l.team}`;
    const cur = byPlayer.get(key) || {
      id: key, name: l.player_name, team: teamCode || (l.team === "home" ? "H" : "A"),
      position: l.position || "", minutes: 0, goalsFor: 0, goalsAgainst: 0,
    };
    cur.minutes += Math.max((l.minutes_off ?? 90) - (l.minutes_on ?? 0), 0);
    cur.goalsFor += l.goals_for ?? 0;
    cur.goalsAgainst += l.goals_against ?? 0;
    if (!cur.position && l.position) cur.position = l.position;
    byPlayer.set(key, cur);
  }
  return [...byPlayer.values()].map((p) => ({ ...p, diff: p.goalsFor - p.goalsAgainst }));
}

// Goal distribution across 15-minute windows — from real goal events.
const GOAL_WINDOWS = ["0-15", "16-30", "31-45", "46-60", "61-75", "76-90+"];
function windowFor(minute) {
  if (minute <= 15) return "0-15";
  if (minute <= 30) return "16-30";
  if (minute <= 45) return "31-45";
  if (minute <= 60) return "46-60";
  if (minute <= 75) return "61-75";
  return "76-90+";
}
export async function fetchGoalDistribution() {
  const { data } = await supabase
    .from("match_events").select("minute, type").eq("type", "goal").limit(5000);
  if (!data?.length) return null;
  const counts = Object.fromEntries(GOAL_WINDOWS.map((w) => [w, 0]));
  for (const e of data) counts[windowFor(e.minute ?? 0)]++;
  return GOAL_WINDOWS.map((half) => ({ half, goals: counts[half] }));
}

// Events parsed per matchday — last 6 matchdays by date.
export async function fetchMatchdayTrend() {
  const { data: mds } = await supabase
    .from("matchdays").select("id, label, date").order("date", { ascending: true }).limit(50);
  if (!mds?.length) return null;
  const recent = mds.slice(-6);
  const trend = [];
  for (const md of recent) {
    const { data: matches } = await supabase.from("matches").select("id").eq("matchday_id", md.id);
    const ids = (matches ?? []).map((m) => m.id);
    let events = 0;
    if (ids.length) {
      const { count } = await supabase
        .from("match_events").select("id", { count: "exact", head: true }).in("match_id", ids);
      events = count ?? 0;
    }
    const short = /\d+/.test(md.label || "")
      ? `MD ${(md.label.match(/\d+/) || [""])[0]}`
      : (md.date || md.id).slice(5); // MM-DD fallback
    trend.push({ md: short, events });
  }
  return trend;
}

export async function fetchActivity() {
  const { data } = await supabase
    .from("activity_log").select("id, text, detail, tone, created_at")
    .order("created_at", { ascending: false }).limit(6);
  return (data ?? []).map((a) => ({
    id: a.id, text: a.text, detail: a.detail || "",
    tone: a.tone === "error" ? "warn" : a.tone,
    time: a.created_at ? a.created_at.slice(0, 16).replace("T", " ") : "",
  }));
}
