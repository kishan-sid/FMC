// node scripts/seed_demo_data.js  [user_email]
// Re-seeds Bayern 3-2 Dortmund demo data under EVERY auth user so that
// `generate-export` returns a non-empty CSV regardless of who's logged in.
//
// Idempotent — upserts matchdays and matches; deletes-then-inserts lineups
// to avoid duplicate-key collisions.
//
// Reads server/.env relative to the repo root.

const fs = require("node:fs");
const path = require("node:path");

const envPath = path.resolve(__dirname, "../../server/.env");
const env = fs.readFileSync(envPath, "utf8").split("\n").reduce((a, l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) a[m[1]] = m[2]; return a;
}, {});

const { createClient } = require(path.resolve(__dirname, "../../client/node_modules/@supabase/supabase-js"));
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const HOME_STARTERS = [
  [1,"Manuel Neuer","GK",0,90], [5,"Min-jae Kim","CB",0,90], [4,"Matthijs de Ligt","CB",0,90],
  [2,"Dayot Upamecano","RB",0,90], [19,"Alphonso Davies","LB",0,90], [6,"Joshua Kimmich","CM",0,90],
  [8,"Leon Goretzka","CM",0,90], [10,"Leroy Sané","RW",0,90], [42,"Jamal Musiala","AM",0,84],
  [25,"Thomas Müller","LW",0,63], [9,"Harry Kane","ST",0,90],
];
const HOME_BENCH    = [[39,"Mathys Tel","FW",63,90], [7,"Serge Gnabry","FW",84,90]];
const AWAY_STARTERS = [
  [1,"Gregor Kobel","GK",0,90], [15,"Mats Hummels","CB",0,90], [25,"Niklas Süle","CB",0,90],
  [26,"Julian Ryerson","RB",0,90], [5,"Ramy Bensebaini","LB",0,90], [23,"Emre Can","DM",0,45],
  [8,"Felix Nmecha","CM",45,90], [19,"Julian Brandt","AM",0,72], [27,"Karim Adeyemi","RW",0,85],
  [7,"Donyell Malen","LW",85,90], [14,"Niclas Füllkrug","ST",0,90],
];
const AWAY_BENCH    = [[11,"Marco Reus","MF",72,90]];

function lineupRow(userId, team, role, [num, name, pos, on, off]) {
  const teamScore = team === "home" ? 3 : 2;
  const oppScore  = team === "home" ? 2 : 3;
  const ratio = Math.max(off - on, 0) / 90;
  return {
    user_id: userId, match_id: "m-3301", team, role,
    shirt_num: num, player_name: name, position: pos,
    minutes_on: on, minutes_off: off,
    goals_for: Math.round(teamScore * ratio),
    goals_against: Math.round(oppScore * ratio),
  };
}

(async () => {
  const requestedEmail = process.argv[2];

  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?per_page=50`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const users = ((await r.json()).users || []).filter(u =>
    !requestedEmail || u.email === requestedEmail
  );
  if (users.length === 0) { console.error("No matching users."); process.exit(1); }
  console.log("Seeding for users:", users.map(u => u.email).join(", "));

  // The first user owns the match + lineups (matches.id is unique globally).
  const owner = users[0];

  // Each user gets their own matchday row (matchday.id is shared but user_id varies via RLS).
  for (const u of users) {
    await admin.from("matchdays").upsert({
      id: "md-33", user_id: u.id, label: "Spieltag 33", date: "2026-05-17",
      matches: 1, scraped: 1, status: "complete", competition: "Bundesliga",
    }, { onConflict: "id" });
  }

  await admin.from("matches").upsert({
    id: "m-3301", user_id: owner.id, matchday_id: "md-33",
    kickoff: "2026-05-17T13:30:00Z", venue: "Allianz Arena, München",
    competition: "Bundesliga", status: "scraped", events_count: 14,
    referee: "Felix Brych", attendance: 75024,
    home_code: "FCB", home_name: "Bayern München",  home_color: "#dc0000", home_score: 3, home_formation: "4-2-3-1",
    away_code: "BVB", away_name: "Borussia Dortmund", away_color: "#fde100", away_score: 2, away_formation: "4-3-3",
  }, { onConflict: "id" });

  // Wipe and re-insert lineups for clean state
  await admin.from("match_lineups").delete().eq("match_id", "m-3301");

  // Lineup ownership = the same owner so generate-export filtered by user_id works
  const rows = [
    ...HOME_STARTERS.map(p => lineupRow(owner.id, "home", "starter", p)),
    ...HOME_BENCH   .map(p => lineupRow(owner.id, "home", "bench",   p)),
    ...AWAY_STARTERS.map(p => lineupRow(owner.id, "away", "starter", p)),
    ...AWAY_BENCH   .map(p => lineupRow(owner.id, "away", "bench",   p)),
  ];
  const { error: insErr } = await admin.from("match_lineups").insert(rows);
  if (insErr) { console.error("lineup insert failed:", insErr.message); process.exit(1); }

  const { count } = await admin.from("match_lineups").select("*", { count: "exact", head: true }).eq("match_id", "m-3301");
  console.log(`Seed complete — m-3301 owned by ${owner.email} · ${count} lineup rows.`);
})();
