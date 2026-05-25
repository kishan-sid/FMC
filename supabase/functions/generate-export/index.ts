// POST /functions/v1/generate-export
// Body: { matchday_id?: string, format?: "csv" | "xlsx" }
// Standalone export endpoint — used outside the scrape pipeline (e.g.
// "regenerate this matchday's spreadsheet"). Builds the file from
// match_lineups / match_events, uploads to Supabase Storage and writes
// an `exports` row.
import { preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";
import { ok, serverError } from "../_shared/http.ts";
import { buildSimpleXlsx } from "../_shared/xlsx.ts";

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
