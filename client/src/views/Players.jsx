import { useMemo, useState } from "react";
import { Search, Filter, ArrowUpDown, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { playerOnPitchTable } from "../data/mockData.js";

const TEAM_COLOR = {
  FCB: "bg-red-500/15 text-red-300",
  BVB: "bg-yellow-500/15 text-yellow-300",
  B04: "bg-rose-500/15 text-rose-300",
  RBL: "bg-pink-500/15 text-pink-300",
};

function DiffPill({ diff }) {
  if (diff > 0) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300"><TrendingUp size={11} /> +{diff}</span>;
  if (diff < 0) return <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300"><TrendingDown size={11} /> {diff}</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-slate-700/40 px-2 py-0.5 text-xs font-semibold text-slate-300"><Minus size={11} /> 0</span>;
}

export default function Players() {
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("ALL");
  const [sortKey, setSortKey] = useState("diff");

  const teams = useMemo(() => ["ALL", ...new Set(playerOnPitchTable.map((p) => p.team))], []);

  const rows = useMemo(() => {
    let r = playerOnPitchTable.filter((p) =>
      (team === "ALL" || p.team === team) &&
      (q === "" || p.name.toLowerCase().includes(q.toLowerCase()))
    );
    r.sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
    return r;
  }, [q, team, sortKey]);

  const totals = useMemo(() => ({
    players: rows.length,
    minutes: rows.reduce((s, p) => s + p.minutes, 0),
    goalsFor: rows.reduce((s, p) => s + p.goalsFor, 0),
    goalsAgainst: rows.reduce((s, p) => s + p.goalsAgainst, 0),
  }), [rows]);

  return <div className="p-6" />;

  /* TEMP HIDDEN — original content below
  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Players in view</div>
          <div className="mt-1 text-2xl font-bold text-white">{totals.players}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Total minutes</div>
          <div className="mt-1 text-2xl font-bold text-white">{totals.minutes.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Goals while on</div>
          <div className="mt-1 text-2xl font-bold text-emerald-300">{totals.goalsFor}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Conceded while on</div>
          <div className="mt-1 text-2xl font-bold text-red-300">{totals.goalsAgainst}</div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-5 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-sm w-64">
            <Search size={14} className="text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search player…"
              className="w-full bg-transparent outline-none text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Filter size={12} className="text-slate-500" />
            {teams.map((t) => (
              <button
                key={t}
                onClick={() => setTeam(t)}
                className={`rounded-full px-2.5 py-1 font-medium ${
                  team === t
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                    : "bg-slate-800 text-slate-400 hover:text-slate-100"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <ArrowUpDown size={12} className="text-slate-500" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="diff">Sort: +/−</option>
              <option value="goalsFor">Sort: Goals For</option>
              <option value="goalsAgainst">Sort: Goals Against</option>
              <option value="minutes">Sort: Minutes</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3 font-medium">Player</th>
                <th className="px-3 py-3 font-medium">Team</th>
                <th className="px-3 py-3 font-medium">Pos</th>
                <th className="px-3 py-3 font-medium text-right">Min</th>
                <th className="px-3 py-3 font-medium text-right">Goals For</th>
                <th className="px-3 py-3 font-medium text-right">Goals Against</th>
                <th className="px-5 py-3 font-medium text-right">+/−</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-900/60">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400/30 to-amber-400/30 text-xs font-bold text-white">
                        {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                      </div>
                      <div className="text-slate-100">{p.name}</div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${TEAM_COLOR[p.team] || "bg-slate-800 text-slate-300"}`}>
                      {p.team}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-400">{p.position}</td>
                  <td className="px-3 py-3 text-right text-slate-200 tabular-nums">{p.minutes}'</td>
                  <td className="px-3 py-3 text-right text-emerald-300 font-semibold tabular-nums">{p.goalsFor}</td>
                  <td className="px-3 py-3 text-right text-red-300 font-semibold tabular-nums">{p.goalsAgainst}</td>
                  <td className="px-5 py-3 text-right"><DiffPill diff={p.diff} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
  */
}
