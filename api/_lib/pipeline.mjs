// Shared scrape pipeline — Vercel-side mirror of server/src/lib/pipeline.js.
//
// Uses the axios+cheerio scraper from api/_lib/scraper.mjs (which routes
// through ZenRows when configured). Drives the same 6 scrape_job_steps as
// the worker pipeline so the UI sees identical progress regardless of
// whether scraping ran on Vercel or on a local worker.
import { scrapeUrl } from "./scraper.mjs";
import { buildStyledXlsx } from "./xlsx.mjs";

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
    if (s.kind === "match" && s.data.players?.length) {
      const onPitch = s.data.players.filter((p) => p.played).length;
      return `${s.data.players.length} players · ${onPitch} on-pitch timelines reconstructed`;
    }
    if (s.kind === "match" && s.data.lineup_rows?.length) {
      return `${s.data.lineup_rows.length} lineup rows captured (raw)`;
    }
    return { skip: true, detail: `Not applicable for ${s.kind}` };
  });

  await runStep(ctx, 5, async (c) => {
    const s = c.scraped;
    if (s.kind === "match" && s.data.players?.length) {
      const goals = (s.data.events || []).filter((e) => e.type === "goal").length;
      return `On-pitch goal matrix computed · ${goals} goals across ${s.data.players.length} players`;
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

  const csvBytes = new TextEncoder().encode(
    rows.map((r) => r.map(csvCell).join(",")).join("\n"),
  );
  const xlsxBytes = await buildStyledXlsx(s);

  const stamp = new Date().toISOString().slice(0, 10);
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
