import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import matchesRouter from "./routes/matches.js";
import authRouter from "./routes/auth.js";
import scrapeRouter from "./routes/scrape.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "football-match-scrapper", time: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/matches", matchesRouter);
app.use("/api/scrape", scrapeRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
