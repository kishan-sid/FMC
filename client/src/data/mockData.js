// Bundesliga-style mock dataset for the Football Match Scrapper demo.
// All numbers are illustrative — real data will come from the scraper.

export const summary = {
  matchdaysScraped: 12,
  matchesScraped: 108,
  playersTracked: 642,
  eventsParsed: 4318,
  lastRun: "2026-05-15 22:41",
  successRate: 99.1,
};

export const matchdays = [
  { id: "md-30", label: "Spieltag 30", date: "2026-04-26", matches: 9, scraped: 9, status: "complete" },
  { id: "md-31", label: "Spieltag 31", date: "2026-05-03", matches: 9, scraped: 9, status: "complete" },
  { id: "md-32", label: "Spieltag 32", date: "2026-05-10", matches: 9, scraped: 9, status: "complete" },
  { id: "md-33", label: "Spieltag 33", date: "2026-05-17", matches: 9, scraped: 7, status: "running" },
  { id: "md-34", label: "Spieltag 34", date: "2026-05-24", matches: 9, scraped: 0, status: "queued" },
];

export const matches = [
  {
    id: "m-3301",
    matchday: "md-33",
    date: "2026-05-17 15:30",
    venue: "Allianz Arena, München",
    home: { code: "FCB", name: "Bayern München", color: "#dc0000", score: 3 },
    away: { code: "BVB", name: "Borussia Dortmund", color: "#fde100", score: 2 },
    status: "scraped",
    eventsCount: 14,
    competition: "Bundesliga",
  },
  {
    id: "m-3302",
    matchday: "md-33",
    date: "2026-05-17 15:30",
    venue: "Signal Iduna Park, Dortmund",
    home: { code: "B04", name: "Bayer Leverkusen", color: "#e32219", score: 2 },
    away: { code: "RBL", name: "RB Leipzig", color: "#dd0741", score: 2 },
    status: "scraped",
    eventsCount: 11,
    competition: "Bundesliga",
  },
  {
    id: "m-3303",
    matchday: "md-33",
    date: "2026-05-17 15:30",
    venue: "Volkswagen Arena, Wolfsburg",
    home: { code: "WOB", name: "VfL Wolfsburg", color: "#65b32e", score: 1 },
    away: { code: "SGE", name: "Eintracht Frankfurt", color: "#000000", score: 0 },
    status: "scraped",
    eventsCount: 9,
    competition: "Bundesliga",
  },
  {
    id: "m-3304",
    matchday: "md-33",
    date: "2026-05-17 15:30",
    venue: "BayArena, Leverkusen",
    home: { code: "SCF", name: "SC Freiburg", color: "#5b5b5b", score: 0 },
    away: { code: "VFB", name: "VfB Stuttgart", color: "#e30613", score: 3 },
    status: "scraped",
    eventsCount: 12,
    competition: "Bundesliga",
  },
  {
    id: "m-3305",
    matchday: "md-33",
    date: "2026-05-17 18:30",
    venue: "PreZero Arena, Sinsheim",
    home: { code: "TSG", name: "TSG Hoffenheim", color: "#1961b5" },
    away: { code: "M05", name: "Mainz 05", color: "#c8102e" },
    status: "running",
    competition: "Bundesliga",
  },
  {
    id: "m-3306",
    matchday: "md-33",
    date: "2026-05-17 18:30",
    venue: "Mercedes-Benz Arena, Stuttgart",
    home: { code: "BMG", name: "Borussia M'gladbach", color: "#000000" },
    away: { code: "FCA", name: "FC Augsburg", color: "#ba3733" },
    status: "running",
    competition: "Bundesliga",
  },
  {
    id: "m-3307",
    matchday: "md-33",
    date: "2026-05-18 15:30",
    venue: "Olympiastadion, Berlin",
    home: { code: "BSC", name: "Union Berlin", color: "#eb1923" },
    away: { code: "SVW", name: "Werder Bremen", color: "#1d9053" },
    status: "queued",
    competition: "Bundesliga",
  },
];

// Detailed match — the headline FCB vs BVB game
export const matchDetail = {
  id: "m-3301",
  date: "2026-05-17 15:30",
  venue: "Allianz Arena, München",
  competition: "Bundesliga · Spieltag 33",
  referee: "Felix Brych",
  attendance: 75024,
  home: { code: "FCB", name: "Bayern München", color: "#dc0000", score: 3, formation: "4-2-3-1" },
  away: { code: "BVB", name: "Borussia Dortmund", color: "#fde100", score: 2, formation: "4-3-3" },
  events: [
    { minute: 12, type: "goal", team: "home", player: "Harry Kane", assist: "Jamal Musiala", detail: "Right foot" },
    { minute: 23, type: "card", team: "away", player: "Emre Can", detail: "Yellow card" },
    { minute: 31, type: "goal", team: "away", player: "Karim Adeyemi", assist: "Julian Brandt", detail: "Counter attack" },
    { minute: 44, type: "goal", team: "home", player: "Leroy Sané", assist: "Joshua Kimmich", detail: "Free kick" },
    { minute: 45, type: "sub", team: "away", playerOff: "Emre Can", playerOn: "Felix Nmecha", detail: "Tactical" },
    { minute: 58, type: "goal", team: "away", player: "Niclas Füllkrug", assist: "Karim Adeyemi", detail: "Header" },
    { minute: 63, type: "sub", team: "home", playerOff: "Thomas Müller", playerOn: "Mathys Tel", detail: "Tactical" },
    { minute: 67, type: "card", team: "home", player: "Joshua Kimmich", detail: "Yellow card" },
    { minute: 72, type: "sub", team: "away", playerOff: "Julian Brandt", playerOn: "Marco Reus", detail: "Tactical" },
    { minute: 78, type: "goal", team: "home", player: "Jamal Musiala", assist: "Harry Kane", detail: "Inside the box" },
    { minute: 84, type: "sub", team: "home", playerOff: "Jamal Musiala", playerOn: "Serge Gnabry", detail: "Time wasting" },
    { minute: 85, type: "sub", team: "away", playerOff: "Karim Adeyemi", playerOn: "Donyell Malen", detail: "Tactical" },
    { minute: 88, type: "card", team: "away", player: "Mats Hummels", detail: "Yellow card" },
    { minute: 92, type: "card", team: "home", player: "Manuel Neuer", detail: "Yellow card · delay" },
  ],
  lineups: {
    home: {
      starters: [
        { num: 1, name: "Manuel Neuer", position: "GK", minutesOn: 0, minutesOff: 90, goalsFor: 3, goalsAgainst: 2 },
        { num: 5, name: "Min-jae Kim", position: "CB", minutesOn: 0, minutesOff: 90, goalsFor: 3, goalsAgainst: 2 },
        { num: 4, name: "Matthijs de Ligt", position: "CB", minutesOn: 0, minutesOff: 90, goalsFor: 3, goalsAgainst: 2 },
        { num: 2, name: "Dayot Upamecano", position: "RB", minutesOn: 0, minutesOff: 90, goalsFor: 3, goalsAgainst: 2 },
        { num: 19, name: "Alphonso Davies", position: "LB", minutesOn: 0, minutesOff: 90, goalsFor: 3, goalsAgainst: 2 },
        { num: 6, name: "Joshua Kimmich", position: "CM", minutesOn: 0, minutesOff: 90, goalsFor: 3, goalsAgainst: 2 },
        { num: 8, name: "Leon Goretzka", position: "CM", minutesOn: 0, minutesOff: 90, goalsFor: 3, goalsAgainst: 2 },
        { num: 10, name: "Leroy Sané", position: "RW", minutesOn: 0, minutesOff: 90, goalsFor: 3, goalsAgainst: 2 },
        { num: 42, name: "Jamal Musiala", position: "AM", minutesOn: 0, minutesOff: 84, goalsFor: 3, goalsAgainst: 2 },
        { num: 25, name: "Thomas Müller", position: "LW", minutesOn: 0, minutesOff: 63, goalsFor: 2, goalsAgainst: 1 },
        { num: 9, name: "Harry Kane", position: "ST", minutesOn: 0, minutesOff: 90, goalsFor: 3, goalsAgainst: 2 },
      ],
      bench: [
        { num: 39, name: "Mathys Tel", position: "FW", minutesOn: 63, minutesOff: 90, goalsFor: 1, goalsAgainst: 1 },
        { num: 7, name: "Serge Gnabry", position: "FW", minutesOn: 84, minutesOff: 90, goalsFor: 0, goalsAgainst: 0 },
      ],
    },
    away: {
      starters: [
        { num: 1, name: "Gregor Kobel", position: "GK", minutesOn: 0, minutesOff: 90, goalsFor: 2, goalsAgainst: 3 },
        { num: 15, name: "Mats Hummels", position: "CB", minutesOn: 0, minutesOff: 90, goalsFor: 2, goalsAgainst: 3 },
        { num: 25, name: "Niklas Süle", position: "CB", minutesOn: 0, minutesOff: 90, goalsFor: 2, goalsAgainst: 3 },
        { num: 26, name: "Julian Ryerson", position: "RB", minutesOn: 0, minutesOff: 90, goalsFor: 2, goalsAgainst: 3 },
        { num: 5, name: "Ramy Bensebaini", position: "LB", minutesOn: 0, minutesOff: 90, goalsFor: 2, goalsAgainst: 3 },
        { num: 23, name: "Emre Can", position: "DM", minutesOn: 0, minutesOff: 45, goalsFor: 1, goalsAgainst: 2 },
        { num: 8, name: "Felix Nmecha", position: "CM", minutesOn: 45, minutesOff: 90, goalsFor: 1, goalsAgainst: 1 },
        { num: 19, name: "Julian Brandt", position: "AM", minutesOn: 0, minutesOff: 72, goalsFor: 2, goalsAgainst: 2 },
        { num: 27, name: "Karim Adeyemi", position: "RW", minutesOn: 0, minutesOff: 85, goalsFor: 2, goalsAgainst: 2 },
        { num: 7, name: "Donyell Malen", position: "LW", minutesOn: 85, minutesOff: 90, goalsFor: 0, goalsAgainst: 1 },
        { num: 14, name: "Niclas Füllkrug", position: "ST", minutesOn: 0, minutesOff: 90, goalsFor: 2, goalsAgainst: 3 },
      ],
      bench: [
        { num: 11, name: "Marco Reus", position: "MF", minutesOn: 72, minutesOff: 90, goalsFor: 0, goalsAgainst: 1 },
      ],
    },
  },
};

export const playerOnPitchTable = [
  { id: "p1", name: "Harry Kane", team: "FCB", position: "ST", minutes: 90, goalsFor: 3, goalsAgainst: 2, diff: 1 },
  { id: "p2", name: "Joshua Kimmich", team: "FCB", position: "CM", minutes: 90, goalsFor: 3, goalsAgainst: 2, diff: 1 },
  { id: "p3", name: "Jamal Musiala", team: "FCB", position: "AM", minutes: 84, goalsFor: 3, goalsAgainst: 2, diff: 1 },
  { id: "p4", name: "Thomas Müller", team: "FCB", position: "LW", minutes: 63, goalsFor: 2, goalsAgainst: 1, diff: 1 },
  { id: "p5", name: "Mathys Tel", team: "FCB", position: "FW", minutes: 27, goalsFor: 1, goalsAgainst: 1, diff: 0 },
  { id: "p6", name: "Serge Gnabry", team: "FCB", position: "FW", minutes: 6, goalsFor: 0, goalsAgainst: 0, diff: 0 },
  { id: "p7", name: "Niclas Füllkrug", team: "BVB", position: "ST", minutes: 90, goalsFor: 2, goalsAgainst: 3, diff: -1 },
  { id: "p8", name: "Karim Adeyemi", team: "BVB", position: "RW", minutes: 85, goalsFor: 2, goalsAgainst: 2, diff: 0 },
  { id: "p9", name: "Emre Can", team: "BVB", position: "DM", minutes: 45, goalsFor: 1, goalsAgainst: 2, diff: -1 },
  { id: "p10", name: "Felix Nmecha", team: "BVB", position: "CM", minutes: 45, goalsFor: 1, goalsAgainst: 1, diff: 0 },
  { id: "p11", name: "Julian Brandt", team: "BVB", position: "AM", minutes: 72, goalsFor: 2, goalsAgainst: 2, diff: 0 },
  { id: "p12", name: "Marco Reus", team: "BVB", position: "MF", minutes: 18, goalsFor: 0, goalsAgainst: 1, diff: -1 },
  { id: "p13", name: "Leroy Sané", team: "FCB", position: "RW", minutes: 90, goalsFor: 3, goalsAgainst: 2, diff: 1 },
  { id: "p14", name: "Alphonso Davies", team: "FCB", position: "LB", minutes: 90, goalsFor: 3, goalsAgainst: 2, diff: 1 },
  { id: "p15", name: "Mats Hummels", team: "BVB", position: "CB", minutes: 90, goalsFor: 2, goalsAgainst: 3, diff: -1 },
];

export const activity = [
  { id: "a1", time: "2 min ago", text: "Scrape completed", detail: "Spieltag 33 · TSG 1899 Hoffenheim vs Mainz 05", tone: "success" },
  { id: "a2", time: "8 min ago", text: "Goal-matching engine ran", detail: "642 player intervals reconciled · 0 mismatches", tone: "info" },
  { id: "a3", time: "14 min ago", text: "Export generated", detail: "spieltag-33-bundesliga.xlsx · 1.8 MB", tone: "success" },
  { id: "a4", time: "31 min ago", text: "Retry triggered", detail: "Aufstellung tab failed once, recovered after 2.1s", tone: "warn" },
  { id: "a5", time: "1 h ago", text: "Spieltag 33 queued", detail: "9 matches scheduled for scraping", tone: "info" },
];

export const exports_ = [
  { id: "e1", file: "spieltag-33-bundesliga.xlsx", size: "1.8 MB", rows: 1287, format: "xlsx", at: "2026-05-15 22:41" },
  { id: "e2", file: "spieltag-32-bundesliga.csv", size: "412 KB", rows: 1180, format: "csv", at: "2026-05-08 19:12" },
  { id: "e3", file: "spieltag-31-bundesliga.xlsx", size: "1.7 MB", rows: 1199, format: "xlsx", at: "2026-05-01 21:03" },
  { id: "e4", file: "season-summary-2025-26.xlsx", size: "8.4 MB", rows: 12480, format: "xlsx", at: "2026-04-26 09:50" },
];

export const goalDistribution = [
  { half: "0-15", goals: 6 },
  { half: "16-30", goals: 9 },
  { half: "31-45", goals: 12 },
  { half: "46-60", goals: 11 },
  { half: "61-75", goals: 14 },
  { half: "76-90+", goals: 18 },
];

export const matchdayTrend = [
  { md: "MD 28", events: 312, matches: 9 },
  { md: "MD 29", events: 287, matches: 9 },
  { md: "MD 30", events: 341, matches: 9 },
  { md: "MD 31", events: 366, matches: 9 },
  { md: "MD 32", events: 354, matches: 9 },
  { md: "MD 33", events: 389, matches: 9 },
];
