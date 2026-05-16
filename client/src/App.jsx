import { useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import Dashboard from "./views/Dashboard.jsx";
import Matchdays from "./views/Matchdays.jsx";
import MatchDetail from "./views/MatchDetail.jsx";
import Players from "./views/Players.jsx";
import Exports from "./views/Exports.jsx";
import Login from "./views/Login.jsx";

const META = {
  dashboard: { title: "Dashboard", subtitle: "Pipeline overview · last 6 matchdays" },
  matchdays: { title: "Matchdays", subtitle: "All scraped fixtures grouped by Spieltag" },
  match: { title: "Match Detail", subtitle: "Bayern München 3 : 2 Borussia Dortmund · Spieltag 33" },
  players: { title: "Players", subtitle: "On-pitch goal analysis across all scraped matches" },
  exports: { title: "Scrape & Export", subtitle: "Trigger runs and download reports" },
};

function loadUser() {
  try {
    const raw = localStorage.getItem("fms.user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [user, setUser] = useState(loadUser);
  const [view, setView] = useState("dashboard");

  const handleLogout = () => {
    localStorage.removeItem("fms.user");
    setUser(null);
    setView("dashboard");
  };

  if (!user) {
    return <Login onAuthed={(u) => setUser(u)} />;
  }

  const meta = META[view];

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      <Sidebar view={view} onChange={setView} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar title={meta.title} subtitle={meta.subtitle} user={user} onLogout={handleLogout} />
        <main className="flex-1 overflow-y-auto">
          {view === "dashboard" && <Dashboard onOpenMatchdays={() => setView("matchdays")} />}
          {view === "matchdays" && <Matchdays onOpenMatch={() => setView("match")} />}
          {view === "match" && <MatchDetail />}
          {view === "players" && <Players />}
          {view === "exports" && <Exports />}
        </main>
      </div>
    </div>
  );
}
