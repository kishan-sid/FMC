// Vercel serverless function — POST /api/scrape/start
//
// **Enqueue-only.** The function authenticates the user and creates a
// `scrape_jobs` row (status="queued") + 6 `scrape_job_steps` placeholders.
// The actual scrape is run by `server/src/worker.js`, which polls Supabase
// for queued jobs and processes them on a residential-IP machine. This
// architecture is required for sources protected by Cloudflare / datacenter-
// IP blocks (matchcenter.football.ch, matchcenter.afv.ch, etc.) — the
// Vercel function's datacenter IP cannot reach those sites.
//
// The UI subscribes to realtime updates on scrape_jobs / scrape_job_steps,
// so it sees the worker's progress automatically — no UI changes needed.
import { createClient } from "@supabase/supabase-js";

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

    return res.status(200).json({ job, steps });
  } catch (e) {
    console.error("[scrape] enqueue failed", e);
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
