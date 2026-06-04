import { useEffect, useState } from "react";
import { Target, RefreshCw, Square, Users, ListTree, ChartArea, Calendar, MapPin, UserCog, ArrowRightLeft, Trophy } from "lucide-react";
import { fetchMatchDetail } from "../lib/data.js";

const eventConfig = {
  goal: { Icon: Target, color: "text-emerald-300", bg: "bg-emerald-500/15", ring: "ring-emerald-500/40", label: "Goal" },
  sub: { Icon: ArrowRightLeft, color: "text-sky-300", bg: "bg-sky-500/15", ring: "ring-sky-500/40", label: "Sub" },
  card: { Icon: Square, color: "text-amber-300", bg: "bg-amber-500/15", ring: "ring-amber-500/40", label: "Card" },
};

const TABS = [
  { id: "events", label: "Events", Icon: ListTree },
  { id: "lineups", label: "Lineups", Icon: Users },
  { id: "timeline", label: "Player Timeline", Icon: ChartArea },
];

function ScoreCard({ detail }) {
  const { home, away, date, venue, competition, referee, attendance } = detail;
  return (
    <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-6">
      <div className="flex items-center justify-between text-xs text-slate-400 mb-5">
        <span className="rounded-full bg-slate-800 px-2.5 py-1">{competition}</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5"><Calendar size={12} /> {date}</span>
          {venue && <span className="flex items-center gap-1.5"><MapPin size={12} /> {venue}</span>}
        </div>
      </div>

      <div className="grid grid-cols-3 items-center gap-4">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl text-lg font-bold text-white shadow-lg"
               style={{ background: home.color }}>
            {home.code}
          </div>
          <div className="mt-2 text-sm font-semibold text-white">{home.name}</div>
          <div className="text-[11px] text-slate-500">{home.formation}</div>
        </div>

        <div className="flex flex-col items-center">
          <div className="text-5xl font-bold text-white tabular-nums tracking-tight">
            {home.score} <span className="text-slate-600">:</span> {away.score}
          </div>
          <div className="mt-2 rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs font-medium text-emerald-300">
            Full Time
          </div>
        </div>

        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl text-lg font-bold text-white shadow-lg"
               style={{ background: away.color }}>
            {away.code}
          </div>
          <div className="mt-2 text-sm font-semibold text-white">{away.name}</div>
          <div className="text-[11px] text-slate-500">{away.formation}</div>
        </div>
      </div>

      {(referee !== "—" || attendance > 0) && (
        <div className="mt-5 flex items-center justify-center gap-6 text-[11px] text-slate-500 border-t border-slate-800 pt-4">
          {referee !== "—" && <span className="flex items-center gap-1.5"><UserCog size={12} /> Ref: {referee}</span>}
          {attendance > 0 && <span>Attendance: {attendance.toLocaleString()}</span>}
        </div>
      )}
    </div>
  );
}

function EventsTab({ detail }) {
  if (!detail.events.length) {
    return <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-500">No events parsed for this match.</div>;
  }
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-5 py-3">
        <h3 className="text-sm font-semibold text-white">Match events timeline</h3>
        <p className="text-[11px] text-slate-400">Goals, substitutions, cards — extracted via scraper</p>
      </div>
      <ol className="relative px-5 py-4">
        <div className="absolute left-[42px] top-4 bottom-4 w-px bg-slate-800" />
        {detail.events.map((e, idx) => {
          const cfg = eventConfig[e.type] || eventConfig.goal;
          const Icon = cfg.Icon;
          const isHome = e.team === "home";
          return (
            <li key={idx} className="relative grid grid-cols-[40px_32px_1fr] items-start gap-3 py-2.5">
              <div className="text-right text-xs font-semibold text-slate-400 tabular-nums pt-1.5">
                {e.minute}'
              </div>
              <div className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full ${cfg.bg} ring-2 ${cfg.ring} ${cfg.color}`}>
                <Icon size={12} fill={e.type === "card" ? "currentColor" : "none"} />
              </div>
              <div className={`rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 ${isHome ? "" : "ml-auto max-w-md w-full"}`}
                   style={{ maxWidth: "32rem" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${isHome ? "bg-red-500/15 text-red-300" : "bg-yellow-500/15 text-yellow-300"}`}>
                      {isHome ? detail.home.code : detail.away.code}
                    </span>
                    <span className="text-sm font-medium text-slate-100 truncate">
                      {e.type === "sub" ? `${e.playerOff} → ${e.playerOn}` : e.player}
                    </span>
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider ${cfg.color}`}>{cfg.label}</span>
                </div>
                {(e.assist || e.detail) && (
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {e.assist ? `Assist: ${e.assist} · ` : ""}{e.detail}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function LineupColumn({ detail, side, label, color }) {
  const team = detail.lineups[side];
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded" style={{ background: color }} />
          <span className="text-sm font-semibold text-white">{label}</span>
        </div>
        <span className="text-[11px] text-slate-500">{detail[side].formation}</span>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Starting XI</div>
          <ul className="space-y-1">
            {team.starters.map((p, i) => (
              <li key={p.num || i} className="flex items-center gap-3 rounded-lg bg-slate-950/40 px-3 py-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-800 text-xs font-bold text-slate-200">
                  {p.num}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-100 truncate">{p.name}</div>
                  <div className="text-[11px] text-slate-500">{p.position} · {p.minutesOff - p.minutesOn}'</div>
                </div>
                <div className="text-right text-[11px]">
                  <span className="text-emerald-300">+{p.goalsFor}</span>
                  <span className="text-slate-500"> / </span>
                  <span className="text-red-300">-{p.goalsAgainst}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        {team.bench.length > 0 && (
          <div>
            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Substitutes</div>
            <ul className="space-y-1">
              {team.bench.map((p, i) => (
                <li key={p.num || i} className="flex items-center gap-3 rounded-lg bg-slate-950/40 px-3 py-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-800 text-xs font-bold text-slate-200">
                    {p.num}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-100 truncate">{p.name}</div>
                    <div className="text-[11px] text-slate-500">{p.position || "Bench"}{p.minutesOn ? ` · came on ${p.minutesOn}'` : ""}</div>
                  </div>
                  <div className="text-right text-[11px]">
                    <span className="text-emerald-300">+{p.goalsFor}</span>
                    <span className="text-slate-500"> / </span>
                    <span className="text-red-300">-{p.goalsAgainst}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineTab({ detail }) {
  const all = [
    ...detail.lineups.home.starters.map((p) => ({ ...p, team: detail.home.code, side: "home" })),
    ...detail.lineups.home.bench.map((p) => ({ ...p, team: detail.home.code, side: "home" })),
    ...detail.lineups.away.starters.map((p) => ({ ...p, team: detail.away.code, side: "away" })),
    ...detail.lineups.away.bench.map((p) => ({ ...p, team: detail.away.code, side: "away" })),
  ];
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-5 py-3">
        <h3 className="text-sm font-semibold text-white">Player on-pitch timeline</h3>
        <p className="text-[11px] text-slate-400">Reconstructed from starting XI + substitutions.</p>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-[160px_1fr_auto] items-center gap-3 mb-2 text-[10px] uppercase tracking-wider text-slate-500">
          <div>Player</div>
          <div className="relative">
            <div className="flex justify-between">
              {[0, 15, 30, 45, 60, 75, 90].map((m) => (
                <span key={m}>{m}'</span>
              ))}
            </div>
          </div>
          <div>+ / −</div>
        </div>
        <ul className="space-y-1.5">
          {all.map((p, i) => {
            const left = (p.minutesOn / 90) * 100;
            const width = (Math.max(p.minutesOff - p.minutesOn, 0) / 90) * 100;
            const sideColor = p.side === "home" ? "from-red-500 to-red-400" : "from-yellow-500 to-yellow-400";
            return (
              <li key={i} className="grid grid-cols-[160px_1fr_auto] items-center gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${p.side === "home" ? "bg-red-500/15 text-red-300" : "bg-yellow-500/15 text-yellow-300"}`}>
                    {p.team}
                  </span>
                  <span className="text-xs text-slate-200 truncate">{p.name}</span>
                </div>
                <div className="relative h-5 rounded-full bg-slate-950/60 ring-1 ring-slate-800">
                  <div
                    className={`absolute top-0 bottom-0 rounded-full bg-gradient-to-r ${sideColor} opacity-80`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                  <div className="absolute inset-0 flex justify-between px-1">
                    {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => (
                      <span key={idx} className="w-px bg-slate-800/80" />
                    ))}
                  </div>
                </div>
                <div className="text-xs tabular-nums w-16 text-right">
                  <span className="text-emerald-300">+{p.goalsFor}</span>
                  <span className="text-slate-600"> / </span>
                  <span className="text-red-300">-{p.goalsAgainst}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default function MatchDetail({ matchId }) {
  const [tab, setTab] = useState("events");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const live = await fetchMatchDetail(matchId);
      if (alive) { setDetail(live); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [matchId]);

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">Loading match…</div>;
  }

  if (!detail) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 border border-slate-800 text-slate-500">
            <Trophy size={24} />
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-200">No match scraped yet</h2>
          <p className="mt-1 text-xs text-slate-500">Open a match from <span className="text-emerald-300">Matchdays</span>, or scrape one first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <ScoreCard detail={detail} />

      <div className="flex items-center gap-2 border-b border-slate-800">
        {TABS.map((t) => {
          const Icon = t.Icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
                active
                  ? "border-emerald-400 text-emerald-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
        <button className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
          <RefreshCw size={12} /> Re-parse match
        </button>
      </div>

      {tab === "events" && <EventsTab detail={detail} />}
      {tab === "lineups" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LineupColumn detail={detail} side="home" label={detail.home.name} color={detail.home.color} />
          <LineupColumn detail={detail} side="away" label={detail.away.name} color={detail.away.color} />
        </div>
      )}
      {tab === "timeline" && <TimelineTab detail={detail} />}
    </div>
  );
}
