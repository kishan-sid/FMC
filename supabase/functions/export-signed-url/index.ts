// POST /functions/v1/export-signed-url
// Body: { export_id: string, expires_in?: number /* seconds, default 3600 */ }
// Returns a time-limited signed download URL for an export's file.
// The export row must belong to the calling user (RLS scoped).
import { preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";
import { ok, badRequest, serverError } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const { user } = await requireUser(req);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const export_id = typeof body.export_id === "string" ? body.export_id : "";
    const expires_in = typeof body.expires_in === "number" && body.expires_in > 0
      ? Math.min(body.expires_in, 24 * 3600)
      : 3600;
    if (!export_id) return badRequest("export_id is required");

    const admin = serviceClient();

    const { data: row, error: rowErr } = await admin
      .from("exports")
      .select("id,user_id,file,storage_path,format,size_bytes")
      .eq("id", export_id)
      .maybeSingle();
    if (rowErr) throw rowErr;
    if (!row) return badRequest("export not found");
    if (row.user_id !== user.id) return badRequest("not your export");
    if (!row.storage_path) return badRequest("export has no stored file yet");

    const { data: signed, error: signErr } = await admin
      .storage.from("exports")
      .createSignedUrl(row.storage_path, expires_in, { download: row.file });
    if (signErr) throw signErr;

    return ok({ url: signed.signedUrl, expires_in, file: row.file, size_bytes: row.size_bytes });
  } catch (e) {
    if (e instanceof Response) return e;
    return serverError(e);
  }
});
