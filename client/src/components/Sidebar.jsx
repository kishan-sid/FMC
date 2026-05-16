import { LayoutDashboard, CalendarDays, Trophy, Users, Download, Settings, CircleDot } from "lucide-react";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "matchdays", label: "Matchdays", icon: CalendarDays },
  { id: "match", label: "Match Detail", icon: Trophy },
  { id: "players", label: "Players", icon: Users },
  { id: "exports", label: "Scrape & Export", icon: Download },
];

export default function Sidebar({ view, onChange }) {
  return (
    <aside className="hidden md:flex md:w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-slate-800">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-slate-950">
          <CircleDot size={20} strokeWidth={2.5} />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-bold text-white">Football Scrapper</span>
          <span className="text-[11px] text-slate-500">Bundesliga · v0.1</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                active
                  ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
              }`}
            >
              <Icon size={18} />
              <span className="font-medium">{item.label}</span>
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 p-4">
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-100 hover:bg-slate-900">
          <Settings size={18} />
          Settings
        </button>
        <div className="mt-3 rounded-lg bg-gradient-to-br from-emerald-500/10 to-amber-500/10 border border-emerald-500/20 p-3">
          <div className="text-[11px] uppercase tracking-wider text-emerald-300/80">Pro Tip</div>
          <div className="mt-1 text-xs text-slate-300">
            Run <code className="text-emerald-300">npm run scrape -- --md 33</code> to refresh a matchday.
          </div>
        </div>
      </div>
    </aside>
  );
}
