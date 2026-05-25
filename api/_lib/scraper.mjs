// axios + cheerio scraper. Replaces the Playwright/Chromium pipeline so the
// scrape function can run inside Vercel's serverless runtime (no headless
// browser, no 250MB Chromium tarball, no LD_LIBRARY_PATH hacks).
//
// Trade-off: this can't execute JavaScript, so it only works for server-
// rendered HTML (ASP.NET, traditional CMS pages, etc.). Most of our target
// sites — matchcenter.afv.ch, kicker.de listings, openligadb — fit that bill.
import axios from "axios";
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

// Full set of headers a real Chrome 132 on Windows sends for a top-level
// navigation. Many anti-bot WAFs (matchcenter.afv.ch included) 403 plain
// axios requests because the Sec-Fetch-* / Sec-Ch-Ua-* / Accept-Encoding
// combination is missing.
function browserHeaders(url) {
  const { origin } = new URL(url);
  return {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Sec-Ch-Ua": '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Referer": origin + "/",
  };
}

export async function scrapeUrl(url, { onProgress } = {}) {
  try { new URL(url); } catch { throw new Error("source_url must be a valid URL"); }

  onProgress?.({ phase: "navigate", detail: url });

  let res;
  try {
    res = await axios.get(url, {
      headers: browserHeaders(url),
      timeout: 30000,
      responseType: "text",
      decompress: true,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 403 || status === 429) {
      throw new Error(
        `${url} returned ${status} — the site is blocking the request (likely datacenter-IP / anti-bot). ` +
        `Run the scrape from the local server, or use a proxy/scraping-service for this host.`,
      );
    }
    if (status) throw new Error(`${url} returned HTTP ${status}`);
    throw err;
  }

  onProgress?.({ phase: "extract" });
  const $ = cheerio.load(res.data);
  const dom = extractDom($);

  onProgress?.({ phase: "classify" });
  return classifyAndShape(url, dom);
}

// ---------------------------------------------------------------------
// DOM extraction (cheerio)
// ---------------------------------------------------------------------
function extractDom($) {
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const text = (el) => clean($(el).text());

  const mainEl = $("#mainContent, main, .matchcenter").first();
  const main = mainEl.length ? mainEl : $("body");
  const mainText = clean(main.text());
  const fullText = clean($("body").text());

  // Build table data + each table's preceding section/heading label so
  // multi-section pages (e.g. "3rd League — Group 1" / "Group 2") are
  // labelled per-table rather than collapsed under one heading.
  const sectionLabelFor = (el) => {
    let cursor = $(el);
    for (let hop = 0; hop < 4 && cursor.length; hop++) {
      let sib = cursor.prev();
      while (sib.length) {
        const txt = clean(sib.text());
        if (txt && txt.length <= 120 && /[a-zA-Z]/.test(txt)) {
          if (sib.is("h1,h2,h3,h4,h5,h6,caption,legend")) return txt;
          if (txt.length <= 60) return txt;
        }
        sib = sib.prev();
      }
      cursor = cursor.parent();
    }
    const cap = $(el).find("caption").first();
    if (cap.length) return clean(cap.text());
    const firstRow = $(el).find("tr").first();
    const cells = firstRow.find("td,th");
    if (cells.length === 1) return clean(cells.first().text());
    return "";
  };

  const tables = [];
  $("table").each((i, t) => {
    const rows = [];
    $(t).find("tr").each((_, tr) => {
      const cells = [];
      $(tr).find("td,th").each((_, c) => cells.push(clean($(c).text())));
      if (cells.length) rows.push(cells);
    });
    if (rows.length) {
      tables.push({ idx: i, rowCount: rows.length, rows, section: sectionLabelFor(t) });
    }
  });

  // Match panel detection — find a container with "Spielnummer: NNNN" text
  let matchPanelText = null;
  let matchPanelHasContent = false;
  $("div, section, article").each((_, d) => {
    if (matchPanelHasContent) return;
    const txt = $(d).text();
    if (/Spielnummer\s*:?\s*\d+/i.test(txt)) {
      matchPanelHasContent = true;
      matchPanelText = clean(txt);
    }
  });

  // Lineup rows — table inside any element whose id/class hints at "Aufstellung" / "lineup"
  const lineupSection = $("[id*='Aufstellung'], [class*='Aufstellung'], [id*='lineup']").first();
  const lineupRows = [];
  if (lineupSection.length) {
    lineupSection.find("tr").each((_, tr) => {
      const cells = [];
      $(tr).find("td,th").each((_, c) => cells.push(clean($(c).text())));
      if (cells.some(Boolean)) lineupRows.push(cells);
    });
  }

  return {
    title: clean($("title").first().text()),
    h1: $("h1").map((_, el) => text(el)).get().filter(Boolean),
    h3: $("h3").map((_, el) => text(el)).get().filter(Boolean),
    mainText,
    fullText,
    tables,
    matchPanelText,
    lineupRows,
    matchPanelHasContent,
  };
}

// ---------------------------------------------------------------------
// Classify + shape (same contract as the Playwright scraper)
// ---------------------------------------------------------------------
function classifyAndShape(url, dom) {
  if (dom.matchPanelHasContent && /Spielnummer\s*:?\s*\d+/i.test(dom.matchPanelText || "")) {
    return shapeMatchDetail(url, dom);
  }
  const standings = pickStandingsTables(dom.tables);
  if (standings.length) return shapeStandings(url, dom, standings);
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
  return table.rows
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
  const firstLabel = groups[0]?.label || "";
  const base = firstLabel.length > 4 && /[a-z]/i.test(firstLabel) ? firstLabel : pageTitle;
  if (groups.length > 1) {
    const cleaned = base.replace(/\s*[-–]\s*Group\s*\d+\s*$/i, "").trim() || base;
    return friendlyName(`${cleaned} Standings`);
  }
  return friendlyName(base);
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

export function friendlyName(s, maxLen = 60) {
  const cleaned = String(s ?? "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[/\\:*?"<>|]+/g, " ")
    .replace(/[·•]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "scrape";
  if (cleaned.length <= maxLen) return cleaned;
  const cut = cleaned.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
}
