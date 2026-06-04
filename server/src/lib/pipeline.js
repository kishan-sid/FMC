// Shared scrape pipeline. Used by:
//   - server/src/worker.js   → local worker that polls Supabase for queued jobs
//
// The pipeline drives 6 scrape_job_steps rows and writes status/progress back
// to Supabase as it runs. The UI subscribes to realtime updates on those
// tables, so progress is reflected live without any HTTP polling.
import { scrapeUrl } from "../scraper/generic.js";
import { buildStyledXlsx } from "../scraper/xlsx.js";

export async function runPipeline({ sb, job }) {
  await sb.from("scrape_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", job.id);

  const ctx = { job, sb, scraped: null };

  await runStep(ctx, 1, async (c) => {
    c.scraped = await scrapeUrl(c.job.source_url, {
      onProgress: (p) => bumpProgress(sb, c.step.id, p.phase === "extract" ? 70 : 35),
    });
    return `Loaded page · ${c.scraped.title?.slice(0, 80) || c.scraped.kind}`;
  });

  await runStep(ctx, 2, async (c) => {
    const s = c.scraped;
    if (s.kind === "matchday" && s.data.match_urls?.length) {
      const created = await fanOutMatchday(sb, c.job, s.data.match_urls);
      return `${created} match job(s) queued from matchday (${s.data.match_urls.length} links)`;
    }
    return `Detected ${s.kind} · ${s.summary}`;
  });

  await runStep(ctx, 3, async (c) => {
    const s = c.scraped;
    if (s.kind === "matchday") return { skip: true, detail: "Per-match data scraped by child jobs" };
    if (s.kind === "match") {
      // Group matches by competition + date so same-day fixtures land under
      // one matchday; fall back to spielnummer when no competition/date.
      const mdKey = s.data.competition || s.title || "matchday";
      const mdId = `md-${slug(mdKey)}-${s.data.date || "tbd"}`.slice(0, 60);
      const matchId = `m-${s.data.spielnummer || slug(s.title)}`;
      c.matchId = matchId;
      c.mdId = mdId;

      await upsertMatchday(sb, c.job, s, mdId);
      await sb.from("scrape_jobs").update({ matchday_id: mdId }).eq("id", c.job.id);
      await upsertMatch(sb, c.job, s, mdId, matchId);
      await persistEvents(sb, c.job, s, matchId);
      await sb.from("match_urls").upsert({
        user_id: c.job.user_id, job_id: c.job.id, matchday_id: mdId,
        url: s.source_url, status: "scraped", scraped_at: new Date().toISOString(),
        match_id: matchId,
      }, { onConflict: "matchday_id,url" });

      if (s.data.players?.length) {
        return `Match + ${s.data.events?.length ?? 0} events saved`;
      }
      return s.data.played
        ? `Score ${s.data.home_score}-${s.data.away_score} captured`
        : `Fixture captured · match not yet played`;
    }
    if (s.kind === "standings") {
      const teams = s.data.team_count ?? 0;
      const groups = s.data.group_count ?? 1;
      return groups > 1
        ? `${teams} standings rows across ${groups} groups captured`
        : `${teams} standings rows captured`;
    }
    if (s.kind === "match_list") return `${s.data.rows} match rows captured`;
    if (s.kind === "generic_table") return `${s.data.rows} table rows captured`;
    return `Page text captured (${s.data.chars} chars)`;
  });

  await runStep(ctx, 4, async (c) => {
    const s = c.scraped;
    if (s.kind === "matchday") return { skip: true, detail: "Handled by child jobs" };
    if (s.kind === "match" && s.data.players?.length && c.matchId) {
      const computed = computeOnPitch(s.data);
      c.computed = computed;
      await persistLineups(sb, c.job, s, c.matchId, computed);
      const starters = computed.filter((p) => p.role === "starter").length;
      const bench = computed.length - starters;
      return `${computed.length} players · ${starters} starters + ${bench} bench · timelines reconstructed`;
    }
    if (s.kind === "match" && s.data.lineup_rows?.length) {
      return `${s.data.lineup_rows.length} lineup rows captured (raw)`;
    }
    return { skip: true, detail: `Not applicable for ${s.kind}` };
  });

  await runStep(ctx, 5, async (c) => {
    const s = c.scraped;
    if (s.kind === "matchday") return { skip: true, detail: "Handled by child jobs" };
    if (s.kind === "match" && c.computed?.length && c.matchId) {
      await persistIntervals(sb, c.job, c.matchId, c.computed);
      if (c.mdId) await recountMatchday(sb, c.mdId);
      const scorers = c.computed.filter((p) => (p.goals || 0) > 0).length;
      const goals = (s.data.events?.length ?? 0) || (s.data.home_score ?? 0) + (s.data.away_score ?? 0);
      return `On-pitch goals computed · ${goals} goals · ${scorers} scorers`;
    }
    if (s.kind === "match" && s.data.played) {
      return `Score recorded: ${s.data.home_score}-${s.data.away_score}`;
    }
    return { skip: true, detail: `Not applicable for ${s.kind}` };
  });

  await runStep(ctx, 6, async (c) => {
    const out = await buildExport(sb, c.job, c.scraped);
    return `${out.filename} · ${out.rowCount} rows · ${out.bytes} bytes`;
  });

  await sb.from("scrape_jobs").update({
    status: "done", progress_percent: 100, current_step: 6,
    finished_at: new Date().toISOString(),
  }).eq("id", job.id);

  await sb.from("activity_log").insert({
    user_id: job.user_id,
    text: "Scrape completed",
    detail: job.source_url,
    tone: "success",
  });
}

async function runStep(ctx, stepOrder, fn) {
  const { sb, job } = ctx;
  const { data: step, error: fetchErr } = await sb
    .from("scrape_job_steps")
    .select("*")
    .eq("job_id", job.id)
    .eq("step_order", stepOrder)
    .single();
  if (fetchErr) throw fetchErr;
  ctx.step = step;

  await sb.from("scrape_job_steps")
    .update({ status: "running", started_at: new Date().toISOString(), progress_percent: 25 })
    .eq("id", step.id);

  try {
    const result = await fn(ctx);
    const detail = typeof result === "string" ? result : result?.detail ?? null;
    const skipped = typeof result === "object" && result?.skip === true;

    await sb.from("scrape_job_steps")
      .update({
        status: skipped ? "skipped" : "done",
        progress_percent: 100,
        finished_at: new Date().toISOString(),
        detail,
      })
      .eq("id", step.id);

    const pct = Math.round((stepOrder / job.total_steps) * 100);
    await sb.from("scrape_jobs")
      .update({ current_step: stepOrder, progress_percent: pct })
      .eq("id", job.id);
  } catch (e) {
    const msg = e?.message || String(e);
    await sb.from("scrape_job_steps")
      .update({ status: "failed", error: msg, finished_at: new Date().toISOString() })
      .eq("id", step.id);
    await sb.from("scrape_jobs")
      .update({ status: "failed", error_message: msg, finished_at: new Date().toISOString() })
      .eq("id", job.id);
    await sb.from("activity_log").insert({
      user_id: job.user_id,
      text: "Scrape failed",
      detail: `Step ${stepOrder}: ${msg}`,
      tone: "error",
    });
    throw e;
  }
}

async function bumpProgress(sb, stepId, pct) {
  await sb.from("scrape_job_steps").update({ progress_percent: pct }).eq("id", stepId);
}

// Create one queued child scrape job per discovered match URL. The worker
// picks them up on subsequent ticks. Capped to avoid a runaway fan-out.
async function fanOutMatchday(sb, job, urls) {
  const MAX = 40;
  const list = [...new Set(urls)].slice(0, MAX);
  let created = 0;
  for (const u of list) {
    // Skip URLs already queued/scraped for this user to avoid duplicates.
    const { count } = await sb.from("scrape_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", job.user_id).eq("source_url", u)
      .in("status", ["queued", "running", "done"]);
    if (count) continue;
    const { data: child, error } = await sb.from("scrape_jobs").insert({
      user_id: job.user_id,
      source_url: u,
      source_type: "match",
      status: "queued",
      total_steps: 6,
    }).select().single();
    if (error || !child) continue;
    await sb.rpc("seed_scrape_steps", { p_job_id: child.id });
    created++;
  }
  await sb.from("activity_log").insert({
    user_id: job.user_id,
    text: "Matchday expanded",
    detail: `${created} match job(s) queued`,
    tone: "info",
  });
  return created;
}

async function upsertMatchday(sb, job, s, mdId) {
  const d = s.data;
  await sb.from("matchdays").upsert({
    id: mdId,
    user_id: job.user_id,
    label: d.competition || s.title || mdId,
    date: d.date ?? new Date().toISOString().slice(0, 10),
    status: "complete",
    competition: d.competition ?? "Bundesliga",
  }, { onConflict: "id" });
}

async function upsertMatch(sb, job, s, mdId, matchId) {
  const d = s.data;
  const kickoff = d.date
    ? `${d.date}T${(d.time && /^\d{1,2}:\d{2}$/.test(d.time)) ? d.time : "12:00"}:00Z`
    : new Date().toISOString();
  await sb.from("matches").upsert({
    id: matchId,
    user_id: job.user_id,
    matchday_id: mdId,
    kickoff,
    venue: d.venue,
    competition: d.competition,
    status: d.played ? "scraped" : "pending",
    events_count: d.events?.length ?? 0,
    home_code: teamCode(d.home_name),
    home_name: d.home_name || "",
    home_score: d.home_score,
    home_formation: d.home_formation ?? null,
    away_code: teamCode(d.away_name),
    away_name: d.away_name || "",
    away_score: d.away_score,
    away_formation: d.away_formation ?? null,
  }, { onConflict: "id" });
}

// ---------------------------------------------------------------------
// Persist parsed goal events.
// ---------------------------------------------------------------------
async function persistEvents(sb, job, s, matchId) {
  const events = s.data.events ?? [];
  await sb.from("match_events").delete().eq("match_id", matchId);
  if (!events.length) return;
  const rows = events.map((e) => ({
    user_id: job.user_id,
    match_id: matchId,
    minute: parseMinute(e.minute),
    type: e.type === "goal" || e.type === "card" || e.type === "sub" ? e.type : "goal",
    team: e.side === "away" ? "away" : "home",
    player: e.scorer || e.player || (e.type === "sub" ? e.playerIn : null),
    player_off: e.playerOut || null,
    player_on: e.playerIn || null,
    detail: [e.detail, e.score].filter(Boolean).join(" · ") || null,
  }));
  await sb.from("match_events").insert(rows);
}

// ---------------------------------------------------------------------
// On-pitch timeline + goal math.
//   Starters: on the pitch 0–90, so goals_for = own team total,
//   goals_against = opponent total. Bench players have no published sub
//   minute in this source, so they are recorded with 0 on-pitch minutes.
// ---------------------------------------------------------------------
// The scraper already reconstructs timelines + on-pitch goals (using
// substitution / red-card minutes). Use those values; fall back only when a
// field is missing.
function computeOnPitch(d) {
  return (d.players ?? []).map((p) => ({
    ...p,
    minutes_on: p.minutes_on ?? 0,
    minutes_off: p.minutes_off ?? (p.role === "starter" ? 90 : 0),
    goals_for: p.goals_for ?? 0,
    goals_against: p.goals_against ?? 0,
    played: p.played ?? (p.role === "starter"),
  }));
}

async function persistLineups(sb, job, s, matchId, players) {
  await sb.from("match_lineups").delete().eq("match_id", matchId);
  if (!players.length) return;
  const rows = players.map((p) => ({
    user_id: job.user_id,
    match_id: matchId,
    team: p.side === "away" ? "away" : "home",
    role: p.role === "bench" ? "bench" : "starter",
    shirt_num: numOrNull(p.num),
    player_name: p.name,
    position: p.position || null,
    minutes_on: p.minutes_on ?? 0,
    minutes_off: p.minutes_off ?? 90,
    goals_for: p.goals_for ?? 0,
    goals_against: p.goals_against ?? 0,
  }));
  await sb.from("match_lineups").insert(rows);

  // Maintain the player catalogue (one row per player per user).
  const cat = players.map((p) => ({
    user_id: job.user_id,
    external_id: `${teamCode(p.team)}-${p.num}-${slug(p.name)}`.slice(0, 80),
    name: p.name,
    team_code: teamCode(p.team),
    position: p.position || null,
    shirt_num: numOrNull(p.num),
  }));
  await sb.from("players").upsert(cat, { onConflict: "user_id,external_id" });
}

async function persistIntervals(sb, job, matchId, players) {
  await sb.from("player_match_intervals").delete().eq("match_id", matchId);
  const rows = players
    .filter((p) => p.played ?? p.role === "starter") // players with a known on-pitch window
    .map((p) => ({
      user_id: job.user_id,
      match_id: matchId,
      player_name: p.name,
      team: p.side === "away" ? "away" : "home",
      start_minute: p.minutes_on ?? 0,
      end_minute: p.minutes_off ?? 90,
      goals_for: p.goals_for ?? 0,
      goals_against: p.goals_against ?? 0,
    }));
  if (rows.length) await sb.from("player_match_intervals").insert(rows);
}

// Recount a matchday's match/scraped totals from the matches table.
async function recountMatchday(sb, mdId) {
  const { count: total } = await sb.from("matches")
    .select("id", { count: "exact", head: true }).eq("matchday_id", mdId);
  const { count: scraped } = await sb.from("matches")
    .select("id", { count: "exact", head: true }).eq("matchday_id", mdId).eq("status", "scraped");
  await sb.from("matchdays").update({
    matches: total ?? 0,
    scraped: scraped ?? 0,
    status: (scraped ?? 0) >= (total ?? 0) ? "complete" : "running",
  }).eq("id", mdId);
}

function parseMinute(m) {
  const n = parseInt(String(m ?? "").match(/\d+/)?.[0] ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v) {
  const n = parseInt(String(v ?? "").match(/\d+/)?.[0] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}
function teamCode(name) {
  return String(name || "?")
    .replace(/^FC\s+|^FC$/i, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase() || "?";
}

async function buildExport(sb, job, s) {
  const rows = s.csv_rows ?? [];
  const rowCount = Math.max(rows.length - 1, 0);
  const headers = rows[0] ?? [];
  const body = rows.slice(1);

  const csvBytes = new TextEncoder().encode(
    rows.map((r) => r.map(csvCell).join(",")).join("\n"),
  );
  const xlsxBytes = await buildStyledXlsx(s);

  const stamp = new Date().toISOString().slice(0, 10);
  // Sanitize the filename hint aggressively. Supabase Storage rejects keys
  // containing characters like { } ? * etc, and some scraped section labels
  // include CSS leak-through ("...{display:none}"). Keep only chars that are
  // safe in both Supabase keys and Windows/macOS filenames.
  const rawHint = (s.csv_filename_hint || s.kind || "scrape");
  const hint = rawHint
    .replace(/[^a-zA-Z0-9 _.()\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "scrape";

  const { data: jobRow } = await sb.from("scrape_jobs").select("matchday_id").eq("id", job.id).single();
  const matchdayId = jobRow?.matchday_id ?? null;

  const uploads = [
    {
      format: "csv",
      filename: `${hint}-${stamp}.csv`,
      contentType: "text/csv",
      bytes: csvBytes,
    },
    {
      format: "xlsx",
      filename: `${hint}-${stamp}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: xlsxBytes,
    },
  ];

  let primaryExport = null;
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
      matchday_id: matchdayId,
    }).select().single();
    if (insErr) throw insErr;
    if (u.format === "xlsx") primaryExport = exportRow;
  }

  if (primaryExport) {
    await sb.from("scrape_jobs").update({ export_id: primaryExport.id }).eq("id", job.id);
  }
  return { filename: uploads[1].filename, rowCount, bytes: xlsxBytes.length };
}

function csvCell(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function slug(s) {
  return String(s || "page")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "page";
}
