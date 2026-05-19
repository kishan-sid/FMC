// POST /functions/v1/generate-export
// Body: { matchday_id?: string, format?: "csv" | "xlsx" }
// Standalone export endpoint — used outside the scrape pipeline (e.g.
// "regenerate this matchday's spreadsheet"). Builds the file from
// match_lineups / match_events, uploads to Supabase Storage and writes
// an `exports` row.
import { preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";
import { ok, badRequest, serverError } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const { user } = await requireUser(req);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const matchday_id = typeof body.matchday_id === "string" ? body.matchday_id : null;
    const format = body.format === "xlsx" ? "xlsx" : "csv";

    const admin = serviceClient();

    let matchQuery = admin.from("matches").select("id").eq("user_id", user.id);
    if (matchday_id) matchQuery = matchQuery.eq("matchday_id", matchday_id);
    const { data: matches } = await matchQuery;
    const matchIds = (matches ?? []).map((m: { id: string }) => m.id);

    let lineups: Array<Record<string, unknown>> = [];
    if (matchIds.length) {
      const { data } = await admin.from("match_lineups")
        .select("match_id,team,player_name,position,minutes_on,minutes_off,goals_for,goals_against")
        .in("match_id", matchIds);
      lineups = data ?? [];
    }

    const headers = ["match_id","team","player","position","minutes_on","minutes_off","goals_for","goals_against"];
    const rows = lineups.map((r) => [
      r.match_id, r.team, r.player_name, r.position ?? "",
      r.minutes_on, r.minutes_off, r.goals_for, r.goals_against,
    ]);

    let bytes: Uint8Array;
    let contentType: string;
    if (format === "xlsx") {
      bytes = buildSimpleXlsx(headers, rows);
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
      bytes = new TextEncoder().encode(csv);
      contentType = "text/csv";
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = matchday_id
      ? `${matchday_id}-${stamp}.${format}`
      : `season-${stamp}.${format}`;
    const path = `${user.id}/${filename}`;

    const { error: upErr } = await admin.storage.from("exports").upload(path, bytes, {
      contentType,
      upsert: true,
    });
    if (upErr) throw upErr;

    const { data: exportRow, error: insErr } = await admin.from("exports").insert({
      user_id: user.id,
      file: filename,
      size_bytes: bytes.length,
      rows: rows.length,
      format,
      storage_path: path,
      matchday_id,
    }).select().single();
    if (insErr) throw insErr;

    await admin.from("activity_log").insert({
      user_id: user.id,
      text: "Export generated",
      detail: `${filename} · ${rows.length} rows`,
      tone: "success",
    });

    return ok({ export: exportRow });
  } catch (e) {
    if (e instanceof Response) return e;
    return serverError(e);
  }
});

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Minimal XLSX writer — produces a valid single-sheet workbook without
// pulling a dependency. Good enough for "Excel opens it cleanly" cases.
// For richer styling, swap to SheetJS via esm.sh.
function buildSimpleXlsx(headers: string[], rows: unknown[][]): Uint8Array {
  const all = [headers, ...rows];
  const sheetXml = sheetXmlFor(all);
  const files: Record<string, string> = {
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Export" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    "xl/worksheets/sheet1.xml": sheetXml,
  };
  return zipStore(files);
}

function sheetXmlFor(rows: unknown[][]): string {
  const colLetter = (i: number) => {
    let s = "";
    let n = i;
    while (n >= 0) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  };
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`;
  rows.forEach((row, r) => {
    xml += `<row r="${r + 1}">`;
    row.forEach((cell, c) => {
      const ref = `${colLetter(c)}${r + 1}`;
      if (typeof cell === "number" && Number.isFinite(cell)) {
        xml += `<c r="${ref}"><v>${cell}</v></c>`;
      } else {
        const s = escape(String(cell ?? ""));
        xml += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${s}</t></is></c>`;
      }
    });
    xml += `</row>`;
  });
  xml += `</sheetData></worksheet>`;
  return xml;
}

// Minimal store-only (no compression) ZIP writer for the XLSX container.
function zipStore(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const fileEntries: { name: Uint8Array; data: Uint8Array; crc: number; offset: number }[] = [];
  const out: number[] = [];

  const push = (arr: number[] | Uint8Array) => { for (const b of arr) out.push(b); };
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

  for (const [path, content] of Object.entries(files)) {
    const name = enc.encode(path);
    const data = enc.encode(content);
    const crc = crc32(data);
    const offset = out.length;
    push(u32(0x04034b50));
    push(u16(20));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u32(crc));
    push(u32(data.length));
    push(u32(data.length));
    push(u16(name.length));
    push(u16(0));
    push(name);
    push(data);
    fileEntries.push({ name, data, crc, offset });
  }

  const centralStart = out.length;
  for (const f of fileEntries) {
    push(u32(0x02014b50));
    push(u16(20));
    push(u16(20));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u32(f.crc));
    push(u32(f.data.length));
    push(u32(f.data.length));
    push(u16(f.name.length));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u32(0));
    push(u32(f.offset));
    push(f.name);
  }
  const centralSize = out.length - centralStart;
  push(u32(0x06054b50));
  push(u16(0));
  push(u16(0));
  push(u16(fileEntries.length));
  push(u16(fileEntries.length));
  push(u32(centralSize));
  push(u32(centralStart));
  push(u16(0));

  return new Uint8Array(out);
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
