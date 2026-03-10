-- Migration 005 — sync_pairs
-- Bidirectional calendar sync: tracks last-synced snapshot of shared fields
-- between Myway tasks and Google Calendar events for three-way merge.

CREATE TABLE IF NOT EXISTS sync_pairs (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL,
  calendar_event_id   TEXT NOT NULL,
  connection_id       TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  last_title          TEXT,
  last_description    TEXT,
  last_due_at         INTEGER,
  last_location       TEXT,
  last_pushed_at      INTEGER,
  last_pulled_at      INTEGER,
  google_updated      TEXT,      -- event.updated RFC3339
  task_updated_at     INTEGER,   -- task.updatedAt at last sync
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_pairs_task
  ON sync_pairs(task_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_pairs_event
  ON sync_pairs(calendar_event_id);
