import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, RefreshCw, Radio, Globe, Goal, AlertTriangle, ArrowRightLeft, Square, Loader2 } from "lucide-react";
import { liveApi, isLiveStatus, statusLabel } from "../lib/liveApi.js";

function LiveDot() {
  return <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" /></span>;
}

function TeamLogo({ src, alt }) {
  if (!src) return <div className="h-6 w-6 rounded bg-slate-800" />;
  return <img src={src} alt={alt} className="h-6 w-6 object-contain" loading="lazy" />;
}

function StatCard({ label, value, accent }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent || "text-white"}`}>{value}</div>
    </div>
  );
}

function MatchRow({ m, active, onClick }) {
  const live = isLiveStatus(m.status);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border px-3 py-2.5 transition ${
        active ? "border-emerald-500/50 bg-emerald-500/5" : "border-slate-800 bg-slate-950/40 hover:bg-slate-900"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-flex min-w-[42px] items-center justify-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${live ? "bg-red-500/15 text-red-300" : "bg-slate-800 text-slate-400"}`}>
          {live && <LiveDot />}{statusLabel(m)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0"><TeamLogo src={m.home.logo} alt={m.home.name} /><span className="truncate text-sm text-slate-100">{m.home.name}</span></div>
            <span className="text-sm font-bold tabular-nums text-white">{m.home.score ?? "-"}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0"><TeamLogo src={m.away.logo} alt={m.away.name} /><span className="truncate text-sm text-slate-100">{m.away.name}</span></div>
            <span className="text-sm font-bold tabular-nums text-white">{m.away.score ?? "-"}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

const evIcon = (e) => {
  if (e.type === "Goal") return { Icon: Goal, c: "text-emerald-300" };
  if (e.type === "Card") return { Icon: Square, c: e.detail?.includes("Red") ? "text-red-400" : "text-amber-300" };
  if (e.type === "subst") return { Icon: ArrowRightLeft, c: "text-sky-300" };
  return { Icon: Goal, c: "text-slate-400" };
};

function DetailPanel({ fixtureId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fixtureId) { setData(null); return; }
    let alive = true;
    setLoading(true);
    liveApi.fixture(fixtureId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [fixtureId]);

  if (!fixtureId) return <div className="flex h-full items-center justify-center text-sm text-slate-500">Select a match to see lineups, players & events.</div>;
  if (loading && !data) return <div className="flex h-full items-center justify-center text-sm text-slate-500"><Loader2 size={16} className="mr-2 animate-spin" />Loading match…</div>;
  if (!data?.fixture) return <div className="flex h-full items-center justify-center text-sm text-slate-500">No data for this match yet.</div>;

  const { fixture: fx, lineups, events } = data;
  // Players "on pitch" = starting XI minus players sent off (red card).
  const redByTeam = {};
  events.filter((e) => e.type === "Card" && e.detail?.includes("Red")).forEach((e) => { redByTeam[e.teamId] = (redByTeam[e.teamId] || 0) + 1; });
  const onPitch = (teamId) => Math.max(11 - (redByTeam[teamId] || 0), 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-[11px] text-slate-400">{fx.league.country} · {fx.league.name} · {fx.league.round}</div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0"><TeamLogo src={fx.home.logo} alt="" /><span className="truncate text-sm font-semibold text-white">{fx.home.name}</span></div>
          <div className="px-3 text-xl font-bold tabular-nums text-white">{fx.home.score ?? 0} : {fx.away.score ?? 0}</div>
          <div className="flex items-center gap-2 min-w-0 justify-end"><span className="truncate text-sm font-semibold text-white">{fx.away.name}</span><TeamLogo src={fx.away.logo} alt="" /></div>
        </div>
        <div className="mt-2 text-center text-[11px] text-emerald-300">{statusLabel(fx)} · {fx.statusLong}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {lineups.length ? lineups.map((lu) => (
          <div key={lu.teamId} className="rounded-xl border border-slate-800 bg-slate-900/40">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
              <div className="flex items-center gap-2"><TeamLogo src={lu.teamLogo} alt="" /><span className="text-sm font-semibold text-white">{lu.teamName}</span></div>
              <span className="text-[11px] text-slate-500">{lu.formation} · {onPitch(lu.teamId)} on pitch</span>
            </div>
            <div className="p-3 space-y-3">
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Starting XI ({lu.startXI.length})</div>
                <ul className="space-y-0.5">
                  {lu.startXI.map((p, i) => (
                    <li key={i} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-950/50">
                      <span className="w-5 text-right text-[11px] tabular-nums text-slate-500">{p.num}</span>
                      <span className="text-slate-100 truncate">{p.name}</span>
                      <span className="ml-auto text-[10px] text-slate-500">{p.pos}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {lu.substitutes.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Substitutes ({lu.substitutes.length})</div>
                  <ul className="space-y-0.5">
                    {lu.substitutes.map((p, i) => (
                      <li key={i} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-400">
                        <span className="w-5 text-right text-[11px] tabular-nums text-slate-600">{p.num}</span>
                        <span className="truncate">{p.name}</span>
                        <span className="ml-auto text-[10px] text-slate-600">{p.pos}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {lu.coach && <div className="text-[11px] text-slate-500">Coach: {lu.coach}</div>}
            </div>
          </div>
        )) : (
          <div className="lg:col-span-2 rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
            Lineups not published yet (usually available ~40 min before kickoff).
          </div>
        )}
      </div>

      {events.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="border-b border-slate-800 px-4 py-2.5 text-sm font-semibold text-white">Events</div>
          <ul className="p-3 space-y-1">
            {events.map((e, i) => {
              const { Icon, c } = evIcon(e);
              return (
                <li key={i} className="flex items-center gap-3 rounded px-2 py-1.5 text-sm">
                  <span className="w-8 text-right text-[11px] tabular-nums text-slate-500">{e.minute}{e.extra ? `+${e.extra}` : ""}'</span>
                  <Icon size={13} className={c} />
                  <span className="text-slate-100">{e.player}</span>
                  {e.assist && e.type === "Goal" && <span className="text-[11px] text-slate-500">({e.assist})</span>}
                  <span className="ml-auto text-[11px] text-slate-500">{e.teamName}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Live() {
  const [tab, setTab] = useState("live"); // live | today
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(true);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async (silent) => {
    silent ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const res = tab === "live" ? await liveApi.liveMatches() : await liveApi.byDate();
      setMatches(res.matches || []);
      setConfigured(true);
    } catch (e) {
      if (/API_FOOTBALL_KEY/.test(e.message)) setConfigured(false);
      else setError(e.message);
      setMatches([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useEffect(() => { load(false); }, [load]);

  // Auto-refresh live tab every 30s.
  useEffect(() => {
    if (tab !== "live") return;
    timer.current = setInterval(() => load(true), 30000);
    return () => clearInterval(timer.current);
  }, [tab, load]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? matches.filter((m) => `${m.home.name} ${m.away.name} ${m.league.name} ${m.league.country}`.toLowerCase().includes(term))
      : matches;
    // group by league
    const groups = new Map();
    for (const m of list) {
      const k = `${m.league.country} · ${m.league.name}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    return [...groups.entries()];
  }, [matches, q]);

  const liveCount = matches.filter((m) => isLiveStatus(m.status)).length;
  const leagues = new Set(matches.map((m) => m.league.id)).size;
  const goals = matches.reduce((s, m) => s + (m.home.score || 0) + (m.away.score || 0), 0);

  if (!configured) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center">
          <Radio size={28} className="mx-auto text-emerald-400" />
          <h2 className="mt-3 text-base font-semibold text-white">Connect a football data API</h2>
          <p className="mt-2 text-sm text-slate-400">
            Add a free API-Football key to the server to load live scores worldwide.
          </p>
          <ol className="mt-3 text-left text-xs text-slate-400 space-y-1">
            <li>1. Sign up free at <span className="text-emerald-300">dashboard.api-football.com</span></li>
            <li>2. Put <code className="text-emerald-300">API_FOOTBALL_KEY=…</code> in <code>server/.env</code></li>
            <li>3. Restart the server</li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Live now" value={liveCount} accent="text-red-300" />
        <StatCard label={tab === "live" ? "Matches in play" : "Matches today"} value={matches.length} />
        <StatCard label="Leagues" value={leagues} />
        <StatCard label="Goals" value={goals} accent="text-emerald-300" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* List */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-3">
            <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-1 text-xs">
              <button onClick={() => setTab("live")} className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-medium ${tab === "live" ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400"}`}><Radio size={12} /> Live</button>
              <button onClick={() => setTab("today")} className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-medium ${tab === "today" ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400"}`}><Globe size={12} /> Today</button>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-sm flex-1 min-w-[140px]">
              <Search size={14} className="text-slate-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search team / league…" className="w-full bg-transparent outline-none text-slate-100 placeholder:text-slate-500" />
            </div>
            <button onClick={() => load(true)} className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-slate-100" title="Refresh">
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-3 space-y-4">
            {loading && <div className="py-10 text-center text-sm text-slate-500"><Loader2 size={16} className="mr-2 inline animate-spin" />Loading matches…</div>}
            {error && <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"><AlertTriangle size={14} className="mt-0.5" />{error}</div>}
            {!loading && !error && filtered.length === 0 && (
              <div className="py-10 text-center text-sm text-slate-500">
                {tab === "live" ? "No matches in play right now. Try the Today tab." : "No matches found."}
              </div>
            )}
            {filtered.map(([league, list]) => (
              <div key={league}>
                <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">{league}</div>
                <div className="space-y-1.5">
                  {list.map((m) => (
                    <MatchRow key={m.id} m={m} active={selected === m.id} onClick={() => setSelected(m.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-4 min-h-[300px]">
          <DetailPanel fixtureId={selected} />
        </div>
      </div>
    </div>
  );
}
