PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- There is exactly one of these. The app has a single administrator by design,
-- so there is no role column and nothing to escalate to.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS signatures (
  id           TEXT PRIMARY KEY,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  created_at   TEXT NOT NULL,

  -- The finished transparent PNG, already smoothed and trimmed.
  png_path     TEXT NOT NULL,
  png_width    INTEGER NOT NULL,
  png_height   INTEGER NOT NULL,
  png_bytes    INTEGER NOT NULL,

  -- The raw captured points, as JSON. Kept so a signature can be redrawn later
  -- at a different size, colour or smoothing without asking the person back.
  -- It is also the only record of how the signature was actually made.
  strokes_path TEXT,

  -- What the capture looked like, for spotting junk at a glance.
  stroke_count INTEGER,
  point_count  INTEGER,
  duration_ms  INTEGER,

  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_signatures_time ON signatures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signatures_name ON signatures(last_name COLLATE NOCASE, first_name COLLATE NOCASE);

-- Feeds the per-IP rate limit. Rows older than the window are swept on write,
-- so this never grows without bound.
CREATE TABLE IF NOT EXISTS capture_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_ip ON capture_attempts(ip, created_at);
