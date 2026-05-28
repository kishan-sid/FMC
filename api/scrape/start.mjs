// Vercel serverless function — POST /api/scrape/start
//
// Two-mode architecture (controlled by env vars):
//
//   1. SCRAPE_DO_API_KEY or ZENROWS_API_KEY set → Vercel function runs the
//      full pipeline using the configured residential-proxy service. PC-
//      independent, works even when the local worker is offline. scrape.do
//      takes priority when both keys are present.
//
//   2. Neither key set → Vercel function only enqueues the job;
//      server/src/worker.js on a residential-IP machine processes it.
//
// The UI subscribes to Supabase realtime on scrape_jobs / scrape_job_steps,
// so it sees progress identically regardless of which mode is active.
import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { runPipeline } from "../_lib/pipeline.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = parseBody(req.body);
    const source_url = String(body?.source_url ?? "").trim();
    if (!source_url) return res.status(400).json({ error: "source_url is required" });
    try { new URL(source_url); }
    catch { return res.status(400).json({ error: "source_url must be a valid URL" }); }

    const authHeader = req.headers.authorization || "";
    const user = await verifyUser(authHeader);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

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

    const usingVercel = !!(process.env.SCRAPE_DO_API_KEY || process.env.ZENROWS_API_KEY);
    const proxyName = process.env.SCRAPE_DO_API_KEY ? "scrape.do" : "ZenRows";
    await sb.from("activity_log").insert({
      user_id: user.id,
      text: usingVercel ? `Scrape started (Vercel + ${proxyName})` : "Scrape queued — waiting for worker",
      detail: source_url,
      tone: "info",
    });

    const { data: steps } = await sb
      .from("scrape_job_steps")
      .select("*")
      .eq("job_id", job.id)
      .order("step_order");

    // Vercel-side processing: claim the job atomically so the worker (if
    // running) skips it. We mark it as running with worker_id="vercel" before
    // releasing control to waitUntil so the worker's claimJob query (which
    // looks for status="queued") will not race us.
    if (usingVercel) {
      const { data: claimed } = await sb
        .from("scrape_jobs")
        .update({
          status: "running",
          worker_id: "vercel",
          claimed_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("status", "queued")
        .select()
        .maybeSingle();
      if (claimed) {
        res.status(200).json({ job: claimed, steps });
        waitUntil(runPipeline({ sb, job: claimed }).catch((e) => {
          console.error("[scrape] pipeline crash", e);
        }));
        return;
      }
      // Couldn't claim — worker beat us. Fall through to the enqueue-only
      // response so the worker drives the job.
    }

    return res.status(200).json({ job, steps });
  } catch (e) {
    console.error("[scrape] start failed", e);
    return res.status(500).json({ error: e?.message || "scrape start failed" });
  }
}

function parseBody(b) {
  if (!b) return {};
  if (typeof b === "object") return b;
  try { return JSON.parse(b); } catch { return {}; }
}

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars missing on Vercel");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function verifyUser(authHeader) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY env vars missing on Vercel");
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await sb.auth.getUser();
  return data?.user ?? null;
}
