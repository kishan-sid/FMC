import { useState } from "react";
import { Link2, Play, FileSpreadsheet, FileText, Download, CheckCircle2, Loader2, Clock3, Trash2 } from "lucide-react";
import { exports_ } from "../data/mockData.js";

const STEPS = [
  { id: 1, label: "Fetching matchday page", state: "done" },
  { id: 2, label: "Extracting match URLs", state: "done" },
  { id: 3, label: "Scraping events + lineups", state: "running", pct: 72 },
  { id: 4, label: "Reconstructing player timelines", state: "queued" },
  { id: 5, label: "Computing on-pitch goals", state: "queued" },
  { id: 6, label: "Building Excel/CSV", state: "queued" },
];

const stateUI = {
  done: { Icon: CheckCircle2, color: "text-emerald-300" },
  running: { Icon: Loader2, color: "text-amber-300 animate-spin" },
  queued: { Icon: Clock3, color: "text-slate-500" },
};

export default function Exports() {
  const [url, setUrl] = useState("https://www.kicker.de/bundesliga/spieltag/2025-26/33");

  return <div className="p-6" />;

  /* TEMP HIDDEN — original content below
  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-sm font-semibold text-white">Trigger a scrape</h2>
          <p className="text-xs text-slate-400">Paste a matchday URL or a single match URL. The pipeline handles the rest.</p>

          <div className="mt-4 flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5">
              <Link2 size={14} className="text-slate-500" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
                placeholder="https://…"
              />
            </div>
            <button className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
              <Play size={14} fill="currentColor" />
              Start Scrape
            </button>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Pipeline progress</span>
              <span>3 of 6 steps</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-amber-400" style={{ width: "45%" }} />
            </div>

            <ol className="mt-4 space-y-2">
              {STEPS.map((s) => {
                const ui = stateUI[s.state];
                const Icon = ui.Icon;
                return (
                  <li key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                    <Icon size={14} className={ui.color} />
                    <span className="text-sm text-slate-200">{s.label}</span>
                    {s.state === "running" && (
                      <span className="ml-auto text-xs text-amber-300">{s.pct}%</span>
                    )}
                    {s.state === "done" && (
                      <span className="ml-auto text-xs text-emerald-300">Done</span>
                    )}
                    {s.state === "queued" && (
                      <span className="ml-auto text-xs text-slate-500">Queued</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-emerald-500/10 to-slate-900 p-5">
            <FileSpreadsheet size={22} className="text-emerald-300" />
            <h3 className="mt-3 text-sm font-semibold text-white">Excel export</h3>
            <p className="mt-1 text-xs text-slate-400">
              One workbook per matchday. Sheets for matches, players, and the on-pitch goal matrix.
            </p>
            <button className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
              <Download size={14} /> Download .xlsx
            </button>
          </div>
          <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-amber-500/10 to-slate-900 p-5">
            <FileText size={22} className="text-amber-300" />
            <h3 className="mt-3 text-sm font-semibold text-white">CSV export</h3>
            <p className="mt-1 text-xs text-slate-400">
              Flat CSV for downstream tools. UTF-8, semicolon-delimited.
            </p>
            <button className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/15">
              <Download size={14} /> Download .csv
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Recent exports</h2>
            <p className="text-[11px] text-slate-400">Files generated by previous scrape runs</p>
          </div>
          <button className="text-xs text-slate-400 hover:text-slate-200">Clear all</button>
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
              {exports_.map((e) => {
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
                    <td className="px-3 py-3 text-right text-slate-200 tabular-nums">{e.rows.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right text-slate-200">{e.size}</td>
                    <td className="px-3 py-3 text-slate-400">{e.at}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button className="rounded-md border border-slate-800 bg-slate-900 p-1.5 text-slate-300 hover:text-white">
                          <Download size={13} />
                        </button>
                        <button className="rounded-md border border-slate-800 bg-slate-900 p-1.5 text-slate-300 hover:text-red-300">
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
    </div>
  );
  */
}
