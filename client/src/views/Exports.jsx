import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link2, Play, FileSpreadsheet, FileText, Download, CheckCircle2,
  Loader2, Clock3, Trash2, AlertTriangle, XCircle, X,
} from "lucide-react";
import { supabase } from "../lib/supabase.js";

const STEP_NAMES = [
  "Fetching matchday page",
  "Extracting match URLs",
  "Scraping events + lineups",
  "Reconstructing player timelines",
  "Computing on-pitch goals",
  "Building Excel/CSV",
];

const TERMINAL = new Set(["done", "failed", "cancelled"]);

// Edge Function path handles openligadb / kicker.de (purpose-built API
// extractor). Every other URL goes through the Express + Playwright
// pipeline which is content-aware (match, standings, list, generic table).
function useEdgeFunctionFor(u) {
  try {
    const h = new URL(u).hostname;
    return /(^|\.)openligadb\.de$/i.test(h) || /(^|\.)kicker\.de$/i.test(h);
  } catch { return false; }
}

function placeholderSteps() {
  return STEP_NAMES.map((name, i) => ({
    id: `placeholder-${i + 1}`,
    step_order: i + 1,
    name,
    status: "pending",
    progress_percent: 0,
  }));
}

function formatBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const stateUI = {
  done:      { Icon: CheckCircle2, color: "text-emerald-300",  label: "Done"      },
  running:   { Icon: Loader2,      color: "text-amber-300 animate-spin", label: "Running" },
  pending:   { Icon: Clock3,       color: "text-slate-500",    label: "Queued"    },
  failed:    { Icon: XCircle,      color: "text-red-400",      label: "Failed"    },
  skipped:   { Icon: X,            color: "text-slate-500",    label: "Skipped"   },
};

// ---------------------------------------------------------------------
// ConfirmDeleteModal — used both for single-file delete and Clear All.
// ---------------------------------------------------------------------
function ConfirmDeleteModal({ open, title, message, danger = "Delete", onCancel, onConfirm, busy }) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
      onClick={() => !busy && onCancel?.()}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-slate-800 p-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/15 text-red-300">
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="mt-1 text-xs text-slate-400">{message}</p>
          </div>
          <button
            onClick={() => !busy && onCancel?.()}
            disabled={busy}
            className="rounded-md p-1 text-slate-500 hover:text-slate-200 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {busy ? "Deleting…" : danger}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// RunningOverlay — prominent "scrape in progress" badge above the pipeline.
// ---------------------------------------------------------------------
function RunningBanner({ stepName, current, total, percent }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
      <Loader2 size={18} className="animate-spin text-emerald-300 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-emerald-200 truncate">
            {stepName ?? "Starting…"}
          </span>
          <span className="text-xs text-emerald-300/80 shrink-0">
            Step {current ?? 0}/{total} · {percent}%
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Pipeline is running — please keep this page open. Downloads will be available once it finishes.
        </p>
      </div>
    </div>
  );
}

export default function Exports() {
  const [url, setUrl] = useState("");
  const [job, setJob] = useState(null);
  const [steps, setSteps] = useState(placeholderSteps());
  const [exportRows, setExportRows] = useState([]);
  const [loadingExports, setLoadingExports] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancelRef = useRef(false);

  // Delete modal state — null = closed; object = open with payload
  // { kind: "one" | "all", file?, count?, busy? }
  const [confirmState, setConfirmState] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const loadExports = useCallback(async () => {
    setLoadingExports(true);
    const { data, error: err } = await supabase
      .from("exports")
      .select("id, file, size_bytes, rows, format, storage_path, matchday_id, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (err) setError(err.message);
    setExportRows(data ?? []);
    setLoadingExports(false);
  }, []);

  useEffect(() => { loadExports(); }, [loadExports]);

  useEffect(() => {
    if (!job?.id) return;
    const channel = supabase
      .channel(`job:${job.id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "scrape_jobs", filter: `id=eq.${job.id}` },
        (payload) => setJob((j) => ({ ...(j ?? {}), ...payload.new })))
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "scrape_job_steps", filter: `job_id=eq.${job.id}` },
        (payload) => setSteps((curr) =>
          curr.map((s) => (s.step_order === payload.new.step_order ? { ...s, ...payload.new } : s))))
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "scrape_job_steps", filter: `job_id=eq.${job.id}` },
        (payload) => setSteps((curr) =>
          curr.map((s) => (s.step_order === payload.new.step_order ? { ...s, ...payload.new } : s))))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [job?.id]);

  const handleStart = useCallback(async () => {
    setError("");
    if (!url.trim()) { setError("Paste a matchday or match URL first."); return; }
    setBusy(true);
    cancelRef.current = false;
    setSteps(placeholderSteps());

    try {
      const trimmed = url.trim();
      const useExpress = !useEdgeFunctionFor(trimmed);

      let startedJob;
      let initialSteps;
      if (useExpress) {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Not signed in");
        const res = await fetch("/api/scrape/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ source_url: trimmed }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
        startedJob = payload.job;
        initialSteps = payload.steps;
      } else {
        const { data, error: startErr } = await supabase.functions.invoke("scrape-start", {
          body: { source_url: trimmed },
        });
        if (startErr) throw startErr;
        startedJob = data?.job;
        initialSteps = data?.steps;
      }

      if (!startedJob) throw new Error("scrape-start returned no job");
      setJob(startedJob);
      setSteps(initialSteps?.length ? initialSteps : placeholderSteps());

      if (useExpress) {
        // Express runs the pipeline async server-side; UI just polls the job
        // row until it's terminal. Realtime sub already updates per-step UI.
        let current = startedJob;
        while (current && !TERMINAL.has(current.status)) {
          if (cancelRef.current) break;
          await new Promise((r) => setTimeout(r, 700));
          const { data: row } = await supabase
            .from("scrape_jobs").select("*").eq("id", current.id).maybeSingle();
          if (row) current = row;
        }
      } else {
        let current = startedJob;
        while (current && !TERMINAL.has(current.status)) {
          if (cancelRef.current) break;
          const { data: tick, error: tickErr } = await supabase.functions.invoke("scrape-tick", {
            body: { job_id: current.id },
          });
          if (tickErr) throw tickErr;
          current = tick?.job ?? current;
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      await loadExports();
    } catch (e) {
      setError(e?.message || "Scrape failed");
    } finally {
      setBusy(false);
    }
  }, [url, loadExports]);

  const handleCancel = useCallback(async () => {
    if (!job?.id) return;
    cancelRef.current = true;
    setBusy(false);
    await supabase.functions.invoke("scrape-cancel", { body: { job_id: job.id } });
  }, [job?.id]);

  const handleDownload = useCallback(async (exp) => {
    setError("");
    const { data, error: err } = await supabase.functions.invoke("export-signed-url", {
      body: { export_id: exp.id },
    });
    if (err) { setError(err.message); return; }
    if (data?.url) window.open(data.url, "_blank", "noopener");
  }, []);

  // Open modal for a single-file delete
  const askDeleteOne = useCallback((exp) => {
    setConfirmState({ kind: "one", exp });
  }, []);

  // Open modal for clear-all
  const askDeleteAll = useCallback(() => {
    if (exportRows.length === 0) return;
    setConfirmState({ kind: "all", count: exportRows.length });
  }, [exportRows.length]);

  const closeConfirm = useCallback(() => {
    if (confirmBusy) return;
    setConfirmState(null);
  }, [confirmBusy]);

  const doConfirmedDelete = useCallback(async () => {
    if (!confirmState) return;
    setConfirmBusy(true);
    setError("");
    try {
      if (confirmState.kind === "one") {
        const exp = confirmState.exp;
        if (exp.storage_path) {
          await supabase.storage.from("exports").remove([exp.storage_path]).catch(() => {});
        }
        const { error: delErr } = await supabase.from("exports").delete().eq("id", exp.id);
        if (delErr) throw delErr;
        setExportRows((rows) => rows.filter((r) => r.id !== exp.id));
      } else if (confirmState.kind === "all") {
        const paths = exportRows.map((r) => r.storage_path).filter(Boolean);
        if (paths.length) {
          await supabase.storage.from("exports").remove(paths).catch(() => {});
        }
        const ids = exportRows.map((r) => r.id);
        const { error: delErr } = await supabase.from("exports").delete().in("id", ids);
        if (delErr) throw delErr;
        setExportRows([]);
      }
      setConfirmState(null);
    } catch (e) {
      setError(e?.message ?? "Delete failed");
    } finally {
      setConfirmBusy(false);
    }
  }, [confirmState, exportRows]);

  const handleQuickExport = useCallback(async (format) => {
    setError("");
    const { data, error: err } = await supabase.functions.invoke("generate-export", {
      body: { format, matchday_id: job?.matchday_id ?? null },
    });
    if (err) { setError(err.message); return; }
    await loadExports();
    if (data?.export) await handleDownload(data.export);
  }, [job?.matchday_id, loadExports, handleDownload]);

  const progress = job
    ? Math.round(job.progress_percent ?? ((job.current_step ?? 0) / (job.total_steps ?? 6) * 100))
    : 0;
  const doneCount = useMemo(() => steps.filter((s) => s.status === "done").length, [steps]);
  const runningStep = useMemo(() => steps.find((s) => s.status === "running"), [steps]);
  const isRunning = job?.status === "running" || job?.status === "queued" || busy;
  const lastError = job?.status === "failed" ? job.error_message : "";

  // Title/message for the delete modal
  const confirmTitle = confirmState?.kind === "all"
    ? "Clear all exports?"
    : "Delete this export?";
  const confirmMessage = confirmState?.kind === "all"
    ? `${confirmState.count} file${confirmState.count === 1 ? "" : "s"} will be permanently removed from Storage + database. Action cannot be undone.`
    : confirmState?.exp
      ? `“${confirmState.exp.file}” (${formatBytes(confirmState.exp.size_bytes)} · ${confirmState.exp.rows ?? 0} rows) will be permanently removed.`
      : "";
  const confirmDanger = confirmState?.kind === "all" ? "Clear all" : "Delete";

  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Trigger card */}
        <div className="xl:col-span-2 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-sm font-semibold text-white">Trigger a scrape</h2>
          <p className="text-xs text-slate-400">Paste a matchday URL or a single match URL. The pipeline handles the rest.</p>

          <div className="mt-4 flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5">
              <Link2 size={14} className="text-slate-500" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isRunning}
                className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500 disabled:opacity-60"
                placeholder="https://…"
              />
            </div>
            {isRunning ? (
              <button
                onClick={handleCancel}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800"
              >
                <X size={14} />
                Cancel
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={!url.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Play size={14} fill="currentColor" />
                Start Scrape
              </button>
            )}
          </div>

          {isRunning && (
            <RunningBanner
              stepName={runningStep?.name ?? "Starting pipeline…"}
              current={job?.current_step ?? 0}
              total={job?.total_steps ?? 6}
              percent={progress}
            />
          )}

          {(error || lastError) && !isRunning && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error || lastError}</span>
            </div>
          )}

          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Pipeline progress</span>
              <span>{doneCount} of {steps.length} steps</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r from-emerald-500 to-amber-400 transition-[width] duration-300 ${isRunning ? "animate-pulse" : ""}`}
                style={{ width: `${progress}%` }}
              />
            </div>

            <ol className="mt-4 space-y-2">
              {steps.map((s) => {
                const ui = stateUI[s.status] || stateUI.pending;
                const Icon = ui.Icon;
                const isThisRunning = s.status === "running";
                return (
                  <li
                    key={s.id}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                      isThisRunning
                        ? "border-amber-500/50 bg-amber-500/5 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]"
                        : "border-slate-800 bg-slate-950/40"
                    }`}
                  >
                    <Icon size={14} className={ui.color} />
                    <span className={`text-sm ${isThisRunning ? "text-amber-100 font-medium" : "text-slate-200"}`}>
                      {s.name}
                    </span>
                    <span className="ml-auto text-xs">
                      {s.status === "running" && (
                        <span className="text-amber-300 tabular-nums">{s.progress_percent ?? 0}%</span>
                      )}
                      {s.status === "done" && <span className="text-emerald-300">Done</span>}
                      {s.status === "pending" && <span className="text-slate-500">Queued</span>}
                      {s.status === "failed" && <span className="text-red-300">Failed</span>}
                      {s.status === "skipped" && <span className="text-slate-500">Skipped</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* Quick export cards */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-emerald-500/10 to-slate-900 p-5">
            <FileSpreadsheet size={22} className="text-emerald-300" />
            <h3 className="mt-3 text-sm font-semibold text-white">Excel export</h3>
            <p className="mt-1 text-xs text-slate-400">
              One workbook per matchday. Sheets for matches, players, and the on-pitch goal matrix.
            </p>
            <button
              onClick={() => handleQuickExport("xlsx")}
              disabled={busy}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Download size={14} /> Download .xlsx
            </button>
          </div>

          <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-amber-500/10 to-slate-900 p-5">
            <FileText size={22} className="text-amber-300" />
            <h3 className="mt-3 text-sm font-semibold text-white">CSV export</h3>
            <p className="mt-1 text-xs text-slate-400">
              Flat CSV for downstream tools. UTF-8.
            </p>
            <button
              onClick={() => handleQuickExport("csv")}
              disabled={busy}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/15 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Download size={14} /> Download .csv
            </button>
          </div>
        </div>
      </div>

      {/* Recent exports */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Recent exports</h2>
            <p className="text-[11px] text-slate-400">Files generated by previous scrape runs</p>
          </div>
          <button
            onClick={askDeleteAll}
            disabled={exportRows.length === 0}
            className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:hover:text-slate-400"
          >
            Clear all
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3 font-medium">File</th>
                <th className="px-3 py-3 font-medium">Format</th>
                <th className="px-3 py-3 font-medium text-right">Rows</th>
                <th className="px-3 py-3 font-medium text-right">Size</th>
                <th className="px-3 py-3 font-medium">Created</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loadingExports && (
                <tr><td colSpan={6} className="px-5 py-6 text-center text-xs text-slate-500">Loading…</td></tr>
              )}
              {!loadingExports && exportRows.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-6 text-center text-xs text-slate-500">No exports yet — trigger a scrape to generate one.</td></tr>
              )}
              {exportRows.map((e) => {
                const isXlsx = e.format === "xlsx";
                const Icon = isXlsx ? FileSpreadsheet : FileText;
                const color = isXlsx ? "text-emerald-300" : "text-amber-300";
                return (
                  <tr key={e.id} className="hover:bg-slate-900/60">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Icon size={16} className={color} />
                        <span className="text-slate-100">{e.file}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${isXlsx ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                        {e.format}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-slate-200 tabular-nums">{(e.rows ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-3 text-right text-slate-200">{formatBytes(e.size_bytes)}</td>
                    <td className="px-3 py-3 text-slate-400">{formatDate(e.created_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => handleDownload(e)}
                          title="Download"
                          className="rounded-md border border-slate-800 bg-slate-900 p-1.5 text-slate-300 hover:text-white"
                        >
                          <Download size={13} />
                        </button>
                        <button
                          onClick={() => askDeleteOne(e)}
                          title="Delete"
                          className="rounded-md border border-slate-800 bg-slate-900 p-1.5 text-slate-300 hover:text-red-300"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDeleteModal
        open={!!confirmState}
        title={confirmTitle}
        message={confirmMessage}
        danger={confirmDanger}
        busy={confirmBusy}
        onCancel={closeConfirm}
        onConfirm={doConfirmedDelete}
      />
    </div>
  );
}
