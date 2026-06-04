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
export async function scrapeUrl(url, { onProgress, retries = 2 } = {}) {
  validateUrl(url);

  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({
        userAgent: UA,
        viewport: { width: 1280, height: 1600 },
      });
      const page = await ctx.newPage();

      onProgress?.({ phase: "navigate", detail: url, attempt });
      // Timeout handling: bounded navigation + idle waits.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

      // Wait through Cloudflare interstitial if present.
      for (let i = 0; i < 30; i++) {
        const t = await page.title().catch(() => "");
        if (!/just a moment/i.test(t)) break;
        await page.waitForTimeout(1000);
      }
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

      // Tab switching + delayed content: click the Aufstellung (lineup) tab so
      // its panel is fully rendered, then give late content a moment to load.
      await page.evaluate(() => {
        const tab = [...document.querySelectorAll("a, li, button, span")]
          .find((e) => /Aufstellung/i.test(e.textContent || "") &&
            ((e.id || "").includes("Aufstellung") || (e.getAttribute?.("href") || "").includes("Aufstellung")));
        try { tab?.click?.(); } catch { /* ignore */ }
      }).catch(() => {});
      await page.waitForTimeout(700);

      onProgress?.({ phase: "extract" });
      const dom = await page.evaluate(extractDom);
      onProgress?.({ phase: "classify" });

      return classifyAndShape(url, dom);
    } catch (e) {
      lastErr = e;
      onProgress?.({ phase: "retry", attempt, error: e?.message });
      // brief backoff before the next attempt
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    } finally {
      await browser.close();
    }
  }
  throw lastErr || new Error("scrape failed");
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

  // -------------------------------------------------------------------
  // Swiss FV "telegramm" match page (aff-ffv.ch / nisRD telegramm system).
  // Structured lineups (.aufName/.aufPos + tor.gif goal icons), team columns
  // (.eventsTeamName), and a goal ticker. Returns null on non-telegramm pages.
  // -------------------------------------------------------------------
  const telegramm = (() => {
    // The content pane id ends with "_Aufstellung"; a nav <li> id ends with
    // "AufstellungItem" — so prefer the exact suffix, then fall back to any
    // container that actually holds player names.
    let auf = document.querySelector("[id$='_Aufstellung']");
    if (!auf || !auf.querySelector(".aufName")) {
      auf = [...document.querySelectorAll("[id*='Aufstellung'], .tab-pane")]
        .find((el) => el.querySelector?.(".aufName")) || null;
    }
    if (!auf || !auf.querySelector(".aufName")) return null;

    const cols = [...auf.querySelectorAll(".col-sm-6")];
    const sources = cols.length >= 2 ? cols : [auf];
    const teams = sources.map((col) => {
      const name = clean(col.querySelector(".eventsTeamName, h4")?.textContent || "");
      const table = col.querySelector("table");
      const players = [];
      const trainers = [];
      const absent = [];
      let section = "starter";
      if (table) {
        for (const row of [...table.rows]) {
          const cells = [...row.cells];
          if (cells.length === 1) {
            const tt = clean(cells[0].textContent);
            if (/Ersatz/i.test(tt)) section = "bench";
            else if (/Trainer/i.test(tt)) section = "coach";
            else if (/Absent|Abwesend|Verletzt|Gesperrt/i.test(tt)) section = "absent";
            continue;
          }
          if (cells.length < 2) continue;
          const num = clean(cells[0].textContent);
          const nameEl = cells[1].querySelector(".aufName");
          const rawName = clean(nameEl?.textContent || cells[1].textContent);
          const name2 = rawName.replace(/\(C\)\s*$/, "").trim();
          if (!name2) continue;
          if (section === "coach") { trainers.push(name2); continue; }
          if (section === "absent") { absent.push({ num, name: name2 }); continue; }
          const position = clean(cells[1].querySelector(".aufPos")?.textContent || "");
          const goals = row.querySelectorAll("img[src*='tor.gif']").length;
          const captain = !!cells[1].querySelector(".aufCaptain") || /\(C\)/.test(rawName);
          players.push({ num, name: name2, position, goals, role: section, captain });
        }
      }
      return { name, players, trainers, absent, coach: trainers[0] || "" };
    });

    // Verlauf ticker: a <ul class="bnEventsList timeline-2"> of <li> events.
    // Each li: <time .timeline-time>, <img .fileicon alt="Tor|Auswechslung|…">,
    // <div .eventlabel goal|card|substitution> + the score + player text.
    let ticker = document.querySelector("[id$='_Ticker']");
    if (!ticker || !ticker.querySelector(".bnEventsList, ul.timeline-2, .eventlabel")) {
      ticker = [...document.querySelectorAll("[id*='Ticker'], .tab-pane")]
        .find((el) => el.querySelector?.(".bnEventsList, ul.timeline-2, .eventlabel")) || ticker;
    }
    const rawEvents = [];
    const ul = ticker?.querySelector(".bnEventsList, ul.timeline-2");
    if (ul) {
      for (const li of [...ul.querySelectorAll(":scope > li")]) {
        const labelEl = li.querySelector(".eventlabel");
        const full = clean(li.innerText);
        const scoreM = full.match(/\b(\d+:\d+)\b/);
        rawEvents.push({
          minute: clean(li.querySelector(".timeline-time")?.textContent || ""),
          labelCls: labelEl?.className || "",
          labelTxt: clean(labelEl?.textContent || ""),
          iconAlt: li.querySelector("img.fileicon")?.getAttribute("alt") || "",
          score: scoreM ? scoreM[1] : "",
          full,
        });
      }
      rawEvents.reverse(); // ticker lists latest-first → make chronological
    }
    return { teams, rawEvents };
  })();

  // Same-host links to individual telegramm match pages (default.aspx?...tg=NNN).
  // A matchday / group page lists many of these; a single match page lists none.
  const here = location.origin;
  const matchLinks = [...new Set(
    [...document.querySelectorAll("a[href]")]
      .map((a) => a.href)
      .filter((h) => {
        try {
          const u = new URL(h, here);
          return u.origin === here && /default\.aspx/i.test(u.pathname) && /\btg=\d{3,}/i.test(u.search);
        } catch { return false; }
      })
  )];

  return {
    title: document.title || "",
    h1: [...document.querySelectorAll("h1")].map((el) => clean(el.textContent)).filter(Boolean),
    h3: [...document.querySelectorAll("h3")].map((el) => clean(el.textContent)).filter(Boolean),
    mainText,
    fullText,
    tables,
    matchPanelText,
    lineupRows,
    telegramm,
    matchLinks,
    matchPanelHasContent: !!matchPanel,
  };
}

// ---------------------------------------------------------------------
// Classify the page and produce CSV rows + structured summary
// ---------------------------------------------------------------------
function classifyAndShape(url, dom) {
  // 0. Swiss FV telegramm match page — full lineups + goal ticker available.
  if (dom.telegramm && dom.telegramm.teams?.some((t) => t.players?.length)) {
    return shapeTelegramm(url, dom);
  }

  // 0.5 Matchday / group page — lists links to several telegramm match pages.
  //     Strictly gated (≥3 distinct match links) so a single match page never
  //     trips it (those carry zero sibling match links).
  if (!dom.telegramm && (dom.matchLinks?.length ?? 0) >= 3) {
    return shapeMatchLinks(url, dom);
  }

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
// ---------------------------------------------------------------------
// Swiss FV telegramm — full match: meta + events + both lineups + goals.
// Produces multi-sheet output (Match / Events / Players) so the export
// carries every player's details, not just the scoreline.
// ---------------------------------------------------------------------
function shapeTelegramm(url, dom) {
  const tg = dom.telegramm;
  const lines = (dom.matchPanelText || "")
    .split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

  const headerLine = lines.find((l) => /Spielnummer\s*:?\s*\d+/i.test(l)) || "";
  const spielnummer = (headerLine.match(/Spielnummer\s*:?\s*(\d+)/i) || [])[1] || null;
  const dm = headerLine.match(/(\d{1,2}\.\d{1,2}\.\d{4})(?:\s+(\d{1,2}:\d{2}))?/);
  const dateRaw = dm?.[1] || null;
  const time = dm?.[2] || null;
  const date = parseDateDmy(dateRaw);

  let competition = headerLine;
  if (dateRaw) competition = headerLine.split(dateRaw)[0];
  competition = competition.replace(/[-\s]+$/, "").replace(/^Match center\s*/i, "").trim();

  const hi = lines.indexOf(headerLine);
  let venue = null;
  for (let i = hi + 1; i < lines.length && i <= hi + 2; i++) {
    if (/^-/.test(lines[i])) { venue = lines[i].replace(/^[-\s]+/, "").trim(); break; }
  }

  const scoreLine = lines.find((l) => /^\d+\s*:\s*\d+$/.test(l));
  let homeScore = null, awayScore = null, played = false;
  if (scoreLine) {
    const m = scoreLine.match(/(\d+)\s*:\s*(\d+)/);
    homeScore = +m[1]; awayScore = +m[2]; played = true;
  }
  const halftime = (lines.find((l) => /^\(\d+\s*:\s*\d+\)$/.test(l)) || "").replace(/[()]/g, "") || null;

  const home = tg.teams[0] || { name: "", players: [], coach: "" };
  const away = tg.teams[1] || { name: "", players: [], coach: "" };
  const homeName = home.name || "Home";
  const awayName = away.name || "Away";

  const sideOf = (label) => {
    const n = norm(label);
    if (!n) return "";
    if (n.includes(norm(homeName)) || norm(homeName).includes(n)) return "home";
    if (n.includes(norm(awayName)) || norm(awayName).includes(n)) return "away";
    return "";
  };
  const parseMin = (s) => { const m = String(s ?? "").match(/(\d+)/); return m ? +m[1] : 0; };

  // ---- Classify each ticker event: goal / substitution / card ----
  const events = (tg.rawEvents || []).map((r) => {
    const cls = `${r.labelCls} ${r.iconAlt}`.toLowerCase();
    let type = "goal";
    if (/card|karte|gelb|rot/.test(cls)) type = "card";
    else if (/sub|wechsel|ausw|einw/.test(cls)) type = "sub";
    const side = sideOf(r.labelTxt) || sideOf(r.full);
    let scorer = null, playerIn = null, playerOut = null, player = null, detail = "";
    if (type === "goal") {
      scorer = (r.full.match(/Torsch[üu]tze\s+(.+)$/i) || [])[1]?.trim() || null;
    } else if (type === "sub") {
      playerIn = (r.full.match(/Ein\w*\s*[:\s]\s*([^,]+?)(?=\s+Aus|\s*$)/i) || [])[1]?.trim() || null;
      playerOut = (r.full.match(/Aus\w*\s*[:\s]\s*(.+)$/i) || [])[1]?.trim() || null;
      detail = "Substitution";
    } else if (type === "card") {
      player = (r.full.replace(/^.*?(Karte|Verwarnung|Card)\s*/i, "") || "").trim() || null;
      detail = /gelb.?rot|gelb-rot|second|2\..?gelb/i.test(cls) ? "Second yellow (off)"
             : /rot|red/.test(cls) ? "Red card (off)" : "Yellow card";
    }
    return { minute: r.minute, minuteNum: parseMin(r.minute), score: r.score, side, type, scorer, playerIn, playerOut, player, detail };
  });

  // ---- Reconstruct on-pitch timelines ----
  const allPlayers = [
    ...home.players.map((p) => ({ ...p, side: "home", team: homeName })),
    ...away.players.map((p) => ({ ...p, side: "away", team: awayName })),
  ];
  for (const p of allPlayers) {
    if (p.role === "starter") { p.minutes_on = 0; p.minutes_off = 90; p.played = true; }
    else { p.minutes_on = null; p.minutes_off = null; p.played = false; }
  }
  const findPlayer = (side, name) => {
    if (!name) return null;
    const nn = norm(name);
    return allPlayers.find((p) => p.side === side && (norm(p.name) === nn || norm(p.name).includes(nn) || nn.includes(norm(p.name))));
  };
  for (const e of events) {
    if (e.type === "sub" && e.side) {
      const po = findPlayer(e.side, e.playerOut); if (po) po.minutes_off = e.minuteNum;
      const pi = findPlayer(e.side, e.playerIn);  if (pi) { pi.minutes_on = e.minuteNum; pi.minutes_off = 90; pi.played = true; }
    }
    if (e.type === "card" && /off/i.test(e.detail) && e.side) {
      const pp = findPlayer(e.side, e.player); if (pp) pp.minutes_off = Math.min(pp.minutes_off ?? 90, e.minuteNum);
    }
  }

  // ---- Goals scored / conceded while each player was on the pitch ----
  const goalEvents = events.filter((e) => e.type === "goal" && e.side);
  for (const p of allPlayers) {
    p.goals_for = 0; p.goals_against = 0;
    if (!p.played) continue;
    const on = p.minutes_on ?? 0, off = p.minutes_off ?? 90;
    for (const g of goalEvents) {
      if (g.minuteNum >= on && g.minuteNum <= off) {
        if (g.side === p.side) p.goals_for++; else p.goals_against++;
      }
    }
  }

  const roleLabel = (p) => (p.role === "starter" ? "Starter" : p.played ? "Sub" : "Bench");
  const minutes = (p) => (p.played ? Math.max((p.minutes_off ?? 90) - (p.minutes_on ?? 0), 0) : 0);

  // Flat players table (used for the CSV — best for downstream tools).
  const playersSheet = [
    ["Team", "No", "Player", "Position", "Role", "On (min)", "Off (min)", "Minutes",
     "Goals", "Goals For (on pitch)", "Goals Against (on pitch)"],
    ...allPlayers.map((p) => [
      p.team, p.num || "", p.name + (p.captain ? " (C)" : ""), p.position || "",
      roleLabel(p),
      p.played ? (p.minutes_on ?? 0) : "",
      p.played ? (p.minutes_off ?? 90) : "",
      minutes(p), p.goals || 0,
      p.played ? p.goals_for : "", p.played ? p.goals_against : "",
    ]),
  ];

  // Team-grouped layout for the XLSX: each team gets its own banner, then
  // Starting XI, then Substitutes, with a gap before the next team.
  const PLAYER_COLS = ["No", "Player", "Position", "Role", "On (min)", "Off (min)",
    "Minutes", "Goals", "Goals For (on pitch)", "Goals Against (on pitch)"];
  const playerRow = (p) => [
    p.num || "", p.name + (p.captain ? " (C)" : ""), p.position || "", roleLabel(p),
    p.played ? (p.minutes_on ?? 0) : "",
    p.played ? (p.minutes_off ?? 90) : "",
    minutes(p), p.goals || 0,
    p.played ? p.goals_for : "", p.played ? p.goals_against : "",
  ];
  // A name-only row (Trainer / Absent) using the same column layout.
  const simpleRow = (num, name, role) => [num || "", name, "", role, "", "", "", "", "", ""];
  const teamSection = (name, side, score, teamObj) => {
    const ps = allPlayers.filter((p) => p.side === side);
    const subs = ps.filter((p) => p.role !== "starter");
    const groups = [
      { label: "Starting XI", rows: ps.filter((p) => p.role === "starter").map(playerRow) },
    ];
    if (subs.length) groups.push({ label: "Substitutes", rows: subs.map(playerRow) });
    if (teamObj.trainers?.length) groups.push({ label: "Trainer", rows: teamObj.trainers.map((n) => simpleRow("", n, "Trainer")) });
    if (teamObj.absent?.length) groups.push({ label: "Absent", rows: teamObj.absent.map((a) => simpleRow(a.num, a.name, "Absent")) });
    return { name, score, groups };
  };
  const playersTeamSheet = {
    name: "Players",
    layout: "teams",
    columns: PLAYER_COLS,
    teams: [teamSection(homeName, "home", homeScore, home), teamSection(awayName, "away", awayScore, away)],
  };

  // Mirror Trainer / Absent into the flat CSV so it carries everything too.
  for (const [t, side] of [[home, "home"], [away, "away"]]) {
    (t.trainers || []).forEach((n) => playersSheet.push([t.name, "", n, "", "Trainer", "", "", "", "", "", ""]));
    (t.absent || []).forEach((a) => playersSheet.push([t.name, a.num || "", a.name, "", "Absent", "", "", "", "", "", ""]));
  }

  const teamName = (side) => (side === "home" ? homeName : side === "away" ? awayName : "");
  const eventsSheet = [
    ["Minute", "Type", "Team", "Player", "Detail", "Score"],
    ...events.map((e) => [
      e.minute,
      e.type === "sub" ? "Substitution" : e.type === "card" ? "Card" : "Goal",
      teamName(e.side),
      e.type === "sub" ? `${e.playerIn || "?"} ← ${e.playerOut || "?"}` : (e.scorer || e.player || ""),
      e.detail || "", e.score || "",
    ]),
  ];

  const matchSheet = [
    ["Spielnummer", "Competition", "Date", "Time", "Venue",
     "Home", "Home Score", "Away Score", "Away", "Half-time", "Played", "Source URL"],
    [spielnummer ?? "", competition ?? "", date ?? "", time ?? "", venue ?? "",
     homeName, homeScore ?? "", awayScore ?? "", awayName, halftime ?? "",
     played ? "yes" : "no", url],
  ];

  const goals = events.filter((e) => e.type === "goal").length;
  const subs = events.filter((e) => e.type === "sub").length;
  const cards = events.filter((e) => e.type === "card").length;
  return {
    kind: "match",
    source_url: url,
    title: dom.title,
    summary: `Match · ${homeName} ${played ? `${homeScore}–${awayScore}` : "vs"} ${awayName} · ${allPlayers.length} players · ${goals} goals · ${subs} subs · ${cards} cards`,
    data: {
      spielnummer, competition, date, time, venue,
      home_name: homeName, away_name: awayName,
      home_score: homeScore, away_score: awayScore, played, halftime,
      home_coach: home.coach, away_coach: away.coach,
      events,
      players: allPlayers.map((p) => ({
        num: p.num, name: p.name, position: p.position, side: p.side, team: p.team,
        role: p.role, captain: p.captain, goals: p.goals || 0, played: p.played,
        minutes_on: p.minutes_on ?? 0, minutes_off: p.minutes_off ?? (p.played ? 90 : 0),
        goals_for: p.goals_for || 0, goals_against: p.goals_against || 0,
      })),
    },
    csv_rows: playersSheet,
    sheets: [
      { name: "Match", rows: matchSheet },
      playersTeamSheet,
      { name: "Events", rows: eventsSheet },
    ],
    csv_filename_hint: matchFilename(homeName, awayName, spielnummer),
  };
}

// A matchday / group page: a list of links to individual match telegramms.
// The pipeline fans these out into one child scrape job per match.
function shapeMatchLinks(url, dom) {
  const urls = [...new Set(dom.matchLinks || [])];
  const title = dom.h1?.[0] || dom.title || "Matchday";
  return {
    kind: "matchday",
    source_url: url,
    title: dom.title,
    summary: `Matchday · ${urls.length} matches found`,
    data: { match_urls: urls, count: urls.length },
    csv_rows: [["match_url"], ...urls.map((u) => [u])],
    csv_filename_hint: friendlyName(`${title} Matches`),
  };
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\bfc\b|\bfussball\b|\bclub\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

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
    .replace(/[/\\:*?"<>|+&#%=@]+/g, " ")
    .replace(/[·•|]+/g, "-")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "scrape";
  if (cleaned.length <= maxLen) return cleaned;
  const cut = cleaned.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
}
