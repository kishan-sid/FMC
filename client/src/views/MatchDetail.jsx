import { useState } from "react";
import { Target, RefreshCw, Square, Users, ListTree, ChartArea, Calendar, MapPin, UserCog, ArrowRightLeft } from "lucide-react";
import { matchDetail } from "../data/mockData.js";

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

function ScoreCard() {
  const { home, away, date, venue, competition, referee, attendance } = matchDetail;
  return (
    <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-6">
      <div className="flex items-center justify-between text-xs text-slate-400 mb-5">
        <span className="rounded-full bg-slate-800 px-2.5 py-1">{competition}</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5"><Calendar size={12} /> {date}</span>
          <span className="flex items-center gap-1.5"><MapPin size={12} /> {venue}</span>
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

      <div className="mt-5 flex items-center justify-center gap-6 text-[11px] text-slate-500 border-t border-slate-800 pt-4">
        <span className="flex items-center gap-1.5"><UserCog size={12} /> Ref: {referee}</span>
        <span>Attendance: {attendance.toLocaleString()}</span>
      </div>
    </div>
  );
}

function EventsTab() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-5 py-3">
        <h3 className="text-sm font-semibold text-white">Match events timeline</h3>
        <p className="text-[11px] text-slate-400">Goals, substitutions, cards — extracted via scraper</p>
      </div>
      <ol className="relative px-5 py-4">
        <div className="absolute left-[42px] top-4 bottom-4 w-px bg-slate-800" />
        {matchDetail.events.map((e, idx) => {
          const cfg = eventConfig[e.type];
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
                      {isHome ? matchDetail.home.code : matchDetail.away.code}
                    </span>
                    <span className="text-sm font-medium text-slate-100 truncate">
                      {e.type === "sub" ? `${e.playerOff} → ${e.playerOn}` : e.player}
                    </span>
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider ${cfg.color}`}>{cfg.label}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  {e.assist ? `Assist: ${e.assist} · ` : ""}{e.detail}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function LineupColumn({ side, label, color }) {
  const team = matchDetail.lineups[side];
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded" style={{ background: color }} />
          <span className="text-sm font-semibold text-white">{label}</span>
        </div>
        <span className="text-[11px] text-slate-500">{matchDetail[side].formation}</span>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Starting XI</div>
          <ul className="space-y-1">
            {team.starters.map((p) => (
              <li key={p.num} className="flex items-center gap-3 rounded-lg bg-slate-950/40 px-3 py-2">
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
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Subs that played</div>
          <ul className="space-y-1">
            {team.bench.map((p) => (
              <li key={p.num} className="flex items-center gap-3 rounded-lg bg-slate-950/40 px-3 py-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-800 text-xs font-bold text-slate-200">
                  {p.num}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-100 truncate">{p.name}</div>
                  <div className="text-[11px] text-slate-500">{p.position} · came on {p.minutesOn}'</div>
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
      </div>
    </div>
  );
}

function TimelineTab() {
  const all = [
    ...matchDetail.lineups.home.starters.map((p) => ({ ...p, team: matchDetail.home.code, side: "home" })),
    ...matchDetail.lineups.home.bench.map((p) => ({ ...p, team: matchDetail.home.code, side: "home" })),
    ...matchDetail.lineups.away.starters.map((p) => ({ ...p, team: matchDetail.away.code, side: "away" })),
    ...matchDetail.lineups.away.bench.map((p) => ({ ...p, team: matchDetail.away.code, side: "away" })),
  ];
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-5 py-3">
        <h3 className="text-sm font-semibold text-white">Player on-pitch timeline</h3>
        <p className="text-[11px] text-slate-400">Reconstructed from starting XI + substitutions. Hover for details.</p>
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
            const width = ((p.minutesOff - p.minutesOn) / 90) * 100;
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

export default function MatchDetail() {
  const [tab, setTab] = useState("events");
  return (
    <div className="space-y-6 p-6">
      <ScoreCard />

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

      {tab === "events" && <EventsTab />}
      {tab === "lineups" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LineupColumn side="home" label={matchDetail.home.name} color={matchDetail.home.color} />
          <LineupColumn side="away" label={matchDetail.away.name} color={matchDetail.away.color} />
        </div>
      )}
      {tab === "timeline" && <TimelineTab />}
    </div>
  );
}
