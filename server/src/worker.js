// Local scrape worker.
//
// Polls Supabase for `scrape_jobs` rows in status="queued" and processes them
// using server/src/lib/pipeline.js (Playwright-based scraper). Designed to
// run on a regular home/office machine so the outbound scrape requests come
// from a residential IP, which Cloudflare-protected sources will accept.
//
// Reliability features:
//   - Atomic job claim (queued → running) — multiple workers can run safely
//   - Heartbeat every 10s while a job is in progress
//   - Stale job recovery: any running job with stale heartbeat (>90s) is
//     marked failed at the start of each loop iteration, so a crashed
//     worker doesn't leave orphan jobs blocking the queue
//
// Run with PM2 for auto-restart and boot-time start. See DEPLOY.md.
import dotenv from "dotenv";
import os from "os";
import { serviceClient } from "./lib/supabase.js";
import { runPipeline } from "./lib/pipeline.js";

dotenv.config();

const WORKER_ID = `${os.hostname()}-${process.pid}`;
const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_MS = 10000;
const STALE_AFTER_MS = 90000;

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function recoverStaleJobs(sb) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { data, error } = await sb
    .from("scrape_jobs")
    .update({
      status: "failed",
      error_message: "Worker crashed (no heartbeat for >90s)",
      finished_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("heartbeat_at", cutoff)
    .select("id");
  if (error) {
    console.error("[worker] stale recovery failed", error);
    return;
  }
  if (data?.length) {
    console.log(`[worker] recovered ${data.length} stale job(s):`, data.map((r) => r.id));
  }
}

async function claimJob(sb) {
  // Find the oldest queued job, then atomically claim it. We use a two-step
  // approach (select then conditional update) because supabase-js doesn't
  // expose Postgres's `FOR UPDATE SKIP LOCKED` directly. The conditional
  // update (`eq("status", "queued")`) is what makes the claim atomic — only
  // one worker will successfully transition any given row to "running".
  const { data: candidates, error: selErr } = await sb
    .from("scrape_jobs")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);
  if (selErr) throw selErr;
  if (!candidates?.length) return null;

  const now = new Date().toISOString();
  const { data: claimed, error: updErr } = await sb
    .from("scrape_jobs")
    .update({
      status: "running",
      worker_id: WORKER_ID,
      claimed_at: now,
      heartbeat_at: now,
      started_at: now,
    })
    .eq("id", candidates[0].id)
    .eq("status", "queued")
    .select()
    .maybeSingle();
  if (updErr) throw updErr;
  return claimed;
}

function startHeartbeat(sb, jobId) {
  return setInterval(async () => {
    try {
      await sb.from("scrape_jobs")
        .update({ heartbeat_at: new Date().toISOString() })
        .eq("id", jobId);
    } catch (e) {
      console.error("[worker] heartbeat failed", e);
    }
  }, HEARTBEAT_MS);
}

async function processOnce() {
  const sb = serviceClient();
  await recoverStaleJobs(sb);

  const job = await claimJob(sb);
  if (!job) return false;

  console.log(`[worker] claimed job ${job.id} · ${job.source_url}`);
  const hb = startHeartbeat(sb, job.id);
  try {
    await runPipeline({ sb, job });
    console.log(`[worker] completed job ${job.id}`);
  } catch (e) {
    console.error(`[worker] job ${job.id} failed:`, e?.message || e);
    // runPipeline already marks the job + step as failed before re-throwing.
    // We just log here so PM2 doesn't restart the worker for a job-level
    // error (which would be wasteful — the next tick will pick the next job).
  } finally {
    clearInterval(hb);
  }
  return true;
}

async function loop() {
  console.log(`[worker] started · id=${WORKER_ID} · poll=${POLL_INTERVAL_MS}ms`);
  while (!stopping) {
    try {
      const didWork = await processOnce();
      if (!didWork) await sleep(POLL_INTERVAL_MS);
    } catch (e) {
      console.error("[worker] tick error", e);
      await sleep(POLL_INTERVAL_MS);
    }
  }
  console.log("[worker] shutdown signal received — exiting");
  process.exit(0);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

loop();
