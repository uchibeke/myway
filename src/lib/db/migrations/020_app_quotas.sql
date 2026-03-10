-- Migration 020: App quota cache + usage sync tracking
-- Caches AppRoom quota state locally for fast pre-chat checks.
-- Synced from AppRoom periodically; authoritative source is always AppRoom.

CREATE TABLE IF NOT EXISTS app_quota_cache (
  app_id        TEXT NOT NULL,
  outcome_id    TEXT NOT NULL,
  quota         INTEGER NOT NULL DEFAULT 0,
  used          INTEGER NOT NULL DEFAULT 0,
  additional    INTEGER NOT NULL DEFAULT 0,
  period_start  TEXT,
  period_end    TEXT,
  synced_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (app_id, outcome_id)
);

-- Usage sync state
CREATE TABLE IF NOT EXISTS usage_sync_state (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
