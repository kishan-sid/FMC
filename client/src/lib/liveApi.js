// Client for the server's API-Football proxy (/api/live/*).
// The browser never sees the API key — the Express server holds it.

async function getJSON(path) {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export const liveApi = {
  status: () => getJSON("/api/live/status"),
  liveMatches: () => getJSON("/api/live/matches"),
  byDate: (date) => getJSON(`/api/live/by-date${date ? `?date=${date}` : ""}`),
  fixture: (id) => getJSON(`/api/live/fixture/${id}`),
};

const LIVE = new Set(["1H", "2H", "ET", "BT", "P", "LIVE", "HT"]);
export const isLiveStatus = (s) => LIVE.has(s);

// Short label for a fixture's status / clock.
export function statusLabel(m) {
  if (m.status === "HT") return "HT";
  if (LIVE.has(m.status)) return m.elapsed != null ? `${m.elapsed}'` : "LIVE";
  if (m.status === "FT" || m.status === "AET" || m.status === "PEN") return "FT";
  if (m.status === "NS") return m.date ? new Date(m.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  return m.status;
}
