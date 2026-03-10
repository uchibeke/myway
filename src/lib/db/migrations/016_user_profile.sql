-- Workspace profile tables: DB-backed replacements for OpenClaw workspace files.
-- Merged on read: DB fields take precedence, workspace files fill gaps.

CREATE TABLE IF NOT EXISTS user_profile (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS ai_profile (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by TEXT NOT NULL DEFAULT 'user'
);
