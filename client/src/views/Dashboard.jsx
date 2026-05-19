import { Trophy, Users, Activity, CheckCircle2 } from "lucide-react";
import { summary } from "../data/mockData.js";

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

export default function Dashboard() {
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
    </div>
  );
}
