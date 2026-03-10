-- Dynamic app registry — stores app configs and skill prompts for platform-registered apps.
-- Static apps in src/lib/apps.ts take priority; dynamic apps are a DB fallback.

CREATE TABLE IF NOT EXISTS dynamic_apps (
  id           TEXT PRIMARY KEY,
  config       TEXT NOT NULL,       -- JSON: full MywayApp config object
  skill_prompt TEXT,                -- SKILL.md content (null = use filesystem fallback)
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  is_deleted   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_dynamic_apps_live
  ON dynamic_apps(is_deleted) WHERE is_deleted = 0;
