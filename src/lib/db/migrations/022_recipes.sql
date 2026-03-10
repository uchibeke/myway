-- Recipes table — DB-backed storage for hosted mode.
-- Content is stored as-is (markdown with full formatting preserved).
CREATE TABLE IF NOT EXISTS recipes (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT 'Untitled Recipe',
  content    TEXT NOT NULL DEFAULT '',
  tags       TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  cook_time  TEXT,
  servings   TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_recipes_updated ON recipes(updated_at DESC) WHERE is_deleted = 0;
