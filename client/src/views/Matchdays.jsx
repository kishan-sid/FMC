import { CalendarDays } from "lucide-react";

export default function Matchdays() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 border border-slate-800 text-slate-500">
          <CalendarDays size={24} />
        </div>
        <h2 className="mt-4 text-base font-semibold text-slate-200">Matchdays</h2>
        <p className="mt-1 text-xs text-slate-500">Coming soon.</p>
      </div>
    </div>
  );
}
