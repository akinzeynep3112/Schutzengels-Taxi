const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !SESSION_SECRET || !DATABASE_URL) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slots (
      slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 7),
      name TEXT NOT NULL DEFAULT '',
      remaining_seconds INTEGER NOT NULL DEFAULT 0 CHECK (remaining_seconds >= 0)
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      globally_running BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);
  await pool.query(`ALTER TABLE slots ADD COLUMN IF NOT EXISTS running_since BIGINT;`);
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS globally_running BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`
    INSERT INTO settings (id, globally_running) VALUES (1, FALSE)
      ON CONFLICT (id) DO NOTHING;
  `);
  for (let i = 1; i <= 7; i++) {
    await pool.query("INSERT INTO slots (slot) VALUES ($1) ON CONFLICT (slot) DO NOTHING", [i]);
  }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new pgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  name: "taxii_admin",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));
app.use("/api/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

async function getStatus() {
  await pool.query(`
    INSERT INTO settings (id, globally_running) VALUES (1, FALSE)
      ON CONFLICT (id) DO NOTHING;
  `);
  const settingsResult = await pool.query("SELECT globally_running FROM settings WHERE id=1");
  const globallyRunning = Boolean(settingsResult.rows[0]?.globally_running);
  const now = Math.floor(Date.now() / 1000);
  const result = await pool.query("SELECT slot, name, remaining_seconds, running_since FROM slots ORDER BY slot");
  const slots = result.rows.map(s => {
    let remaining = Number(s.remaining_seconds);
    if (globallyRunning && s.running_since !== null) {
      remaining = Math.max(0, remaining - (now - Number(s.running_since)));
    }
    return { slot: Number(s.slot), name: s.name, remainingSeconds: remaining };
  });
  return { title: "Schutzengels Taxii", running: globallyRunning, slots, serverTime: now };
}

function requireAdmin(req, res, next) {
  if (!req.session || req.session.isAdmin !== true) return res.status(401).json({ error: "Nicht angemeldet" });
  next();
}

app.use(express.static(__dirname));

app.get("/api/status", async (_req, res) => {
  try { res.json(await getStatus()); }
  catch (err) { console.error("Status error:", err); res.status(500).json({ error: "Status konnte nicht geladen werden" }); }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Benutzername oder Passwort falsch" });
    }
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: "Anmeldung fehlgeschlagen" });
      req.session.isAdmin = true;
      req.session.save(saveErr => {
        if (saveErr) return res.status(500).json({ error: "Sitzung konnte nicht gespeichert werden" });
        res.json({ ok: true });
      });
    });
  } catch (err) { console.error("Login error:", err); res.status(500).json({ error: "Anmeldung fehlgeschlagen" }); }
});

app.post("/api/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.put("/api/slots/:slot", requireAdmin, async (req, res) => {
  const slot = Number(req.params.slot);
  const { name, remainingSeconds } = req.body || {};
  if (!Number.isInteger(slot) || slot < 1 || slot > 7 ||
      typeof name !== "string" || name.length > 40 ||
      !Number.isInteger(remainingSeconds) || remainingSeconds < 0 || remainingSeconds > 31536000) {
    return res.status(400).json({ error: "Ungültige Eingabe" });
  }
  try {
    await pool.query(`
      INSERT INTO settings (id, globally_running) VALUES (1, FALSE)
        ON CONFLICT (id) DO NOTHING;
    `);
    const settings = await pool.query("SELECT globally_running FROM settings WHERE id=1");
    const runningSince = settings.rows[0].globally_running && remainingSeconds > 0 ? Math.floor(Date.now() / 1000) : null;
    await pool.query("UPDATE slots SET name=$1, remaining_seconds=$2, running_since=$3 WHERE slot=$4", [name.trim(), remainingSeconds, runningSince, slot]);
    res.json(await getStatus());
  } catch (err) { console.error("Slot update error:", err); res.status(500).json({ error: "Timer konnte nicht gespeichert werden" }); }
});

app.post("/api/toggle", requireAdmin, async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO settings (id, globally_running) VALUES (1, FALSE)
        ON CONFLICT (id) DO NOTHING;
    `);
    const settings = await client.query("SELECT globally_running FROM settings WHERE id=1 FOR UPDATE");
    const current = Boolean(settings.rows[0]?.globally_running);
    const now = Math.floor(Date.now() / 1000);
    if (current) {
      const slots = await client.query("SELECT slot, remaining_seconds, running_since FROM slots FOR UPDATE");
      for (const s of slots.rows) {
        const remaining = s.running_since === null ? Number(s.remaining_seconds) : Math.max(0, Number(s.remaining_seconds) - (now - Number(s.running_since)));
        await client.query("UPDATE slots SET remaining_seconds=$1, running_since=NULL WHERE slot=$2", [remaining, s.slot]);
      }
      await client.query("UPDATE settings SET globally_running=FALSE WHERE id=1");
    } else {
      await client.query("UPDATE slots SET running_since=CASE WHEN remaining_seconds > 0 THEN $1 ELSE NULL END", [now]);
      await client.query("UPDATE settings SET globally_running=TRUE WHERE id=1");
    }
    await client.query("COMMIT");
    res.json(await getStatus());
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Toggle error:", err);
    res.status(500).json({ error: "Timer konnte nicht gestartet/pausiert werden" });
  } finally { client.release(); }
});

app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

initializeDatabase().then(() => {
  app.listen(PORT, () => console.log(`Schutzengels Taxii running on port ${PORT}`));
}).catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});

process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
