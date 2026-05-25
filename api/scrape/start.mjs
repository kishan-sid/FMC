// Vercel serverless function — POST /api/scrape/start
//
// Same role as the Express route in server/src/routes/scrape.js. Uses axios +
// cheerio (no headless browser) so it fits within Vercel's serverless budget
// — no 250MB Chromium tarball, no LD_LIBRARY_PATH hacks, no cold-start
// browser launches.
//
// Flow:
//   1. Verify the caller via Supabase JWT
//   2. Create scrape_jobs row + seed 6 step rows
//   3. Respond immediately so the UI can subscribe to realtime updates
//   4. waitUntil(runPipeline(job)) — keeps the function alive up to
//      maxDuration (set in vercel.json) to do the actual work
import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { scrapeUrl } from "../_lib/scraper.mjs";
import { buildSimpleXlsx } from "../_lib/xlsx.mjs";

export const config = {
  maxDuration: 60,
};

// ---------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = parseBody(req.body);
    const source_url = String(body?.source_url ?? "").trim();
    if (!source_url) return res.status(400).json({ error: "source_url is required" });
    try { new URL(source_url); }
    catch { return res.status(400).json({ error: "source_url must be a valid URL" }); }

    const authHeader = req.headers.authorization || "";
    const user = await verifyUser(authHeader);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

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

    res.status(200).json({ job, steps });
    waitUntil(runPipeline(job).catch((e) => {
      console.error("[scrape] pipeline crash", e);
    }));
  } catch (e) {
    console.error("[scrape] start failed", e);
    return res.status(500).json({ error: e?.message || "scrape start failed" });
  }
}

function parseBody(b) {
  if (!b) return {};
  if (typeof b === "object") return b;
  try { return JSON.parse(b); } catch { return {}; }
}

// ---------------------------------------------------------------------
// Supabase clients
// ---------------------------------------------------------------------
function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars missing on Vercel");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function verifyUser(authHeader) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY env vars missing on Vercel");
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await sb.auth.getUser();
  return data?.user ?? null;
}

// ---------------------------------------------------------------------
// Pipeline runner — drives 6 step rows in Supabase
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

  await runStep(ctx, 2, async (c) => `Detected ${c.scraped.kind} · ${c.scraped.summary}`);

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

// ---------------------------------------------------------------------
// Persistence helpers (mirror server/src/routes/scrape.js)
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
  const rowCount = Math.max(rows.length - 1, 0);
  const headers = rows[0] ?? [];
  const body = rows.slice(1);

  const csvBytes = new TextEncoder().encode(
    rows.map((r) => r.map(csvCell).join(",")).join("\n"),
  );
  const xlsxBytes = buildSimpleXlsx(headers, body);

  const stamp = new Date().toISOString().slice(0, 10);
  const hint = (s.csv_filename_hint || s.kind || "scrape")
    .replace(/[/\\]+/g, "-")
    .trim() || "scrape";

  const { data: jobRow } = await sb.from("scrape_jobs").select("matchday_id").eq("id", job.id).single();
  const matchdayId = jobRow?.matchday_id ?? null;

  const uploads = [
    {
      format: "csv",
      filename: `${hint} ${stamp}.csv`,
      contentType: "text/csv",
      bytes: csvBytes,
    },
    {
      format: "xlsx",
      filename: `${hint} ${stamp}.xlsx`,
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

// ---------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------
function csvCell(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function slug(s) {
  return String(s || "page").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "page";
}
