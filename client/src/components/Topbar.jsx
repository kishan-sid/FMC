import { useEffect, useRef, useState } from "react";
import { Bell, LogOut, ChevronDown } from "lucide-react";

export default function Topbar({ title, subtitle, user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const initials =
    user?.initials ||
    (user?.name
      ? user.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
      : "U");

  return (
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur px-6 py-4">
      <div className="flex items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-white">{title}</h1>
          {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button className="relative rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-slate-100">
            <Bell size={16} />
            <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
          </button>

          <div ref={ref} className="relative ml-1">
            <button
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 pl-1 pr-2 py-1 hover:border-emerald-500/40"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-amber-400 text-xs font-bold text-slate-950">
                {initials}
              </span>
              <span className="hidden md:flex flex-col leading-tight text-left">
                <span className="text-xs font-semibold text-slate-100">{user?.name || "User"}</span>
                <span className="text-[10px] text-slate-500 capitalize">{user?.role || "member"}</span>
              </span>
              <ChevronDown size={14} className="text-slate-500" />
            </button>

            {open && (
              <div className="absolute right-0 mt-2 w-56 rounded-lg border border-slate-800 bg-slate-900 shadow-xl overflow-hidden">
                <div className="px-3 py-3 border-b border-slate-800">
                  <div className="text-sm font-semibold text-slate-100">{user?.name}</div>
                  <div className="text-[11px] text-slate-400">{user?.email}</div>
                </div>
                <button
                  onClick={onLogout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
