-- Per-user APort passports — DB-backed passport storage for hosted/multi-tenant mode.
-- Each user can have one passport per app scope (default, forge, chat, etc.)
-- API keys are encrypted at rest (AES-256-GCM, key derived from MYWAY_SECRET via HKDF).
CREATE TABLE IF NOT EXISTS user_passports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id      TEXT    NOT NULL DEFAULT 'default',  -- 'default', 'forge', 'chat', etc.
  agent_id    TEXT    NOT NULL,                     -- APort agent ID (ap_xxxx)
  api_key_enc TEXT,                                  -- APort API key, encrypted (optional)
  label       TEXT,                                 -- Human-friendly label
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(app_id)
);
