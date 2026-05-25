// Generic page scraper. Opens any URL with Playwright (handles Cloudflare /
// JS-heavy sites) and figures out what's worth extracting.
//
//   - match detail     → Spielnummer + teams + score
//   - standings table  → ranking rows (Pos, Team, MP, W, D, L, GF:GA, GD, Pts)
//   - match list       → multiple kickoff + team rows
//   - generic          → first meaningful table, or just title + text snippet
//
// Always returns { kind, csv_rows, summary } so the pipeline can build an
// export no matter what type of page is on the other end.
import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------
export async function scrapeUrl(url, { onProgress } = {}) {
  validateUrl(url);

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 1600 },
    });
    const page = await ctx.newPage();

    onProgress?.({ phase: "navigate", detail: url });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait through Cloudflare interstitial if present.
    for (let i = 0; i < 30; i++) {
      const t = await page.title().catch(() => "");
      if (!/just a moment/i.test(t)) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

    onProgress?.({ phase: "extract" });

    const dom = await page.evaluate(extractDom);
    onProgress?.({ phase: "classify" });

    return classifyAndShape(url, dom);
  } finally {
    await browser.close();
  }
}

function validateUrl(u) {
  try { new URL(u); }
  catch { throw new Error("source_url must be a valid URL"); }
}

// ---------------------------------------------------------------------
// DOM extraction (runs in the browser)
// ---------------------------------------------------------------------
function extractDom() {
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

  const main = document.querySelector("#mainContent, main, .matchcenter") || document.body;
  const mainText = clean(main?.innerText || "");
  const fullText = clean(document.body?.innerText || "");

  // Walk up from `el` looking for the closest preceding heading-like text so we
  // can label each table (e.g. "3RD LEAGUE - GROUP 1"). Falls back to the
  // table's caption / first single-cell row if no sibling heading is found.
  const sectionLabelFor = (el) => {
    let cursor = el;
    for (let hop = 0; hop < 4 && cursor; hop++) {
      let sib = cursor.previousElementSibling;
      while (sib) {
        const txt = clean(sib.innerText || sib.textContent || "");
        if (txt && txt.length <= 120 && /[a-zA-Z]/.test(txt)) {
          if (sib.matches?.("h1,h2,h3,h4,h5,h6,caption,legend")) return txt;
          if (txt.length <= 60) return txt;
        }
        sib = sib.previousElementSibling;
      }
      cursor = cursor.parentElement;
    }
    const cap = el.querySelector?.("caption");
    if (cap) return clean(cap.textContent);
    const firstRow = el.rows?.[0];
    if (firstRow && firstRow.cells.length === 1) return clean(firstRow.cells[0].textContent);
    return "";
  };

  const tables = [...document.querySelectorAll("table")].map((t, i) => {
    const rows = [...t.rows].map((r) => [...r.cells].map((c) => clean(c.textContent)));
    return { idx: i, rowCount: rows.length, rows, section: sectionLabelFor(t) };
  }).filter((t) => t.rowCount > 0);

  const matchPanel =
    [...document.querySelectorAll("div, section, article")]
      .find((d) => /Spielnummer\s*:?\s*\d+/i.test(d.textContent || ""));
  const matchPanelText = matchPanel ? matchPanel.innerText : null;

  const lineupSection = document.querySelector("[id*='Aufstellung'], [class*='Aufstellung'], [id*='lineup']");
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
    fullText,
    tables,
    matchPanelText,
    lineupRows,
    matchPanelHasContent: !!matchPanel,
  };
}

// ---------------------------------------------------------------------
// Classify the page and produce CSV rows + structured summary
// ---------------------------------------------------------------------
function classifyAndShape(url, dom) {
  // 1. Single match detail (has "Spielnummer: XXXX")
  if (dom.matchPanelHasContent && /Spielnummer\s*:?\s*\d+/i.test(dom.matchPanelText || "")) {
    return shapeMatchDetail(url, dom);
  }

  // 2. Standings table(s) — numeric-heavy tables with a "team" column + final-row points
  const standings = pickStandingsTables(dom.tables);
  if (standings.length) return shapeStandings(url, dom, standings);

  // 3. Match list — rows like "DD.MM.YYYY HH:MM Home - Away" or similar
  const matchList = pickMatchListTable(dom.tables);
  if (matchList) return shapeMatchList(url, dom, matchList);

  // 4. Generic — pick the largest table or just dump title + text snippet
  return shapeGeneric(url, dom);
}

// ---------------------------------------------------------------------
// Shapers
// ---------------------------------------------------------------------
function shapeMatchDetail(url, dom) {
  const text = dom.matchPanelText || "";
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

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
  const scoreMatch = scoreLine.match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (scoreMatch) { homeScore = +scoreMatch[1]; awayScore = +scoreMatch[2]; played = true; }

  const date = parseDateDmy(dateRaw);

  const csv_rows = [
    ["spielnummer","competition","date","venue","home","home_score","away_score","away","played","source_url"],
    [spielnummer ?? "", competition ?? "", date ?? "", venue ?? "", homeName ?? "",
     homeScore ?? "", awayScore ?? "", awayName ?? "", played ? "yes" : "no", url],
  ];

  return {
    kind: "match",
    source_url: url,
    title: dom.title,
    summary: `Match · ${homeName || "?"} ${played ? `${homeScore}–${awayScore}` : "vs"} ${awayName || "?"} · ${date || "TBD"}`,
    data: {
      spielnummer, competition, date, venue,
      home_name: homeName, away_name: awayName,
      home_score: homeScore, away_score: awayScore, played,
      lineup_rows: dom.lineupRows,
    },
    csv_rows,
    csv_filename_hint: matchFilename(homeName, awayName, spielnummer),
  };
}

function matchFilename(home, away, spielnummer) {
  if (home && away) return friendlyName(`${home} vs ${away}`);
  if (home || away) return friendlyName(home || away);
  return friendlyName(spielnummer ? `Match ${spielnummer}` : "Match");
}

function pickStandingsTables(tables) {
  // Heuristic: most rows start with "1."/"2."/"3." (position) and the table
  // contains either a "GF:GA" cell ("4 : 3") OR has a lone ":" separator cell.
  // Returns ALL matching tables so multi-group pages (e.g. "3rd League — Group
  // 1 / Group 2") export every group, not just the first.
  const matches = [];
  for (const t of tables) {
    if (t.rows.length < 2) continue;
    const numericLead = t.rows.filter((r) => /^\d+\.?$/.test(r[0] || "")).length;
    const hasJoinedScore = t.rows.some((r) => r.some((c) => /^\d+\s*:\s*\d+$/.test(c)));
    const hasSplitScore  = t.rows.some((r) => r.some((c) => c === ":"));
    if (numericLead >= 2 && (hasJoinedScore || hasSplitScore)) matches.push(t);
  }
  return matches;
}

function parseStandingsRows(table) {
  // Common SFV layout: Pos | Team | MP | W | D | L | GF | : | GA | GD | Pts | (logo?)
  // Compact to: position, team, mp, w, d, l, gf, ga, gd, pts
  return table.rows
    .filter((r) => /^\d+\.?$/.test(r[0] || ""))
    .map((r) => {
      // Re-glue "X : Y" if it landed in three cells (X, ":", Y)
      const cells = [...r];
      const idx = cells.findIndex((c) => c === ":");
      let gf = null, ga = null;
      if (idx > 0 && idx < cells.length - 1) {
        gf = cells[idx - 1];
        ga = cells[idx + 1];
        cells.splice(idx - 1, 3, `${gf}:${ga}`);
      }
      const [pos, team, mp, w, d, l, gfga, gd, pts] = cells;
      if (gf == null && gfga) {
        const m = String(gfga).match(/^(\d+)\s*:\s*(\d+)$/);
        if (m) { gf = m[1]; ga = m[2]; }
      }
      return { pos: stripDot(pos), team, mp, w, d, l, gf: gf ?? "", ga: ga ?? "", gd, pts };
    });
}

function shapeStandings(url, dom, tables) {
  const pageTitle = dom.h1?.[0] || dom.h3?.[0] || dom.title || "Standings";
  const groups = tables.map((t) => ({
    label: t.section || pageTitle,
    rows: parseStandingsRows(t),
  })).filter((g) => g.rows.length > 0);

  const totalTeams = groups.reduce((n, g) => n + g.rows.length, 0);
  const csv_rows = [
    [
      "Group", "Position", "Team",
      "Matches Played", "Wins", "Draws", "Losses",
      "Goals For", "Goals Against", "Goal Difference", "Points",
    ],
    ...groups.flatMap((g) =>
      g.rows.map((r) => [g.label, r.pos, r.team, r.mp, r.w, r.d, r.l, r.gf, r.ga, r.gd, r.pts]),
    ),
  ];

  const summary = groups.length > 1
    ? `Standings · ${groups.length} groups · ${totalTeams} teams`
    : `Standings · ${groups[0]?.label ?? pageTitle} · ${totalTeams} teams`;

  return {
    kind: "standings",
    source_url: url,
    title: dom.title,
    summary,
    data: { groups, group_count: groups.length, team_count: totalTeams },
    csv_rows,
    csv_filename_hint: standingsFilename(pageTitle, groups),
  };
}

function standingsFilename(pageTitle, groups) {
  // Prefer the first group label (e.g. "3RD LEAGUE - GROUP 1") when it carries
  // league info; otherwise fall back to the page title.
  const firstLabel = groups[0]?.label || "";
  const base = firstLabel.length > 4 && /[a-z]/i.test(firstLabel) ? firstLabel : pageTitle;
  if (groups.length > 1) {
    // Strip any trailing "Group N" so a multi-group export reads cleanly.
    const cleaned = base.replace(/\s*[-–]\s*Group\s*\d+\s*$/i, "").trim() || base;
    return friendlyName(`${cleaned} Standings`);
  }
  return friendlyName(base);
}

function pickMatchListTable(tables) {
  // Heuristic: at least 3 rows containing a date like DD.MM.YYYY AND a dash-separated team pair.
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
  // Just dump the table cells verbatim — schemas vary across pages.
  const head = table.rows[0]?.length > 0 && !/\d{1,2}\.\d{1,2}\.\d{4}/.test(table.rows[0].join(" "))
    ? table.rows[0]
    : table.rows[0].map((_, i) => `col_${i + 1}`);
  const body = table.rows.slice(head === table.rows[0] ? 1 : 0);
  const csv_rows = [head, ...body];

  return {
    kind: "match_list",
    source_url: url,
    title: dom.title,
    summary: `Match list · ${body.length} rows`,
    data: { rows: body.length },
    csv_rows,
    csv_filename_hint: friendlyName(`${dom.h1?.[0] || dom.title || "Match List"} Matches`),
  };
}

function shapeGeneric(url, dom) {
  // If there's ANY table, use the largest. Otherwise dump title + first 500
  // chars of text into a single-row CSV.
  const biggest = [...dom.tables].sort((a, b) => b.rowCount - a.rowCount)[0];
  if (biggest && biggest.rowCount >= 2) {
    const head = biggest.rows[0];
    const body = biggest.rows.slice(1);
    return {
      kind: "generic_table",
      source_url: url,
      title: dom.title,
      summary: `Generic table · ${body.length} rows`,
      data: { rows: body.length },
      csv_rows: [head, ...body],
      csv_filename_hint: friendlyName(dom.h1?.[0] || dom.title || "Table"),
    };
  }

  return {
    kind: "generic_text",
    source_url: url,
    title: dom.title,
    summary: `Page text · ${dom.mainText.length} chars`,
    data: { chars: dom.mainText.length },
    csv_rows: [
      ["title", "url", "h1", "text_snippet"],
      [dom.title || "", url, (dom.h1 || []).join(" | "), dom.mainText.slice(0, 1000)],
    ],
    csv_filename_hint: friendlyName(dom.h1?.[0] || dom.title || "Page"),
  };
}

// ---------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------
function parseDateDmy(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}
function stripDot(s) { return String(s ?? "").replace(/\.$/, ""); }
function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 40) || "page";
}

// Build a download-friendly filename stem from an arbitrary title. Keeps the
// name human-readable (letters, digits, spaces, dashes, parens, ampersand)
// and truncates long titles at a word boundary so the final filename stays
// under ~60 chars before the date/extension are appended.
function friendlyName(s, maxLen = 60) {
  const cleaned = String(s ?? "")
    .replace(/[ -]/g, "")
    .replace(/[/\\:*?"<>|]+/g, " ")
    .replace(/[·•|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "scrape";
  if (cleaned.length <= maxLen) return cleaned;
  const cut = cleaned.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
}
