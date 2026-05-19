// POST /functions/v1/scrape-start
// Body: { source_url: string, source_type?: "matchday" | "match" }
// Creates a scrape_jobs row + 6 scrape_job_steps and returns the job.
// The actual scraping is advanced by repeated calls to /functions/v1/scrape-tick.
import { preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";
import { ok, badRequest, serverError } from "../_shared/http.ts";

function guessSourceType(url: string): "matchday" | "match" {
  // kicker.de URLs: …/bundesliga/spieltag/2025-26/33     -> matchday
  //                 …/bundesliga/spielbericht/…           -> match
  if (/spieltag|matchday/i.test(url)) return "matchday";
  if (/spielbericht|match\b|fixture/i.test(url)) return "match";
  return "matchday";
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const { user } = await requireUser(req);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const source_url = typeof body.source_url === "string" ? body.source_url.trim() : "";
    if (!source_url) return badRequest("source_url is required");

    try {
      new URL(source_url);
    } catch {
      return badRequest("source_url must be a valid URL");
    }

    const source_type =
      body.source_type === "match" || body.source_type === "matchday"
        ? body.source_type
        : guessSourceType(source_url);

    const admin = serviceClient();

    const { data: job, error: jobErr } = await admin
      .from("scrape_jobs")
      .insert({
        user_id: user.id,
        source_url,
        source_type,
        status: "queued",
        total_steps: 6,
      })
      .select()
      .single();
    if (jobErr) throw jobErr;

    const { error: seedErr } = await admin.rpc("seed_scrape_steps", { p_job_id: job.id });
    if (seedErr) throw seedErr;

    await admin.from("activity_log").insert({
      user_id: user.id,
      text: "Scrape queued",
      detail: source_url,
      tone: "info",
    });

    const { data: steps } = await admin
      .from("scrape_job_steps")
      .select("*")
      .eq("job_id", job.id)
      .order("step_order");

    return ok({ job, steps });
  } catch (e) {
    if (e instanceof Response) return e;
    return serverError(e);
  }
});
