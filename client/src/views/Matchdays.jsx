import { useState } from "react";
import { Calendar, ChevronDown, MapPin, Activity, Loader2, CheckCircle2, Clock3, ArrowRight } from "lucide-react";
import { matchdays, matches } from "../data/mockData.js";

const statusBadge = {
  scraped: { label: "Scraped", cls: "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30", Icon: CheckCircle2 },
  running: { label: "Scraping…", cls: "bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30", Icon: Loader2 },
  queued: { label: "Queued", cls: "bg-slate-700/40 text-slate-300 ring-1 ring-slate-600/40", Icon: Clock3 },
};

function TeamBadge({ team }) {
  const initials = team.code;
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-md text-[11px] font-bold text-white shadow-inner"
        style={{ background: team.color }}
      >
        {initials}
      </div>
      <div className="text-sm font-medium text-slate-100">{team.name}</div>
    </div>
  );
}

export default function Matchdays({ onOpenMatch }) {
  const [selected, setSelected] = useState("md-33");
  const md = matchdays.find((m) => m.id === selected);
  const list = matches.filter((m) => m.matchday === selected);

  return <div className="p-6" />;

  /* TEMP HIDDEN — original content below, restore by removing the `return <div .../>;` line above and the comment markers
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="appearance-none rounded-lg border border-slate-800 bg-slate-900 pl-9 pr-9 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
          >
            {matchdays.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.date}
              </option>
            ))}
          </select>
          <Calendar size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
        </div>

        {md && (
          <div className="flex items-center gap-3 text-xs">
            <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">
              {md.matches} matches
            </span>
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
              {md.scraped} scraped
            </span>
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-300 capitalize">
              {md.status}
            </span>
          </div>
        )}

        <button className="ml-auto rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
          Rescrape matchday
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((m) => {
          const s = statusBadge[m.status];
          const Icon = s.Icon;
          return (
            <button
              key={m.id}
              onClick={() => onOpenMatch && onOpenMatch(m.id)}
              className="group text-left rounded-xl border border-slate-800 bg-slate-900/40 hover:bg-slate-900 hover:border-emerald-500/40 transition overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 pt-4">
                <div className="text-[11px] uppercase tracking-wider text-slate-500">{m.competition}</div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
                  <Icon size={11} className={m.status === "running" ? "animate-spin" : ""} />
                  {s.label}
                </span>
              </div>

              <div className="px-4 pt-3 pb-2 space-y-2">
                <div className="flex items-center justify-between">
                  <TeamBadge team={m.home} />
                  {m.status === "scraped" && (
                    <div className="text-2xl font-bold text-white">{m.home.score}</div>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <TeamBadge team={m.away} />
                  {m.status === "scraped" && (
                    <div className="text-2xl font-bold text-white">{m.away.score}</div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-800 px-4 py-2.5 text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5 truncate">
                  <MapPin size={11} />
                  <span className="truncate">{m.venue}</span>
                </span>
                <span className="flex items-center gap-3">
                  {m.eventsCount && (
                    <span className="flex items-center gap-1">
                      <Activity size={11} /> {m.eventsCount}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-emerald-300 opacity-0 group-hover:opacity-100 transition">
                    Open <ArrowRight size={11} />
                  </span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
  */
}
