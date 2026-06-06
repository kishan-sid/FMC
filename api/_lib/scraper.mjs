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

  let html;
  // scrape.do takes top priority when configured — residential proxy +
  // optional JS render. Falls back to ZenRows / free proxies / ScraperAPI if
  // it errors. Set SCRAPE_DO_API_KEY in Vercel env vars to enable.
  if (process.env.SCRAPE_DO_API_KEY) {
    try {
      onProgress?.({ phase: "navigate", detail: "Fetching via scrape.do (residential + render)" });
      html = await fetchHtmlViaScrapeDo(url);
    } catch (err) {
      onProgress?.({ phase: "navigate", detail: `scrape.do failed (${err.message}) — falling back` });
      html = await fetchHtmlViaFallbacks(url, onProgress);
    }
  } else if (process.env.ZENROWS_API_KEY) {
    // ZenRows takes precedence over ScraperAPI / free proxies when configured.
    // Paid (free-tier-capable) residential proxy + JS render service that
    // bypasses Cloudflare reliably on tougher anti-bot targets like
    // matchcenter.football.ch / matchcenter.afv.ch.
    try {
      onProgress?.({ phase: "navigate", detail: "Fetching via ZenRows (residential + JS render)" });
      html = await fetchHtmlViaZenRows(url);
    } catch (err) {
      onProgress?.({ phase: "navigate", detail: `ZenRows failed (${err.message}) — falling back` });
      html = await fetchHtmlViaFallbacks(url, onProgress);
    }
  } else {
    try {
      html = await fetchHtmlDirect(url);
      // Some sites serve the Cloudflare challenge with HTTP 200 — body is the
      // "Just a moment" wall, not the real content. Treat that exactly like a
      // 403 and escalate to the proxy/ScraperAPI fallbacks.
      if (isInterstitial(html)) {
        onProgress?.({ phase: "navigate", detail: "Cloudflare challenge on direct fetch — falling back" });
        html = await fetchHtmlViaFallbacks(url, onProgress);
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 403 || status === 429 || status === 451) {
        onProgress?.({ phase: "navigate", detail: `Direct ${status} — falling back to proxy` });
        html = await fetchHtmlViaFallbacks(url, onProgress);
      } else if (status) {
        throw new Error(`${url} returned HTTP ${status}`);
      } else {
        throw err;
      }
    }
  }

  // Final safety check — refuse to extract data out of a Cloudflare challenge
  // page so the user never gets a "Just a moment" row in their export.
  if (isInterstitial(html)) {
    throw new Error(
      "Site is Cloudflare-protected and the bypass attempts didn't return real content. " +
      "Run from the local server, retry in a minute (proxy IP may rotate), or upgrade to a Cloudflare-specialized scraper.",
    );
  }

  onProgress?.({ phase: "extract" });
  const $ = cheerio.load(html);
  const dom = extractDom($);

  onProgress?.({ phase: "classify" });
  return classifyAndShape(url, dom);
}

async function fetchHtmlViaFallbacks(url, onProgress) {
  const errors = [];
  try {
    return await fetchHtmlViaProxy(url);
  } catch (err) {
    errors.push(err.message);
  }
  if (process.env.SCRAPERAPI_KEY) {
    try {
      onProgress?.({ phase: "navigate", detail: "Free proxies failed — trying ScraperAPI" });
      return await fetchHtmlViaScraperAPI(url);
    } catch (err) {
      errors.push(`ScraperAPI → ${err.message}`);
    }
  } else {
    errors.push("SCRAPERAPI_KEY env var not set — paid fallback skipped");
  }
  throw new Error(`All fetch strategies failed. ${errors.join(" | ")}`);
}

// scrape.do fetcher — residential proxy + optional JS rendering. For
// Cloudflare-protected targets we always set render=true and super=true so
// scrape.do uses its premium rotating residential pool plus a real headless
// browser to clear the JS challenge. Country routing via geoCode improves
// IP geography matching (e.g. CH IPs for matchcenter.football.ch).
//
// API format: https://api.scrape.do/?token=<KEY>&url=<ENCODED_URL>&render=true&super=true&geoCode=ch
async function fetchHtmlViaScrapeDo(url) {
  const key = process.env.SCRAPE_DO_API_KEY;
  if (!key) throw new Error("SCRAPE_DO_API_KEY not configured");

  const country = countryCodeForHost(new URL(url).hostname);
  const params = new URLSearchParams({
    token: key,
    url,
    render: "true",
    super: "true",
  });
  if (country) params.set("geoCode", country.toUpperCase());

  const apiUrl = `https://api.scrape.do/?${params.toString()}`;
  const res = await axios.get(apiUrl, {
    timeout: 90000,
    responseType: "text",
    decompress: true,
    validateStatus: () => true,
  });

  if (res.status >= 400) {
    const detail = String(res.data || "").slice(0, 200);
    throw new Error(`scrape.do HTTP ${res.status} — ${detail}`);
  }
  const body = typeof res.data === "string" ? res.data : "";
  if (body.length < 500 || !/<\/?(html|body|table|div)/i.test(body)) {
    throw new Error(`scrape.do returned ${body.length}B (no HTML markers)`);
  }
  if (isInterstitial(body)) {
    throw new Error("scrape.do response is still a Cloudflare challenge page");
  }
  return body;
}

async function fetchHtmlDirect(url) {
  const res = await axios.get(url, {
    headers: browserHeaders(url),
    timeout: 30000,
    responseType: "text",
    decompress: true,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return res.data;
}

// Free, no-auth proxies that fetch on their own infra and stream the response
// back. Tried in order; first one to return a sensible-looking body wins.
async function fetchHtmlViaProxy(url) {
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
  ];
  const errors = [];
  for (const proxyUrl of proxies) {
    try {
      const res = await axios.get(proxyUrl, {
        headers: { "User-Agent": UA, "Accept": "text/html,*/*" },
        timeout: 45000,
        responseType: "text",
        decompress: true,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const body = typeof res.data === "string" ? res.data : "";
      if (body.length > 500 && /<\/?(html|body|table|div)/i.test(body)) {
        return body;
      }
      errors.push(`${hostOf(proxyUrl)} → ${body.length}B (no HTML markers)`);
    } catch (err) {
      const s = err?.response?.status;
      errors.push(`${hostOf(proxyUrl)} → ${s || err.message}`);
    }
  }
  throw new Error(`free proxies failed: ${errors.join("; ")}`);
}

// ScraperAPI fallback — residential IP rotation + anti-bot bypass. Free tier:
// 5000 credits/month. Set SCRAPERAPI_KEY in Vercel env vars to enable.
//
// Strategy: try cheap (1 credit) first; if the response is a Cloudflare
// interstitial, retry with render+premium (25 credits) so ScraperAPI
// renders the JS challenge in a real browser and ships the resolved HTML.
async function fetchHtmlViaScraperAPI(url) {
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) throw new Error("SCRAPERAPI_KEY not configured");
  const country = countryCodeForHost(new URL(url).hostname);

  // Three-tier escalation. Each tier may retry intra-tier on Cloudflare
  // interstitial because the next proxy IP often succeeds where the
  // previous one was already challenged.
  //   tier 1: bare fetch                   →   1 credit  (IP-only blocks)
  //   tier 2: render + premium             →  25 credits (basic Cloudflare)
  //   tier 3: render + ultra_premium       →  75 credits (hardest Cloudflare)
  //
  // `wait` makes the headless browser linger 5s after page load so the
  // Cloudflare JS challenge has time to resolve before HTML is captured.
  const tiers = [
    { name: "basic", params: {}, attempts: 1 },
    {
      name: "premium+render",
      params: { render: "true", premium: "true", wait: "5000" },
      attempts: 2,
    },
    {
      name: "ultra_premium+render",
      params: { render: "true", ultra_premium: "true", wait: "8000" },
      attempts: 3,
    },
  ];

  let lastBody = "";
  let lastErr = null;
  for (const tier of tiers) {
    for (let attempt = 1; attempt <= tier.attempts; attempt++) {
      try {
        const body = await callScraperAPI(key, url, country, tier.params);
        if (!isInterstitial(body)) return body;
        lastBody = body;
      } catch (err) {
        lastErr = err;
      }
      // Brief backoff before retrying within the same tier — gives ScraperAPI
      // a moment to rotate to a different proxy IP.
      if (attempt < tier.attempts) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  if (lastErr && !lastBody) throw lastErr;
  throw new Error(
    `ScraperAPI couldn't bypass the site's anti-bot challenge across all tiers ` +
    `(last response was a ${lastBody.length}B challenge page). ` +
    `This site may need a Cloudflare-specialized service (ZenRows / Bright Data Web Unlocker).`,
  );
}

async function callScraperAPI(key, url, country, extra) {
  const params = new URLSearchParams({ api_key: key, url, ...extra });
  if (country) params.set("country_code", country);

  const apiUrl = `https://api.scraperapi.com/?${params.toString()}`;
  const res = await axios.get(apiUrl, {
    headers: { "User-Agent": UA, "Accept": "text/html,*/*" },
    timeout: 90000,
    responseType: "text",
    decompress: true,
    validateStatus: () => true,
  });
  if (res.status >= 400) {
    throw new Error(
      `ScraperAPI HTTP ${res.status}${res.data ? ` — ${String(res.data).slice(0, 200)}` : ""}`,
    );
  }
  const body = typeof res.data === "string" ? res.data : "";
  if (body.length < 500 || !/<\/?(html|body|table|div)/i.test(body)) {
    throw new Error(`ScraperAPI returned ${body.length}B (no HTML markers)`);
  }
  return body;
}

// ZenRows fetcher — residential proxy + JS rendering + premium anti-bot.
// Free tier: 1000 credits. Each request to a Cloudflare-protected site uses
// ~25 credits (premium_proxy + js_render). Country routing via the URL TLD
// improves residential IP geography matching.
async function fetchHtmlViaZenRows(url) {
  const key = process.env.ZENROWS_API_KEY;
  if (!key) throw new Error("ZENROWS_API_KEY not configured");

  const country = countryCodeForHost(new URL(url).hostname);
  const params = new URLSearchParams({
    apikey: key,
    url,
    js_render: "true",
    premium_proxy: "true",
  });
  if (country) params.set("proxy_country", country);

  const apiUrl = `https://api.zenrows.com/v1/?${params.toString()}`;
  const res = await axios.get(apiUrl, {
    timeout: 90000,
    responseType: "text",
    decompress: true,
    validateStatus: () => true,
  });

  if (res.status >= 400) {
    const detail = String(res.data || "").slice(0, 200);
    throw new Error(`ZenRows HTTP ${res.status} — ${detail}`);
  }
  const body = typeof res.data === "string" ? res.data : "";
  if (body.length < 500 || !/<\/?(html|body|table|div)/i.test(body)) {
    throw new Error(`ZenRows returned ${body.length}B (no HTML markers)`);
  }
  if (isInterstitial(body)) {
    throw new Error("ZenRows response is still a Cloudflare challenge page");
  }
  return body;
}

function isInterstitial(html) {
  if (!html) return false;
  return /Just a moment/i.test(html)
    || /cf[-_]chl[-_]opt/i.test(html)
    || /challenge-error-text/i.test(html)
    || /cf-browser-verification/i.test(html)
    || /<title>\s*Attention Required/i.test(html);
}

function countryCodeForHost(host) {
  if (/\.ch$/i.test(host)) return "ch";
  if (/\.de$/i.test(host)) return "de";
  if (/\.at$/i.test(host)) return "at";
  if (/\.fr$/i.test(host)) return "fr";
  if (/\.it$/i.test(host)) return "it";
  if (/\.es$/i.test(host)) return "es";
  if (/\.uk$/i.test(host)) return "gb";
  return null;
}

function hostOf(u) { try { return new URL(u).hostname; } catch { return u; } }

// ---------------------------------------------------------------------
// DOM extraction (cheerio)
// ---------------------------------------------------------------------
// cheerio has no innerText, so approximate it: turn <br> and block-level
// element boundaries into newlines before reading text. This lets the match
// shapers split the panel into lines (header / venue / score) the same way the
// Playwright scraper does with element.innerText.
function blockInnerText($, el) {
  const $el = $(el).clone();
  $el.find("br").replaceWith("\n");
  $el.find("p,div,tr,li,h1,h2,h3,h4,h5,h6,section,article,header,footer,table,caption,legend,th,td")
    .each((_, e) => { $(e).prepend("\n"); $(e).append("\n"); });
  return $el.text();
}

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

  // Match panel detection — find a container with "Spielnummer: NNNN" text.
  // Keep the element so we can read it as newline-preserving innerText (the
  // match shapers parse it line-by-line).
  let matchPanelEl = null;
  $("div, section, article").each((_, d) => {
    if (matchPanelEl) return;
    if (/Spielnummer\s*:?\s*\d+/i.test($(d).text())) matchPanelEl = d;
  });
  const matchPanelHasContent = !!matchPanelEl;
  const matchPanelText = matchPanelEl ? blockInnerText($, matchPanelEl) : null;

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

  const telegramm = extractTelegramm($, clean);

  return {
    title: clean($("title").first().text()),
    h1: $("h1").map((_, el) => text(el)).get().filter(Boolean),
    h3: $("h3").map((_, el) => text(el)).get().filter(Boolean),
    mainText,
    fullText,
    tables,
    matchPanelText,
    lineupRows,
    telegramm,
    matchPanelHasContent,
  };
}

// ---------------------------------------------------------------------
// Swiss FV "telegramm" match page (matchcenter.*.ch / nisRD telegramm system).
// Structured lineups (.aufName/.aufPos + tor.gif goal icons), team columns
// (.eventsTeamName), and a goal ticker (.bnEventsList). Returns null on
// non-telegramm pages. Mirrors the Playwright scraper's telegramm block, but
// reads the rendered HTML (scrape.do/ZenRows render=true) with cheerio — the
// tab panes are present in the DOM even when not the active tab.
// ---------------------------------------------------------------------
function extractTelegramm($, clean) {
  // The content pane id ends with "_Aufstellung"; a nav <li> id ends with
  // "AufstellungItem" — prefer the exact suffix, then fall back to any
  // container that actually holds player names.
  let auf = $("[id$='_Aufstellung']").filter((_, el) => $(el).find(".aufName").length > 0).first();
  if (!auf.length) {
    auf = $("[id*='Aufstellung'], .tab-pane").filter((_, el) => $(el).find(".aufName").length > 0).first();
  }
  if (!auf.length || !auf.find(".aufName").length) return null;

  const cols = auf.find(".col-sm-6");
  const sources = cols.length >= 2 ? cols.toArray() : [auf.get(0)];
  const teams = sources.map((colEl) => {
    const col = $(colEl);
    const name = clean(col.find(".eventsTeamName, h4").first().text());
    const table = col.find("table").first();
    const players = [];
    const trainers = [];
    const absent = [];
    let section = "starter";
    if (table.length) {
      table.find("tr").each((_, trEl) => {
        const tr = $(trEl);
        const cells = tr.children("td,th");
        if (cells.length === 1) {
          const tt = clean(cells.eq(0).text());
          if (/Ersatz/i.test(tt)) section = "bench";
          else if (/Trainer/i.test(tt)) section = "coach";
          else if (/Absent|Abwesend|Verletzt|Gesperrt/i.test(tt)) section = "absent";
          return;
        }
        if (cells.length < 2) return;
        const num = clean(cells.eq(0).text());
        const nameCell = cells.eq(1);
        const nameEl = nameCell.find(".aufName").first();
        const rawName = clean(nameEl.length ? nameEl.text() : nameCell.text());
        const name2 = rawName.replace(/\(C\)\s*$/, "").trim();
        if (!name2) return;
        if (section === "coach") { trainers.push(name2); return; }
        if (section === "absent") { absent.push({ num, name: name2 }); return; }
        const position = clean(nameCell.find(".aufPos").first().text());
        const goals = tr.find("img[src*='tor.gif']").length;
        const captain = nameCell.find(".aufCaptain").length > 0 || /\(C\)/.test(rawName);
        players.push({ num, name: name2, position, goals, role: section, captain });
      });
    }
    return { name, players, trainers, absent, coach: trainers[0] || "" };
  });

  // Verlauf ticker: a <ul class="bnEventsList timeline-2"> of <li> events.
  // Each li: <time .timeline-time>, <img .fileicon alt="Tor|Auswechslung|…">,
  // <div .eventlabel goal|card|substitution> + the score + player text.
  let ticker = $("[id$='_Ticker']").filter((_, el) => $(el).find(".bnEventsList, ul.timeline-2, .eventlabel").length > 0).first();
  if (!ticker.length) {
    ticker = $("[id*='Ticker'], .tab-pane").filter((_, el) => $(el).find(".bnEventsList, ul.timeline-2, .eventlabel").length > 0).first();
  }
  const rawEvents = [];
  const ul = ticker.find(".bnEventsList, ul.timeline-2").first();
  if (ul.length) {
    ul.children("li").each((_, liEl) => {
      const li = $(liEl);
      const labelEl = li.find(".eventlabel").first();
      const full = clean(li.text());
      const scoreM = full.match(/\b(\d+:\d+)\b/);
      rawEvents.push({
        minute: clean(li.find(".timeline-time").first().text()),
        labelCls: labelEl.attr("class") || "",
        labelTxt: clean(labelEl.text()),
        iconAlt: li.find("img.fileicon").first().attr("alt") || "",
        score: scoreM ? scoreM[1] : "",
        full,
      });
    });
    rawEvents.reverse(); // ticker lists latest-first → make chronological
  }
  return { teams, rawEvents };
}

// ---------------------------------------------------------------------
// Classify + shape (same contract as the Playwright scraper)
// ---------------------------------------------------------------------
function classifyAndShape(url, dom) {
  // Swiss FV telegramm match page — full lineups + goal ticker available.
  if (dom.telegramm && dom.telegramm.teams?.some((t) => t.players?.length)) {
    return shapeTelegramm(url, dom);
  }
  if (dom.matchPanelHasContent && /Spielnummer\s*:?\s*\d+/i.test(dom.matchPanelText || "")) {
    return shapeMatchDetail(url, dom);
  }
  const standings = pickStandingsTables(dom.tables);
  if (standings.length) return shapeStandings(url, dom, standings);
  const matchList = pickMatchListTable(dom.tables);
  if (matchList) return shapeMatchList(url, dom, matchList);
  return shapeGeneric(url, dom);
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\bfc\b|\bfussball\b|\bclub\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// ---------------------------------------------------------------------
// Swiss FV telegramm — full match: meta + events + both lineups + goals.
// Produces multi-sheet output (Match / Players / Events) so the export
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
  // Fallback: the final ticker entry carries the running score, so derive the
  // result from it when the header panel didn't yield a clean scoreline.
  if (!played && tg.rawEvents?.length) {
    for (let i = tg.rawEvents.length - 1; i >= 0; i--) {
      const m = (tg.rawEvents[i].score || "").match(/^(\d+):(\d+)$/);
      if (m) { homeScore = +m[1]; awayScore = +m[2]; played = true; break; }
    }
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
  for (const [t] of [[home, "home"], [away, "away"]]) {
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
    .normalize("NFD")                            // split combining marks
    .replace(/[̀-ͯ]/g, "")             // strip combining marks (ü→u, ö→o, é→e)
    .replace(/[\x00-\x1f\x7f]/g, "")             // control chars
    .replace(/[/\\:*?"<>|+&#%=@]+/g, " ")        // filesystem-unsafe + URL-reserved chars
    .replace(/[·•]+/g, "-")                      // bullets → dash
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "scrape";
  if (cleaned.length <= maxLen) return cleaned;
  const cut = cleaned.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
}
