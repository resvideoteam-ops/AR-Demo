-- Usage analytics. Deliberately holds no personal data: no IP addresses, no
-- user agent strings, no cookies. session_id is a random value the browser
-- generates per visit and forgets on close.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event       TEXT    NOT NULL,
  session_id  TEXT    NOT NULL,
  model       TEXT,
  device      TEXT,
  country     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at);
CREATE INDEX IF NOT EXISTS idx_events_event   ON events (event);
CREATE INDEX IF NOT EXISTS idx_events_session ON events (session_id);

-- Which uploaded model the AR page should serve. One row, id = 1.
CREATE TABLE IF NOT EXISTS settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  active_model  TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (id, active_model) VALUES (1, NULL);
