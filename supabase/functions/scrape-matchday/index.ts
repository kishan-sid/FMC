// POST /functions/v1/scrape-matchday
// Body: { matchday_id: string, label?: string, date?: string }
// Marks the matchday as `running`, logs activity, returns the row.
// The real scraper worker should listen for this status and process it.
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;

  try {
    const { user, sb } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { matchday_id, label, date } = body ?? {};

    if (!matchday_id) {
      return new Response(JSON.stringify({ error: "matchday_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // Upsert the matchday so the user can kick off scraping for a new Spieltag.
    const { data: md, error: mdErr } = await sb
      .from("matchdays")
      .upsert(
        {
          id: matchday_id,
          user_id: user.id,
          label: label ?? matchday_id,
          date: date ?? new Date().toISOString().slice(0, 10),
          status: "running",
        },
        { onConflict: "id" }
      )
      .select()
      .single();
    if (mdErr) throw mdErr;

    await sb.from("activity_log").insert({
      user_id: user.id,
      text: "Scrape triggered",
      detail: `${md.label} queued for processing`,
      tone: "info",
    });

    return new Response(JSON.stringify({ matchday: md }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
