import { useState } from "react";
import { CircleDot, Mail, Lock, Eye, EyeOff, Loader2, AlertTriangle, Trophy, Activity, Users } from "lucide-react";
import { supabase, supabaseConfigured } from "../lib/supabase.js";

export default function Login({ onAuthed }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Email is required.");
      return;
    }
    // RFC-5322-lite: something@something.something
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (!supabaseConfigured) {
      setError(
        "Supabase env not set. Create client/.env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart npm run dev."
      );
      return;
    }
    setLoading(true);
    try {
      const { data, error: supaError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (supaError) throw supaError;

      const u = data.user;
      const user = {
        id: u.id,
        email: u.email,
        name: u.user_metadata?.name || u.email,
        role: u.user_metadata?.role || "user",
        initials: (u.user_metadata?.name || u.email || "U")
          .split(/\s+/)
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
          .toUpperCase(),
      };
      onAuthed?.(user);
    } catch (err) {
      setError(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-950 text-slate-100">
      {/* Brand panel */}
      <aside className="hidden lg:flex flex-col justify-between p-10 relative overflow-hidden bg-gradient-to-br from-emerald-900/30 via-slate-950 to-slate-950">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(16,185,129,0.25), transparent 40%), radial-gradient(circle at 80% 60%, rgba(251,191,36,0.18), transparent 45%)",
          }}
        />
        <div className="absolute inset-0 opacity-[0.08]" style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, #ffffff 0 1px, transparent 1px 60px), repeating-linear-gradient(90deg, #ffffff 0 1px, transparent 1px 60px)",
        }} />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500 text-slate-950">
            <CircleDot size={22} strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-base font-bold">Football Scrapper</div>
            <div className="text-[11px] text-slate-400">Bundesliga match data automation</div>
          </div>
        </div>

        <div className="relative space-y-6 max-w-md">
          <h2 className="text-3xl font-bold leading-tight">
            Every <span className="text-emerald-400">goal</span>, every <span className="text-amber-400">minute</span>, every player — automated.
          </h2>
          <p className="text-sm text-slate-400">
            Scrape Spieltag fixtures, reconstruct on-pitch timelines, and export clean Excel reports in one click.
          </p>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
                <Trophy size={14} />
              </span>
              108 matches scraped across 12 matchdays
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
                <Activity size={14} />
              </span>
              4,318 events parsed · 99.1% success rate
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
                <Users size={14} />
              </span>
              642 player timelines reconciled
            </li>
          </ul>
        </div>

        <div className="relative text-[11px] text-slate-500">© 2026 Football Scrapper · Built for analysts</div>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-slate-950">
              <CircleDot size={20} strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-base font-bold">Football Scrapper</div>
              <div className="text-[11px] text-slate-400">Bundesliga data automation</div>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to your dashboard.</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-400">Email</label>
              <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2.5 focus-within:border-emerald-500">
                <Mail size={14} className="text-slate-500" />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  placeholder="you@football.com"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-400">Password</label>
              <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2.5 focus-within:border-emerald-500">
                <Lock size={14} className="text-slate-500" />
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="text-slate-500 hover:text-slate-300"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-400 select-none">
              <input type="checkbox" defaultChecked className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500" />
              Keep me signed in for 12 hours
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

        
        </div>
      </main>
    </div>
  );
}
