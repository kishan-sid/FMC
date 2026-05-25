// POST /functions/v1/scrape-tick
// Body: { job_id: string }
// Advances ONE pending step of the given scrape job.
//
// Data source: api.openligadb.de — free public Bundesliga API.
// Accepted source_url formats (all map to the same /getmatchdata call):
//   • https://api.openligadb.de/getmatchdata/bl1/2023/33
//   • https://www.kicker.de/bundesliga/spieltag/2023-24/33
//   • bl1/2023/33  (shorthand)
import { preflight } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { ok, badRequest, serverError } from "../_shared/http.ts";
import { buildSimpleXlsx } from "../_shared/xlsx.ts";

type Job = {
  id: string;
  user_id: string;
  source_url: string;
  source_type: "matchday" | "match";
  matchday_id: string | null;
  status: string;
  total_steps: number;
  current_step: number;
};
type Step = { id: string; job_id: string; step_order: number; name: string; status: string };
type Parsed = { league: string; season: string; matchday: number };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const { job_id } = await req.json().catch(() => ({} as Record<string, unknown>));
    if (typeof job_id !== "string" || !job_id) return badRequest("job_id is required");

    const sb = serviceClient();

    const { data: jobRow, error: jobErr } = await sb.from("scrape_jobs").select("*").eq("id", job_id).maybeSingle();
    if (jobErr) throw jobErr;
    if (!jobRow) return badRequest("job not found");
    const job = jobRow as Job;

    if (["done", "failed", "cancelled"].includes(job.status)) {
      return ok({ job, finished: true });
    }

    if (job.status === "queued") {
      await sb.from("scrape_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", job.id);
    }

    const { data: stepRow } = await sb
      .from("scrape_job_steps")
      .select("*")
      .eq("job_id", job.id)
      .eq("status", "pending")
      .order("step_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    const step = stepRow as Step | null;

    if (!step) {
      await sb.from("scrape_jobs")
        .update({ status: "done", finished_at: new Date().toISOString(), progress_percent: 100, current_step: job.total_steps })
        .eq("id", job.id);
      return ok({ job: { ...job, status: "done" }, finished: true });
    }

    await sb.from("scrape_job_steps")
      .update({ status: "running", started_at: new Date().toISOString(), progress_percent: 25 })
      .eq("id", step.id);

    try {
      const detail = await runStep(sb, job, step);

      await sb.from("scrape_job_steps")
        .update({ status: "done", progress_percent: 100, finished_at: new Date().toISOString(), detail })
        .eq("id", step.id);

      const pct = Math.round((step.step_order / job.total_steps) * 100);
      const isLast = step.step_order >= job.total_steps;
      await sb.from("scrape_jobs")
        .update({
          current_step: step.step_order,
          progress_percent: pct,
          ...(isLast ? { status: "done", finished_at: new Date().toISOString() } : {}),
        })
        .eq("id", job.id);

      if (isLast) {
        await sb.from("activity_log").insert({
          user_id: job.user_id,
          text: "Scrape completed",
          detail: job.source_url,
          tone: "success",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sb.from("scrape_job_steps")
        .update({ status: "failed", error: msg, finished_at: new Date().toISOString() })
        .eq("id", step.id);
      await sb.from("scrape_jobs")
        .update({ status: "failed", error_message: msg, finished_at: new Date().toISOString() })
        .eq("id", job.id);
      await sb.from("activity_log").insert({
        user_id: job.user_id, text: "Scrape failed", detail: `${step.name}: ${msg}`, tone: "error",
      });
    }

    const { data: updated } = await sb.from("scrape_jobs").select("*").eq("id", job.id).single();
    return ok({ job: updated, step });
  } catch (e) {
    if (e instanceof Response) return e;
    return serverError(e);
  }
});

// ---------------------------------------------------------------------
// URL parsing — accept several formats
// ---------------------------------------------------------------------
function parseSourceUrl(raw: string): Parsed {
  const url = raw.trim();

  // 1. Direct OpenLigaDB
  const api = url.match(/openligadb\.de\/getmatchdata\/([a-z0-9]+)\/(\d+)\/(\d+)/i);
  if (api) return { league: api[1].toLowerCase(), season: api[2], matchday: parseInt(api[3], 10) };

  // 2. Kicker.de
  //    https://www.kicker.de/bundesliga/spieltag/2023-24/33
  //    https://www.kicker.de/2-bundesliga/spieltag/2024-25/19
  const kicker = url.match(/kicker\.de\/([a-z0-9-]+)\/spieltag\/(\d{4})-\d{2}\/(\d+)/i);
  if (kicker) {
    const league = kicker[1].toLowerCase() === "bundesliga"   ? "bl1"
                : kicker[1].toLowerCase() === "2-bundesliga" ? "bl2"
                : "bl1";
    return { league, season: kicker[2], matchday: parseInt(kicker[3], 10) };
  }

  // 3. Shorthand: bl1/2023/33
  const short = url.match(/^([a-z0-9]+)\/(\d{4})\/(\d+)$/i);
  if (short) return { league: short[1].toLowerCase(), season: short[2], matchday: parseInt(short[3], 10) };

  throw new Error(
    `Unrecognized URL. Use:
  - https://api.openligadb.de/getmatchdata/bl1/2023/33
  - https://www.kicker.de/bundesliga/spieltag/2023-24/33
  - bl1/2023/33`
  );
}

function apiUrl(p: Parsed): string {
  return `https://api.openligadb.de/getmatchdata/${p.league}/${p.season}/${p.matchday}`;
}

function matchdayId(p: Parsed): string {
  return `${p.league}-${p.season}-${p.matchday}`;
}

// deno-lint-ignore no-explicit-any
async function fetchMatchday(p: Parsed): Promise<any[]> {
  const res = await fetch(apiUrl(p), { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`OpenLigaDB ${res.status} for ${apiUrl(p)}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Unexpected payload from OpenLigaDB`);
  return data;
}

// ---------------------------------------------------------------------
// Per-step implementations (real OpenLigaDB scrape)
// ---------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function runStep(sb: any, job: Job, step: Step): Promise<string> {
  switch (step.step_order) {
    case 1: return await stepFetchMatchday(sb, job);
    case 2: return await stepExtractMatchURLs(sb, job);
    case 3: return await stepScrapeEventsLineups(sb, job);
    case 4: return await stepReconstructTimelines(sb, job);
    case 5: return await stepComputeOnPitchGoals(sb, job);
    case 6: return await stepBuildExport(sb, job);
    default: return "noop";
  }
}

// deno-lint-ignore no-explicit-any
async function stepFetchMatchday(sb: any, job: Job): Promise<string> {
  const parsed = parseSourceUrl(job.source_url);
  const data = await fetchMatchday(parsed);
  const mdId = matchdayId(parsed);

  const firstKickoff = data[0]?.matchDateTime?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const leagueName = data[0]?.leagueName ?? parsed.league.toUpperCase();

  await sb.from("matchdays").upsert({
    id: mdId,
    user_id: job.user_id,
    label: `${leagueName} · Spieltag ${parsed.matchday}`,
    date: firstKickoff,
    matches: data.length,
    scraped: 0,
    status: "running",
    competition: leagueName,
  }, { onConflict: "id" });

  await sb.from("scrape_jobs").update({ matchday_id: mdId }).eq("id", job.id);

  return `Fetched ${data.length} matches for ${leagueName} matchday ${parsed.matchday}`;
}

// deno-lint-ignore no-explicit-any
async function stepExtractMatchURLs(sb: any, job: Job): Promise<string> {
  const parsed = parseSourceUrl(job.source_url);
  const data = await fetchMatchday(parsed);
  const mdId = matchdayId(parsed);

  // Wipe stale URLs for this job (idempotent re-runs)
  await sb.from("match_urls").delete().eq("job_id", job.id);

  for (const m of data) {
    const matchId = `m-${m.matchID}`;
    const final = (m.matchResults ?? []).find((r: { resultName?: string; resultTypeID?: number }) =>
      r.resultName === "Endergebnis" || r.resultTypeID === 2
    ) ?? m.matchResults?.[m.matchResults.length - 1];

    await sb.from("matches").upsert({
      id: matchId,
      user_id: job.user_id,
      matchday_id: mdId,
      kickoff: m.matchDateTime ?? m.matchDateTimeUTC ?? new Date().toISOString(),
      venue: m.location ? `${m.location.locationStadium ?? ""}, ${m.location.locationCity ?? ""}`.trim().replace(/^,\s*/, "") : null,
      competition: m.leagueName ?? null,
      status: m.matchIsFinished ? "scraped" : "running",
      events_count: m.goals?.length ?? 0,
      home_code: (m.team1?.shortName ?? m.team1?.teamName ?? "?").slice(0, 16),
      home_name: m.team1?.teamName ?? "",
      home_score: final?.pointsTeam1 ?? null,
      away_code: (m.team2?.shortName ?? m.team2?.teamName ?? "?").slice(0, 16),
      away_name: m.team2?.teamName ?? "",
      away_score: final?.pointsTeam2 ?? null,
    }, { onConflict: "id" });

    await sb.from("match_urls").upsert({
      user_id: job.user_id,
      job_id: job.id,
      matchday_id: mdId,
      url: `https://api.openligadb.de/getmatchdata/${m.matchID}`,
      status: "queued",
      match_id: matchId,
    }, { onConflict: "matchday_id,url" });
  }

  return `${data.length} match URLs discovered`;
}

// deno-lint-ignore no-explicit-any
async function stepScrapeEventsLineups(sb: any, job: Job): Promise<string> {
  const parsed = parseSourceUrl(job.source_url);
  const data = await fetchMatchday(parsed);

  let totalGoals = 0;
  for (const m of data) {
    const matchId = `m-${m.matchID}`;

    // Make event insertion idempotent — clear existing goal events for this match.
    await sb.from("match_events").delete().eq("match_id", matchId).eq("type", "goal");

    const goals = (m.goals ?? []) as Array<{
      matchMinute: number | null;
      scoreTeam1: number | null;
      scoreTeam2: number | null;
      goalGetterName?: string;
      isPenalty?: boolean;
      isOwnGoal?: boolean;
      isOvertime?: boolean;
      comment?: string;
    }>;

    let prev1 = 0, prev2 = 0;
    const rows: Array<Record<string, unknown>> = [];
    for (const g of goals) {
      const score1 = g.scoreTeam1 ?? prev1;
      const score2 = g.scoreTeam2 ?? prev2;
      const homeScored = score1 > prev1;
      const team = homeScored ? "home" : "away";
      const flags: string[] = [];
      if (g.isPenalty) flags.push("Penalty");
      if (g.isOwnGoal) flags.push("Own goal");
      if (g.isOvertime) flags.push("Overtime");
      if (g.comment) flags.push(g.comment);
      rows.push({
        user_id: job.user_id,
        match_id: matchId,
        minute: g.matchMinute ?? 0,
        type: "goal",
        team,
        player: g.goalGetterName ?? "Unknown",
        detail: flags.join(" · "),
      });
      prev1 = score1;
      prev2 = score2;
    }
    if (rows.length) {
      const { error } = await sb.from("match_events").insert(rows);
      if (error) throw error;
    }
    totalGoals += rows.length;

    await sb.from("match_urls").update({
      status: "scraped",
      scraped_at: new Date().toISOString(),
    }).eq("job_id", job.id).eq("match_id", matchId);
  }

  // Update scraped count on matchday
  await sb.from("matchdays").update({ scraped: data.length }).eq("id", job.matchday_id);

  return `${totalGoals} goals across ${data.length} matches`;
}

// deno-lint-ignore no-explicit-any
async function stepReconstructTimelines(sb: any, job: Job): Promise<string> {
  // OpenLigaDB doesn't include full lineups. We create one lightweight
  // `match_lineups` row per goal scorer so downstream tooling has *some*
  // player coverage. minutes_on/off are unknown -> default to 0/90.
  const { data: events } = await sb.from("match_events")
    .select("match_id, team, player")
    .eq("user_id", job.user_id)
    .eq("type", "goal");

  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  for (const e of events ?? []) {
    const key = `${e.match_id}|${e.player}|${e.team}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      user_id: job.user_id,
      match_id: e.match_id,
      team: e.team,
      role: "starter",
      player_name: e.player,
      position: null,
      minutes_on: 0,
      minutes_off: 90,
      goals_for: 0,
      goals_against: 0,
    });
  }

  if (rows.length) {
    // Clear previous lineups created by this user for these matches first
    const matchIds = [...new Set(rows.map((r) => r.match_id as string))];
    await sb.from("match_lineups").delete().eq("user_id", job.user_id).in("match_id", matchIds);
    const { error } = await sb.from("match_lineups").insert(rows);
    if (error) throw error;
  }
  return `${rows.length} scorer timelines created`;
}

// deno-lint-ignore no-explicit-any
async function stepComputeOnPitchGoals(sb: any, job: Job): Promise<string> {
  // Aggregate goals per (match, scorer, team) into match_lineups.goals_for
  // and against players of the other team.
  const { data: events } = await sb.from("match_events")
    .select("match_id, team, player")
    .eq("user_id", job.user_id)
    .eq("type", "goal");

  // Per-match totals
  const totals: Record<string, { home: number; away: number; scorers: Record<string, number> }> = {};
  for (const e of events ?? []) {
    const t = totals[e.match_id] ??= { home: 0, away: 0, scorers: {} };
    if (e.team === "home") t.home += 1; else t.away += 1;
    const sk = `${e.team}|${e.player}`;
    t.scorers[sk] = (t.scorers[sk] ?? 0) + 1;
  }

  const { data: lineups } = await sb.from("match_lineups")
    .select("id, match_id, team, player_name")
    .eq("user_id", job.user_id);

  for (const ln of lineups ?? []) {
    const t = totals[ln.match_id];
    if (!t) continue;
    const goals_for = ln.team === "home" ? t.home : t.away;
    const goals_against = ln.team === "home" ? t.away : t.home;
    await sb.from("match_lineups")
      .update({ goals_for, goals_against })
      .eq("id", ln.id);
  }

  return `goals attributed for ${Object.keys(totals).length} matches`;
}

// deno-lint-ignore no-explicit-any
async function stepBuildExport(sb: any, job: Job): Promise<string> {
  // CSV layout: one row per goal event with match summary columns.
  const { data: matches } = await sb.from("matches")
    .select("id, kickoff, home_name, home_score, away_name, away_score, venue")
    .eq("matchday_id", job.matchday_id)
    .order("kickoff");
  const ids = (matches ?? []).map((m: { id: string }) => m.id);

  const { data: events } = ids.length
    ? await sb.from("match_events")
        .select("match_id, minute, team, player, detail")
        .in("match_id", ids)
        .eq("type", "goal")
    : { data: [] };

  const headers = ["match_id","date","home","home_score","away","away_score","minute","team","scorer","detail","venue"];
  const rows: string[][] = [headers];
  const byId = Object.fromEntries((matches ?? []).map((m: Record<string, unknown>) => [m.id, m]));

  if ((events ?? []).length === 0 && (matches ?? []).length > 0) {
    // No goals (0-0 matchday?) — still emit one row per match for context
    for (const m of matches ?? []) {
      rows.push([
        m.id, (m.kickoff ?? "").toString().slice(0, 10),
        m.home_name ?? "", String(m.home_score ?? ""),
        m.away_name ?? "", String(m.away_score ?? ""),
        "", "", "", "0-0 or no goals recorded", m.venue ?? "",
      ]);
    }
  } else {
    // Sort events by match then minute
    const sorted = [...(events ?? [])].sort((a: { match_id: string; minute: number }, b: { match_id: string; minute: number }) =>
      a.match_id === b.match_id ? a.minute - b.minute : a.match_id.localeCompare(b.match_id)
    );
    for (const e of sorted) {
      const m = byId[e.match_id] ?? {};
      rows.push([
        e.match_id, (m.kickoff ?? "").toString().slice(0, 10),
        m.home_name ?? "", String(m.home_score ?? ""),
        m.away_name ?? "", String(m.away_score ?? ""),
        String(e.minute), e.team, e.player, e.detail ?? "", m.venue ?? "",
      ]);
    }
  }

  const rowCount = Math.max(rows.length - 1, 0);
  const headers = rows[0] ?? [];
  const body = rows.slice(1);

  const csvBytes = new TextEncoder().encode(
    rows.map((r) => r.map(csvCell).join(",")).join("\n"),
  );
  const xlsxBytes = buildSimpleXlsx(headers, body);

  const stamp = new Date().toISOString().slice(0, 10);
  const stem = `${job.matchday_id ?? "export"}-${stamp}`;

  const uploads = [
    {
      format: "csv" as const,
      filename: `${stem}.csv`,
      contentType: "text/csv",
      bytes: csvBytes,
    },
    {
      format: "xlsx" as const,
      filename: `${stem}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: xlsxBytes,
    },
  ];

  let primaryExport: { id: string } | null = null;
  for (const u of uploads) {
    const path = `${job.user_id}/${u.filename}`;
    const { error: upErr } = await sb.storage.from("exports").upload(path, u.bytes, {
      contentType: u.contentType,
      upsert: true,
    });
    if (upErr) throw upErr;

    const { data: exportRow, error: insErr } = await sb.from("exports").insert({
      user_id: job.user_id,
      file: u.filename,
      size_bytes: u.bytes.length,
      rows: rowCount,
      format: u.format,
      storage_path: path,
      matchday_id: job.matchday_id,
    }).select().single();
    if (insErr) throw insErr;
    if (u.format === "xlsx") primaryExport = exportRow;
  }

  if (primaryExport) {
    await sb.from("scrape_jobs").update({ export_id: primaryExport.id }).eq("id", job.id);
  }
  return `${stem} · ${rowCount} rows · csv ${csvBytes.length}B / xlsx ${xlsxBytes.length}B`;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
