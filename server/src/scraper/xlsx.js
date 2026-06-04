// Styled XLSX export using exceljs. Produces a professional, branded
// workbook with kind-aware visual polish:
//
//   - Title banner (dark green, white bold text)
//   - Subtitle row (kind summary)
//   - Bold header row on green
//   - Zebra-striped data rows
//   - Auto-fit column widths (bounded)
//   - Frozen header
//   - Borders on data cells
//   - Right-aligned numbers / left-aligned text
//   - Footer with generation timestamp + source URL
//   - Standings: gold/silver/bronze top 3 + colored goal difference
//
// Public entry: buildStyledXlsx(scraped) → Promise<Uint8Array>
//
// `scraped` is the full object the scraper produces, with:
//   { kind, title, summary, source_url, data, csv_rows, csv_filename_hint }

import ExcelJS from "exceljs";

// Brand palette (matches the app's dark theme green)
const COLOR_PRIMARY = "FF10B981";        // header bg
const COLOR_PRIMARY_DARK = "FF065F46";   // title banner
const COLOR_HEADER_TEXT = "FFFFFFFF";
const COLOR_TITLE_TEXT = "FFFFFFFF";
const COLOR_SUBTITLE = "FF6B7280";
const COLOR_ZEBRA = "FFF9FAFB";
const COLOR_BORDER = "FFE5E7EB";
const COLOR_FOOTER = "FF9CA3AF";
const COLOR_GOAL_POS = "FF16A34A";
const COLOR_GOAL_NEG = "FFDC2626";
const COLOR_GOLD = "FFFEF3C7";
const COLOR_SILVER = "FFE5E7EB";
const COLOR_BRONZE = "FFFED7AA";

// ---------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------
export async function buildStyledXlsx(scraped) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Football Scrapper";
  wb.created = new Date();

  // Multi-sheet workbook (e.g. a match → Match / Players / Events) when the
  // scraper supplies `sheets`; otherwise a single sheet from `csv_rows`.
  const sheets = (scraped.sheets && scraped.sheets.length)
    ? scraped.sheets
    : [{ name: niceSheetName(scraped), rows: scraped.csv_rows ?? [] }];

  const usedNames = new Set();
  sheets.forEach((sh, idx) => {
    const baseTitle = humanTitle(scraped);
    const title = sheets.length > 1 ? `${baseTitle} · ${sh.name}` : baseTitle;
    let name = cleanSheetName(sh.name || `Sheet ${idx + 1}`);
    while (usedNames.has(name.toLowerCase())) name = cleanSheetName(`${name} ${idx + 1}`);
    usedNames.add(name.toLowerCase());

    if (sh.layout === "teams") {
      renderTeamSheet(wb, { sheetName: name, title, subtitle: scraped.summary || "", sheet: sh, sourceUrl: scraped.source_url });
      return;
    }
    renderSheet(wb, {
      sheetName: name,
      title,
      subtitle: scraped.summary || "",
      rows: sh.rows ?? [],
      // Standings colouring only applies to the single-sheet standings export.
      isStandings: scraped.kind === "standings" && sheets.length === 1,
      sourceUrl: scraped.source_url,
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

// Render one styled worksheet (title banner, subtitle, header, body, footer).
function renderSheet(wb, { sheetName, title, subtitle, rows, isStandings, sourceUrl }) {
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 4 }], // freeze first 4 rows
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });

  const headers = (rows?.[0] ?? []).map((h) => prettyHeader(h));
  const body = rows?.slice(1) ?? [];
  const colCount = Math.max(headers.length, 1);

  // ---------- Row 1: Title banner ----------
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: COLOR_TITLE_TEXT } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_PRIMARY_DARK } };
  ws.getRow(1).height = 30;

  // ---------- Row 2: Subtitle ----------
  ws.mergeCells(2, 1, 2, colCount);
  const subtitleCell = ws.getCell(2, 1);
  subtitleCell.value = subtitle || "";
  subtitleCell.font = { name: "Calibri", size: 11, italic: true, color: { argb: COLOR_SUBTITLE } };
  subtitleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(2).height = 20;

  // ---------- Row 3: spacer ----------
  ws.getRow(3).height = 6;

  // ---------- Row 4: Headers ----------
  const headerRowIdx = 4;
  const headerRow = ws.getRow(headerRowIdx);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: COLOR_HEADER_TEXT } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_PRIMARY } };
    c.border = thinBorders();
  });
  headerRow.height = 24;

  // ---------- Body rows ----------
  // Detect which columns are numeric (more than half the values parse as numbers)
  const numericCols = detectNumericColumns(headers, body);

  // Standings-specific column indices (used for special styling)
  const positionColIdx = isStandings ? headers.findIndex((h) => /position/i.test(h)) : -1;
  const goalDiffColIdx = isStandings ? headers.findIndex((h) => /goal\s*diff/i.test(h)) : -1;
  const pointsColIdx = isStandings ? headers.findIndex((h) => /^points$/i.test(h)) : -1;

  // Player-sheet goal columns get green / red colouring.
  const goalsColIdx = headers.findIndex((h) => /^goals$/i.test(h));
  const gfColIdx = headers.findIndex((h) => /on.?pitch gf|goals for/i.test(h));
  const gaColIdx = headers.findIndex((h) => /on.?pitch ga|goals against/i.test(h));

  // Group standings reset the rank within each group, so track per-group position
  let prevGroup = null;
  let groupRowCounter = 0;

  body.forEach((rowData, r) => {
    const rowIdx = headerRowIdx + 1 + r;
    const row = ws.getRow(rowIdx);
    const isZebra = r % 2 === 1;

    if (isStandings && headers[0]?.toLowerCase() === "group") {
      if (rowData[0] !== prevGroup) {
        prevGroup = rowData[0];
        groupRowCounter = 0;
      }
      groupRowCounter++;
    }

    rowData.forEach((cellVal, c) => {
      const cell = row.getCell(c + 1);
      const isNumericCol = numericCols.has(c);
      const numericVal = isNumericCol ? toNumber(cellVal) : null;

      // Number cell uses real numeric storage so Excel can format/sort it
      if (numericVal !== null) {
        cell.value = numericVal;
        cell.numFmt = pickNumFmt(headers[c]);
      } else {
        cell.value = cellVal ?? "";
      }

      cell.font = { name: "Calibri", size: 11 };
      cell.alignment = {
        horizontal: isNumericCol ? "right" : "left",
        vertical: "middle",
      };
      cell.border = thinBorders();

      // Base fill: zebra striping
      if (isZebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_ZEBRA } };
      }

      // Kind-specific cell overrides
      if (isStandings) {
        // Top-3 position colors (only within each group)
        if (positionColIdx >= 0 && c === positionColIdx && (groupRowCounter === 1 || groupRowCounter === 2 || groupRowCounter === 3)) {
          const rankColor = groupRowCounter === 1 ? COLOR_GOLD
                          : groupRowCounter === 2 ? COLOR_SILVER
                          : COLOR_BRONZE;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rankColor } };
          cell.font = { name: "Calibri", size: 11, bold: true };
        }
        // Points column bold
        if (pointsColIdx >= 0 && c === pointsColIdx) {
          cell.font = { ...cell.font, bold: true };
        }
        // Goal difference colored
        if (goalDiffColIdx >= 0 && c === goalDiffColIdx && typeof cellVal === "string") {
          const trimmed = cellVal.trim();
          if (trimmed.startsWith("+") || (numericVal !== null && numericVal > 0)) {
            cell.font = { ...cell.font, color: { argb: COLOR_GOAL_POS }, bold: true };
          } else if (trimmed.startsWith("-") || (numericVal !== null && numericVal < 0)) {
            cell.font = { ...cell.font, color: { argb: COLOR_GOAL_NEG }, bold: true };
          }
        }
      }

      // Player sheet: colour goal columns (green for scored / for, red for against)
      if ((c === goalsColIdx || c === gfColIdx) && numericVal > 0) {
        cell.font = { ...cell.font, color: { argb: COLOR_GOAL_POS }, bold: true };
      }
      if (c === gaColIdx && numericVal > 0) {
        cell.font = { ...cell.font, color: { argb: COLOR_GOAL_NEG }, bold: true };
      }
    });
    row.height = 18;
  });

  // ---------- Auto-fit column widths ----------
  for (let c = 1; c <= colCount; c++) {
    let max = String(headers[c - 1] ?? "").length;
    body.forEach((r) => {
      const v = r[c - 1];
      const len = v == null ? 0 : String(v).length;
      if (len > max) max = len;
    });
    ws.getColumn(c).width = Math.min(Math.max(max + 2, 10), 50);
  }

  // ---------- Footer row ----------
  const footerRowIdx = headerRowIdx + 1 + body.length + 1; // blank line then footer
  ws.mergeCells(footerRowIdx, 1, footerRowIdx, colCount);
  const footerCell = ws.getCell(footerRowIdx, 1);
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
  footerCell.value = `Generated ${ts} · Football Scrapper · Source: ${sourceUrl || "n/a"}`;
  footerCell.font = { name: "Calibri", size: 9, italic: true, color: { argb: COLOR_FOOTER } };
  footerCell.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(footerRowIdx).height = 16;
}

// Team-grouped player sheet: a banner per team, then Starting XI and
// Substitutes blocks, with a blank gap before the next team.
function renderTeamSheet(wb, { sheetName, title, subtitle, sheet, sourceUrl }) {
  const ws = wb.addWorksheet(sheetName, {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  const cols = (sheet.columns || []).map((h) => prettyHeader(h));
  const colCount = Math.max(cols.length, 1);
  // Numeric columns (everything from "On (min)" onward) + goal columns.
  const numFrom = cols.findIndex((h) => /on \(min\)|^min|minutes/i.test(h));
  const goalsIdx = cols.findIndex((h) => /^goals$/i.test(h));
  const gfIdx = cols.findIndex((h) => /goals for/i.test(h));
  const gaIdx = cols.findIndex((h) => /goals against/i.test(h));
  const isNum = (c) => numFrom >= 0 && c >= numFrom;

  let r = 1;
  ws.mergeCells(r, 1, r, colCount);
  const tc = ws.getCell(r, 1);
  tc.value = title;
  tc.font = { name: "Calibri", size: 16, bold: true, color: { argb: COLOR_TITLE_TEXT } };
  tc.alignment = { horizontal: "center", vertical: "middle" };
  tc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_PRIMARY_DARK } };
  ws.getRow(r).height = 28; r++;

  ws.mergeCells(r, 1, r, colCount);
  const sc = ws.getCell(r, 1);
  sc.value = subtitle || "";
  sc.font = { name: "Calibri", size: 11, italic: true, color: { argb: COLOR_SUBTITLE } };
  sc.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height = 18; r += 2; // blank line after subtitle

  for (const team of sheet.teams || []) {
    // Team banner
    ws.mergeCells(r, 1, r, colCount);
    const band = ws.getCell(r, 1);
    band.value = team.score != null ? `${team.name}  —  ${team.score} goals` : team.name;
    band.font = { name: "Calibri", size: 13, bold: true, color: { argb: COLOR_TITLE_TEXT } };
    band.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_PRIMARY } };
    ws.getRow(r).height = 22; r++;

    // Column header
    const hr = ws.getRow(r);
    cols.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = { name: "Calibri", size: 10, bold: true, color: { argb: COLOR_HEADER_TEXT } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_PRIMARY_DARK } };
      c.border = thinBorders();
    });
    hr.height = 22; r++;

    for (const group of team.groups || []) {
      // Subsection label (Starting XI / Substitutes)
      ws.mergeCells(r, 1, r, colCount);
      const gl = ws.getCell(r, 1);
      gl.value = `${group.label} (${group.rows.length})`;
      gl.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF374151" } };
      gl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      gl.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      ws.getRow(r).height = 18; r++;

      group.rows.forEach((rowData, ri) => {
        const row = ws.getRow(r);
        rowData.forEach((val, c) => {
          const cell = row.getCell(c + 1);
          const num = isNum(c) ? toNumber(val) : null;
          if (num !== null) { cell.value = num; cell.numFmt = "0"; }
          else cell.value = val ?? "";
          cell.font = { name: "Calibri", size: 10 };
          cell.alignment = { horizontal: isNum(c) ? "right" : "left", vertical: "middle" };
          cell.border = thinBorders();
          if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_ZEBRA } };
          if ((c === goalsIdx || c === gfIdx) && num > 0) cell.font = { ...cell.font, color: { argb: COLOR_GOAL_POS }, bold: true };
          if (c === gaIdx && num > 0) cell.font = { ...cell.font, color: { argb: COLOR_GOAL_NEG }, bold: true };
        });
        row.height = 17; r++;
      });
    }
    r++; // gap before next team
  }

  // Column widths
  for (let c = 1; c <= colCount; c++) {
    let max = String(cols[c - 1] ?? "").length;
    (sheet.teams || []).forEach((t) => (t.groups || []).forEach((g) => g.rows.forEach((row) => {
      const v = row[c - 1]; const len = v == null ? 0 : String(v).length; if (len > max) max = len;
    })));
    ws.getColumn(c).width = Math.min(Math.max(max + 2, 8), 42);
  }

  ws.mergeCells(r + 1, 1, r + 1, colCount);
  const fc = ws.getCell(r + 1, 1);
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
  fc.value = `Generated ${ts} · Football Scrapper · Source: ${sourceUrl || "n/a"}`;
  fc.font = { name: "Calibri", size: 9, italic: true, color: { argb: COLOR_FOOTER } };
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function thinBorders() {
  const side = { style: "thin", color: { argb: COLOR_BORDER } };
  return { top: side, left: side, bottom: side, right: side };
}

function detectNumericColumns(headers, body) {
  const out = new Set();
  for (let c = 0; c < headers.length; c++) {
    let numericHits = 0;
    let totalNonEmpty = 0;
    for (const row of body) {
      const v = row[c];
      if (v == null || String(v).trim() === "") continue;
      totalNonEmpty++;
      if (toNumber(v) !== null) numericHits++;
    }
    if (totalNonEmpty >= 2 && numericHits / totalNonEmpty >= 0.7) out.add(c);
  }
  return out;
}

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  // Allow leading + or -, optional decimal, no other chars (skip values like "12:34")
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function pickNumFmt(header) {
  const h = String(header || "").toLowerCase();
  if (/goal\s*diff/.test(h)) return "+0;-0;0"; // explicit +/- sign
  if (/position|pos\.?|rank|matches|wins|draws|losses|goals|points/.test(h)) return "0";
  return "0.##";
}

function prettyHeader(h) {
  return String(h || "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function humanTitle(scraped) {
  // Use a clean human-readable title. Fall back through the data we have.
  if (scraped.kind === "match" && scraped.data) {
    const d = scraped.data;
    const teams = [d.home_name, d.away_name].filter(Boolean).join(" vs ");
    if (teams) {
      return d.played
        ? `${d.home_name} ${d.home_score}–${d.away_score} ${d.away_name}`
        : teams;
    }
  }
  if (scraped.kind === "standings") {
    return scraped.csv_filename_hint || scraped.title || "Standings";
  }
  return scraped.csv_filename_hint || scraped.title || "Scrape Export";
}

function niceSheetName(scraped) {
  // Excel sheet names: 31 chars max, no [ ] / \ ? * : ' "
  const base = humanTitle(scraped) || scraped.kind || "Export";
  return base.replace(/[\[\]/\\?*:'"]+/g, "").slice(0, 31) || "Export";
}

function cleanSheetName(name) {
  // Excel sheet names: 31 chars max, no [ ] / \ ? * : ' "
  return String(name || "Sheet").replace(/[\[\]/\\?*:'"]+/g, "").trim().slice(0, 31) || "Sheet";
}

// ---------------------------------------------------------------------
// Backwards-compat shim — older callers may still use buildSimpleXlsx.
// Kept so any drive-by import doesn't crash; new pipeline calls
// buildStyledXlsx directly with the full scrape object.
// ---------------------------------------------------------------------
export async function buildSimpleXlsx(headers, rows) {
  return buildStyledXlsx({
    kind: "generic",
    title: "Export",
    summary: "",
    source_url: "",
    csv_rows: [headers, ...rows],
  });
}
