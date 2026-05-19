// POST /functions/v1/scrape-cancel
// Body: { job_id: string }
// Marks the job and all remaining (pending/running) steps as cancelled.
// A separate worker should check `scrape_jobs.status === 'cancelled'`
// before processing any more steps.
import { preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";
import { ok, badRequest, serverError } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const { user } = await requireUser(req);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const job_id = typeof body.job_id === "string" ? body.job_id : "";
    if (!job_id) return badRequest("job_id is required");

    const admin = serviceClient();

    const { data: job } = await admin.from("scrape_jobs").select("*").eq("id", job_id).maybeSingle();
    if (!job) return badRequest("job not found");
    if (job.user_id !== user.id) return badRequest("not your job");
    if (["done", "failed", "cancelled"].includes(job.status)) {
      return ok({ job, already_finished: true });
    }

    const now = new Date().toISOString();

    await admin.from("scrape_job_steps")
      .update({ status: "skipped", finished_at: now })
      .eq("job_id", job_id)
      .in("status", ["pending", "running"]);

    const { data: updated } = await admin.from("scrape_jobs")
      .update({ status: "cancelled", finished_at: now, error_message: "Cancelled by user" })
      .eq("id", job_id)
      .select()
      .single();

    await admin.from("activity_log").insert({
      user_id: user.id,
      text: "Scrape cancelled",
      detail: job.source_url,
      tone: "warn",
    });

    return ok({ job: updated });
  } catch (e) {
    if (e instanceof Response) return e;
    return serverError(e);
  }
});
