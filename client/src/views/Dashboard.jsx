import { Trophy, Users, Activity, CheckCircle2, ArrowUpRight, Clock, FileSpreadsheet, AlertTriangle, Info } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area } from "recharts";
import { summary, matchdays, activity, goalDistribution, matchdayTrend } from "../data/mockData.js";

const toneIcon = { success: CheckCircle2, info: Info, warn: AlertTriangle };
const toneColor = {
  success: "text-emerald-400 bg-emerald-500/10",
  info: "text-sky-400 bg-sky-500/10",
  warn: "text-amber-400 bg-amber-500/10",
};

function StatCard({ icon: Icon, label, value, sub, accent }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/40 p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
          <div className="mt-2 text-3xl font-bold text-white">{value}</div>
          {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ onOpenMatchdays }) {
  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          icon={Trophy}
          label="Matches Scraped"
          value={summary.matchesScraped}
          sub={`Across ${summary.matchdaysScraped} matchdays`}
          accent="bg-emerald-500/15 text-emerald-300"
        />
        <StatCard
          icon={Users}
          label="Players Tracked"
          value={summary.playersTracked}
          sub="Lineups + benches reconciled"
          accent="bg-sky-500/15 text-sky-300"
        />
        <StatCard
          icon={Activity}
          label="Events Parsed"
          value={summary.eventsParsed.toLocaleString()}
          sub="Goals · subs · cards"
          accent="bg-amber-500/15 text-amber-300"
        />
        <StatCard
          icon={CheckCircle2}
          label="Success Rate"
          value={`${summary.successRate}%`}
          sub={`Last run · ${summary.lastRun}`}
          accent="bg-fuchsia-500/15 text-fuchsia-300"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Events parsed per matchday</h2>
              <p className="text-xs text-slate-400">Last 6 matchdays · all Bundesliga fixtures</p>
            </div>
            <span className="text-xs text-emerald-300 inline-flex items-center gap-1">
              <ArrowUpRight size={14} /> +9.8% vs prior
            </span>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={matchdayTrend} margin={{ left: -20, right: 8, top: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1f2937" vertical={false} />
                <XAxis dataKey="md" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Area type="monotone" dataKey="events" stroke="#10b981" strokeWidth={2} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-sm font-semibold text-white">Goals by 15-min window</h2>
          <p className="text-xs text-slate-400 mb-4">Spieltag 33 sample</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={goalDistribution} margin={{ left: -20, right: 8, top: 5, bottom: 0 }}>
                <CartesianGrid stroke="#1f2937" vertical={false} />
                <XAxis dataKey="half" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "#0b1220" }}
                  contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="goals" fill="#fbbf24" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="flex items-center justify-between p-5 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Recent matchdays</h2>
              <p className="text-xs text-slate-400">Scrape pipeline status</p>
            </div>
            <button
              onClick={onOpenMatchdays}
              className="text-xs font-medium text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1"
            >
              View all <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="divide-y divide-slate-800">
            {matchdays.map((md) => {
              const pct = Math.round((md.scraped / md.matches) * 100);
              const statusColor =
                md.status === "complete"
                  ? "text-emerald-300 bg-emerald-500/10"
                  : md.status === "running"
                  ? "text-amber-300 bg-amber-500/10"
                  : "text-slate-300 bg-slate-700/40";
              return (
                <div key={md.id} className="grid grid-cols-12 items-center gap-4 px-5 py-3 text-sm">
                  <div className="col-span-3 font-medium text-slate-100">{md.label}</div>
                  <div className="col-span-2 text-slate-400">{md.date}</div>
                  <div className="col-span-4">
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">{md.scraped}/{md.matches} matches</div>
                  </div>
                  <div className="col-span-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${statusColor}`}>
                      {md.status}
                    </span>
                  </div>
                  <div className="col-span-1 text-right text-slate-400">
                    <FileSpreadsheet size={14} className="inline" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Activity</h2>
            <Clock size={14} className="text-slate-500" />
          </div>
          <ul className="space-y-3">
            {activity.map((a) => {
              const Icon = toneIcon[a.tone] || Info;
              return (
                <li key={a.id} className="flex gap-3">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneColor[a.tone]}`}>
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-slate-100">{a.text}</div>
                    <div className="text-xs text-slate-400 truncate">{a.detail}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{a.time}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
