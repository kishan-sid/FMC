// Vercel serverless function — POST /api/scrape/start
//
// Same role as the Express route in server/src/routes/scrape.js, but runs
// inside a Vercel function. Uses @sparticuz/chromium-min (Lambda-compatible
// Chromium that fits in Vercel's function size budget) + playwright-core.
//
// Flow:
//   1. Verify the caller via Supabase JWT
//   2. Create scrape_jobs row + seed 6 step rows
//   3. Respond immediately so the UI can subscribe to realtime updates
//   4. waitUntil(runPipeline(job)) — keeps the function alive up to
//      maxDuration (set in vercel.json) to do the actual work
//
// Env vars (set in Vercel → Project Settings → Environment Variables):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "@supabase/supabase-js";
import sparticuzChromium from "@sparticuz/chromium-min";
import { chromium as playwrightChromium } from "playwright-core";
import { waitUntil } from "@vercel/functions";

export const config = {
  maxDuration: 60, // seconds — Hobby plan upper limit, plenty for one scrape
};

// Public Chromium tarball matching @sparticuz/chromium-min major version.
// Update this when bumping the chromium-min dep.
const CHROMIUM_TAR =
  "https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

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

    // Respond to the UI right away, then keep the function alive to run
    // the actual pipeline. waitUntil extends function lifetime up to
    // maxDuration after the response has been sent.
    res.status(200).json({ job, steps });
    waitUntil(runPipeline(job).catch((e) => {
      // Last-chance error surface — the step runner already records
      // failures into Supabase, but log to Vercel logs too.
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
    if (s.kind === "standings") return `${s.data.rows.length} standings rows captured`;
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
// Scraper — Vercel-flavoured (playwright-core + sparticuz Chromium)
// ---------------------------------------------------------------------
async function scrapeUrl(url, { onProgress } = {}) {
  try { new URL(url); } catch { throw new Error("source_url must be a valid URL"); }

  const executablePath = await sparticuzChromium.executablePath(CHROMIUM_TAR);

  // sparticuz extracts shared libs (libnss3.so etc.) into /tmp; make sure
  // the Chromium binary can find them. Some Vercel environments don't
  // inherit LD_LIBRARY_PATH set by the library — set it explicitly.
  const libDir = "/tmp/al2023/lib:/tmp/al2/lib:/tmp/aws/lib:/tmp/lib";
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${process.env.LD_LIBRARY_PATH}:${libDir}`
    : libDir;
  process.env.FONTCONFIG_PATH = process.env.FONTCONFIG_PATH || "/tmp/fonts";

  const browser = await playwrightChromium.launch({
    args: sparticuzChromium.args,
    executablePath,
    headless: sparticuzChromium.headless ?? true,
  });
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 1600 } });
    const page = await ctx.newPage();

    onProgress?.({ phase: "navigate", detail: url });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    // Pass through Cloudflare interstitial if present.
    for (let i = 0; i < 20; i++) {
      const t = await page.title().catch(() => "");
      if (!/just a moment/i.test(t)) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    onProgress?.({ phase: "extract" });
    const dom = await page.evaluate(extractDom);
    onProgress?.({ phase: "classify" });
    return classifyAndShape(url, dom);
  } finally {
    await browser.close().catch(() => {});
  }
}

// --- DOM extraction (runs inside the browser) ---
function extractDom() {
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const main = document.querySelector("#mainContent, main, .matchcenter") || document.body;
  const mainText = clean(main?.innerText || "");
  const tables = [...document.querySelectorAll("table")].map((t, i) => {
    const rows = [...t.rows].map((r) => [...r.cells].map((c) => clean(c.textContent)));
    return { idx: i, rowCount: rows.length, rows };
  }).filter((t) => t.rowCount > 0);
  const matchPanel = [...document.querySelectorAll("div, section, article")]
    .find((d) => /Spielnummer\s*:?\s*\d+/i.test(d.textContent || ""));
  const matchPanelText = matchPanel ? matchPanel.innerText : null;
  const lineupSection = document.querySelector(
    "[id*='Aufstellung'], [class*='Aufstellung'], [id*='lineup']"
  );
  const lineupRows = lineupSection
    ? [...lineupSection.querySelectorAll("tr")]
        .map((tr) => [...tr.cells].map((c) => clean(c.textContent)))
        .filter((cells) => cells.some(Boolean))
    : [];
  return {
    title: document.title || "",
    h1: [...document.querySelectorAll("h1")].map((el) => clean(el.textContent)).filter(Boolean),
    h3: [...document.querySelectorAll("h3")].map((el) => clean(el.textContent)).filter(Boolean),
    mainText,
    tables,
    matchPanelText,
    lineupRows,
    matchPanelHasContent: !!matchPanel,
  };
}

// --- Classifier ---
function classifyAndShape(url, dom) {
  if (dom.matchPanelHasContent && /Spielnummer\s*:?\s*\d+/i.test(dom.matchPanelText || "")) {
    return shapeMatchDetail(url, dom);
  }
  const standings = pickStandingsTable(dom.tables);
  if (standings) return shapeStandings(url, dom, standings);
  const matchList = pickMatchListTable(dom.tables);
  if (matchList) return shapeMatchList(url, dom, matchList);
  return shapeGeneric(url, dom);
}

function shapeMatchDetail(url, dom) {
  const lines = (dom.matchPanelText || "")
    .split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const headerIdx = lines.findIndex((l) => /Spielnummer\s*:?\s*\d+/i.test(l));
  const header = headerIdx >= 0 ? lines[headerIdx] : "";
  const spielnummer = (header.match(/Spielnummer\s*:?\s*(\d+)/i) || [])[1] || null;
  const dateRaw = (header.match(/(\d{1,2}\.\d{1,2}\.\d{4})/) || [])[1] || null;
  const competition = dateRaw ? header.split(` - ${dateRaw}`)[0]?.trim() : null;
  const venueLine = lines[headerIdx + 1] || "";
  const venue = venueLine.replace(/^[-\s]+/, "").trim() || null;
  const homeName = lines[headerIdx + 2] || null;
  const scoreLine = lines[headerIdx + 3] || "";
  const awayName = lines[headerIdx + 4] || null;
  let homeScore = null, awayScore = null, played = false;
  const m = scoreLine.match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (m) { homeScore = +m[1]; awayScore = +m[2]; played = true; }
  const date = parseDateDmy(dateRaw);
  const csv_rows = [
    ["spielnummer","competition","date","venue","home","home_score","away_score","away","played","source_url"],
    [spielnummer ?? "", competition ?? "", date ?? "", venue ?? "", homeName ?? "",
     homeScore ?? "", awayScore ?? "", awayName ?? "", played ? "yes" : "no", url],
  ];
  return {
    kind: "match", source_url: url, title: dom.title,
    summary: `Match · ${homeName || "?"} ${played ? `${homeScore}–${awayScore}` : "vs"} ${awayName || "?"} · ${date || "TBD"}`,
    data: { spielnummer, competition, date, venue, home_name: homeName, away_name: awayName,
            home_score: homeScore, away_score: awayScore, played, lineup_rows: dom.lineupRows },
    csv_rows,
    csv_filename_hint: `match-${spielnummer || "x"}-${(date || "unknown").replace(/-/g, "")}`,
  };
}

function pickStandingsTable(tables) {
  for (const t of tables) {
    if (t.rows.length < 2) continue;
    const numericLead = t.rows.filter((r) => /^\d+\.?$/.test(r[0] || "")).length;
    const hasJoinedScore = t.rows.some((r) => r.some((c) => /^\d+\s*:\s*\d+$/.test(c)));
    const hasSplitScore  = t.rows.some((r) => r.some((c) => c === ":"));
    if (numericLead >= 2 && (hasJoinedScore || hasSplitScore)) return t;
  }
  return null;
}

function shapeStandings(url, dom, table) {
  const rows = table.rows
    .filter((r) => /^\d+\.?$/.test(r[0] || ""))
    .map((r) => {
      const cells = [...r];
      const idx = cells.findIndex((c) => c === ":");
      let gf = null, ga = null;
      if (idx > 0 && idx < cells.length - 1) {
        gf = cells[idx - 1]; ga = cells[idx + 1];
        cells.splice(idx - 1, 3, `${gf}:${ga}`);
      }
      const [pos, team, mp, w, d, l, gfga, gd, pts] = cells;
      if (gf == null && gfga) {
        const m = String(gfga).match(/^(\d+)\s*:\s*(\d+)$/);
        if (m) { gf = m[1]; ga = m[2]; }
      }
      return { pos: String(pos ?? "").replace(/\.$/, ""), team, mp, w, d, l, gf: gf ?? "", ga: ga ?? "", gd, pts };
    });
  const groupTitle = dom.h3?.[0] || dom.h1?.[0] || "Standings";
  const csv_rows = [
    ["position","team","mp","w","d","l","gf","ga","gd","pts"],
    ...rows.map((r) => [r.pos, r.team, r.mp, r.w, r.d, r.l, r.gf, r.ga, r.gd, r.pts]),
  ];
  return {
    kind: "standings", source_url: url, title: dom.title,
    summary: `Standings · ${groupTitle} · ${rows.length} teams`,
    data: { group: groupTitle, rows },
    csv_rows,
    csv_filename_hint: `standings-${slug(groupTitle)}`,
  };
}

function pickMatchListTable(tables) {
  for (const t of tables) {
    if (t.rowCount < 3) continue;
    const matchish = t.rows.filter((r) => {
      const joined = r.join(" ");
      return /\d{1,2}\.\d{1,2}\.\d{4}/.test(joined) && /[A-Za-zÄÖÜäöü].+\s[-–]\s.+[A-Za-zÄÖÜäöü]/.test(joined);
    });
    if (matchish.length >= 3) return t;
  }
  return null;
}

function shapeMatchList(url, dom, table) {
  const head = table.rows[0]?.length > 0 && !/\d{1,2}\.\d{1,2}\.\d{4}/.test(table.rows[0].join(" "))
    ? table.rows[0]
    : table.rows[0].map((_, i) => `col_${i + 1}`);
  const body = table.rows.slice(head === table.rows[0] ? 1 : 0);
  return {
    kind: "match_list", source_url: url, title: dom.title,
    summary: `Match list · ${body.length} rows`,
    data: { rows: body.length },
    csv_rows: [head, ...body],
    csv_filename_hint: `matchlist-${slug(dom.h1?.[0] || dom.title || "list")}`,
  };
}

function shapeGeneric(url, dom) {
  const biggest = [...dom.tables].sort((a, b) => b.rowCount - a.rowCount)[0];
  if (biggest && biggest.rowCount >= 2) {
    return {
      kind: "generic_table", source_url: url, title: dom.title,
      summary: `Generic table · ${biggest.rowCount - 1} rows`,
      data: { rows: biggest.rowCount - 1 },
      csv_rows: [biggest.rows[0], ...biggest.rows.slice(1)],
      csv_filename_hint: `table-${slug(dom.title || "page")}`,
    };
  }
  return {
    kind: "generic_text", source_url: url, title: dom.title,
    summary: `Page text · ${dom.mainText.length} chars`,
    data: { chars: dom.mainText.length },
    csv_rows: [
      ["title","url","h1","text_snippet"],
      [dom.title || "", url, (dom.h1 || []).join(" | "), dom.mainText.slice(0, 1000)],
    ],
    csv_filename_hint: `page-${slug(dom.title || "page")}`,
  };
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
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const bytes = new TextEncoder().encode(csv);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const hint = (s.csv_filename_hint || s.kind || "scrape").replace(/[^a-z0-9-]+/gi, "-");
  const filename = `${hint}-${stamp}.csv`;
  const path = `${job.user_id}/${filename}`;

  const { error: upErr } = await sb.storage.from("exports").upload(path, bytes, {
    contentType: "text/csv", upsert: true,
  });
  if (upErr) throw upErr;

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
function parseDateDmy(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}
function slug(s) {
  return String(s || "page").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "page";
}
