import { Router } from "express";
import jwt from "jsonwebtoken";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || "football-scrapper-dev-secret-change-me";
const TOKEN_TTL = "12h";

// Demo users — for production replace with DB + bcrypt password hashes.
const USERS = [
  { id: "u1", email: "admin@football.com", password: "admin123", name: "Admin", role: "admin", initials: "AD" },
  { id: "u2", email: "analyst@football.com", password: "analyst123", name: "Match Analyst", role: "analyst", initials: "MA" },
];

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const user = USERS.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
  const { password: _pw, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

router.get("/me", requireAuth, (req, res) => {
  const user = USERS.find((u) => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: "User not found" });
  const { password: _pw, ...safeUser } = user;
  res.json({ user: safeUser });
});

export default router;
