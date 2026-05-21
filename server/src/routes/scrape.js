// POST /api/scrape/start
// Body: { source_url: string }
// Creates a scrape_jobs row + 6 scrape_job_steps and kicks off an async
// Playwright pipeline. The scraper is content-aware: match detail pages,
// standings tables, match lists, and generic tables/pages are all handled.
// Step status is written back to Supabase as the pipeline runs; the UI
// subscribes to realtime updates.
import { Router } from "express";
import { serviceClient, requireUser } from "../lib/supabase.js";
import { scrapeUrl } from "../scraper/generic.js";

const router = Router();

router.post("/start", async (req, res) => {
  try {
    const user = await requireUser(req);
    const source_url = String(req.body?.source_url ?? "").trim();
    if (!source_url) return res.status(400).json({ error: "source_url is required" });

    try { new URL(source_url); }
    catch { return res.status(400).json({ error: "source_url must be a valid URL" }); }

    const sb = serviceClient();

    const { data: job, error: jobErr } = await sb
      .from("scrape_jobs")
      .insert({
        user_id: user.id,
        source_url,
        source_type: "match",
        status: "queued",
        total_steps: 6,
      })
      .select()
      .single();
    if (jobErr) throw jobErr;

    const { error: seedErr } = await sb.rpc("seed_scrape_steps", { p_job_id: job.id });
    if (seedErr) throw seedErr;

    await sb.from("activity_log").insert({
      user_id: user.id,
      text: "Scrape queued",
      detail: source_url,
      tone: "info",
    });

    const { data: steps } = await sb
      .from("scrape_job_steps")
      .select("*")
      .eq("job_id", job.id)
      .order("step_order");

    runPipeline(job).catch((e) => {
      console.error("[scrape] pipeline crash", e);
    });

    res.json({ job, steps });
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({ error: e?.message || "scrape start failed" });
  }
});

// ---------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------
async function runPipeline(job) {
  const sb = serviceClient();
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
    return `Detected ${s.kind} · ${s.summary}`;
  });

  await runStep(ctx, 3, async (c) => {
    const s = c.scraped;
    if (s.kind === "match") {
      const mdId = `mc-${s.data.spielnummer || slug(s.title)}`;
      const matchId = `mc-m-${s.data.spielnummer || slug(s.title)}`;
      await upsertMatchday(sb, c.job, s, mdId);
      await sb.from("scrape_jobs").update({ matchday_id: mdId }).eq("id", c.job.id);
      await upsertMatch(sb, c.job, s, mdId, matchId);
      await sb.from("match_urls").upsert({
        user_id: c.job.user_id, job_id: c.job.id, matchday_id: mdId,
        url: s.source_url, status: "scraped", scraped_at: new Date().toISOString(),
        match_id: matchId,
      }, { onConflict: "matchday_id,url" });
      return s.data.played
        ? `Score ${s.data.home_score}-${s.data.away_score} captured`
        : `Fixture captured · match not yet played`;
    }
    if (s.kind === "standings") {
      return `${s.data.rows.length} standings rows captured`;
    }
    if (s.kind === "match_list") {
      return `${s.data.rows} match rows captured`;
    }
    if (s.kind === "generic_table") {
      return `${s.data.rows} table rows captured`;
    }
    return `Page text captured (${s.data.chars} chars)`;
  });

  await runStep(ctx, 4, async (c) => {
    const s = c.scraped;
    if (s.kind === "match" && s.data.lineup_rows?.length) {
      return `${s.data.lineup_rows.length} lineup rows captured (raw)`;
    }
    return { skip: true, detail: `Not applicable for ${s.kind}` };
  });

  await runStep(ctx, 5, async (c) => {
    const s = c.scraped;
    if (s.kind === "match" && s.data.played) {
      return `Score recorded: ${s.data.home_score}-${s.data.away_score}`;
    }
    return { skip: true, detail: `Not applicable for ${s.kind}` };
  });

  await runStep(ctx, 6, async (c) => {
    const out = await buildExport(sb, c.job, c.scraped);
    return `${out.filename} · ${out.rowCount} rows · ${out.bytes} bytes`;
  });

  await sb.from("scrape_jobs")
    .update({
      status: "done",
      progress_percent: 100,
      current_step: 6,
      finished_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await sb.from("activity_log").insert({
    user_id: job.user_id,
    text: "Scrape completed",
    detail: job.source_url,
    tone: "success",
  });
}

// ---------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------
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
  await sb.from("scrape_job_steps")
    .update({ progress_percent: pct })
    .eq("id", stepId);
}

// ---------------------------------------------------------------------
// Persistence helpers (match-kind only — other kinds just produce CSV)
// ---------------------------------------------------------------------
async function upsertMatchday(sb, job, s, mdId) {
  const d = s.data;
  await sb.from("matchdays").upsert({
    id: mdId,
    user_id: job.user_id,
    label: d.competition ? `${d.competition} · ${d.date ?? ""}` : (s.title || mdId),
    date: d.date ?? new Date().toISOString().slice(0, 10),
    matches: 1,
    scraped: 1,
    status: "scraped",
    competition: d.competition ?? null,
  }, { onConflict: "id" });
}

async function upsertMatch(sb, job, s, mdId, matchId) {
  const d = s.data;
  const kickoff = d.date ? `${d.date}T12:00:00Z` : new Date().toISOString();
  await sb.from("matches").upsert({
    id: matchId,
    user_id: job.user_id,
    matchday_id: mdId,
    kickoff,
    venue: d.venue,
    competition: d.competition,
    status: d.played ? "scraped" : "pending",
    events_count: 0,
    home_code: (d.home_name || "?").slice(0, 16),
    home_name: d.home_name || "",
    home_score: d.home_score,
    away_code: (d.away_name || "?").slice(0, 16),
    away_name: d.away_name || "",
    away_score: d.away_score,
  }, { onConflict: "id" });
}

async function buildExport(sb, job, s) {
  const rows = s.csv_rows ?? [];
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const bytes = new TextEncoder().encode(csv);

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const hint = (s.csv_filename_hint || s.kind || "scrape").replace(/[^a-z0-9-]+/gi, "-");
  const filename = `${hint}-${stamp}.csv`;
  const path = `${job.user_id}/${filename}`;

  const { error: upErr } = await sb.storage.from("exports").upload(path, bytes, {
    contentType: "text/csv",
    upsert: true,
  });
  if (upErr) throw upErr;

  // Best-effort matchday_id tie-in (only set for match-kind scrapes).
  const { data: jobRow } = await sb.from("scrape_jobs").select("matchday_id").eq("id", job.id).single();

  const { data: exportRow, error: insErr } = await sb.from("exports").insert({
    user_id: job.user_id,
    file: filename,
    size_bytes: bytes.length,
    rows: Math.max(rows.length - 1, 0),
    format: "csv",
    storage_path: path,
    matchday_id: jobRow?.matchday_id ?? null,
  }).select().single();
  if (insErr) throw insErr;

  await sb.from("scrape_jobs").update({ export_id: exportRow.id }).eq("id", job.id);
  return { filename, rowCount: Math.max(rows.length - 1, 0), bytes: bytes.length };
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

export default router;
