// POST /api/scrape/start
// Body: { source_url: string }
//
// **Enqueue-only.** Mirror of api/scrape/start.mjs (Vercel). Creates a
// scrape_jobs row + step placeholders and returns immediately. The actual
// scrape is run by server/src/worker.js, which polls Supabase for queued
// jobs and processes them on this machine (residential IP) — required for
// Cloudflare-protected sources that block datacenter IPs.
import { Router } from "express";
import { serviceClient, requireUser } from "../lib/supabase.js";

const router = Router();

router.post("/start", async (req, res) => {
  try {
    const user = await requireUser(req);
    const source_url = String(req.body?.source_url ?? "").trim();
    if (!source_url) return res.status(400).json({ error: "source_url is required" });

    try { new URL(source_url); }
    catch { return res.status(400).json({ error: "source_url must be a valid URL" }); }

    const sb = serviceClient();

    const { data: job, error: jobErr } = await sb
      .from("scrape_jobs")
      .insert({
        user_id: user.id,
        source_url,
        source_type: "match",
        status: "queued",
        total_steps: 6,
      })
      .select()
      .single();
    if (jobErr) throw jobErr;

    const { error: seedErr } = await sb.rpc("seed_scrape_steps", { p_job_id: job.id });
    if (seedErr) throw seedErr;

    await sb.from("activity_log").insert({
      user_id: user.id,
      text: "Scrape queued — waiting for worker",
      detail: source_url,
      tone: "info",
    });

    const { data: steps } = await sb
      .from("scrape_job_steps")
      .select("*")
      .eq("job_id", job.id)
      .order("step_order");

    res.json({ job, steps });
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({ error: e?.message || "scrape start failed" });
  }
});

export default router;
