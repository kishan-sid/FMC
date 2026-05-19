// Vercel serverless function — POST /api/auth/login
// Runs in Node.js runtime on Vercel. No external deps.

const USERS = [
  { id: "u1", email: "admin@football.com",   password: "admin123",   name: "Admin",         role: "admin",   initials: "AD" },
  { id: "u2", email: "analyst@football.com", password: "analyst123", name: "Match Analyst", role: "analyst", initials: "MA" },
];

function makeToken(userId) {
  // Opaque token — fine for a demo. Replace with real JWT when wiring a DB.
  const payload = `${userId}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  return Buffer.from(payload).toString("base64url");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Vercel auto-parses JSON bodies when Content-Type is application/json.
  // If a client sends a raw string (e.g. some fetch configs), fall back to manual parse.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { email, password } = body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = USERS.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const { password: _pw, ...safeUser } = user;
  return res.status(200).json({
    token: makeToken(user.id),
    user: safeUser,
  });
};
