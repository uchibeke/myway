-- Migration 002 — notifications + tasks
-- Notifications: structured app-to-user messages with lifecycle status
-- Tasks: autonomous, AI-enriched action items that cross-feed apps

-- ─── Notifications ────────────────────────────────────────────────────────────
-- Created by apps (via heartbeat or direct API call) and displayed on the home screen.
-- status tracks the full lifecycle: pending → shown → dismissed / expired
CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT    PRIMARY KEY,
  app_id       TEXT    NOT NULL,
  title        TEXT    NOT NULL,          -- short headline (≤80 chars)
  body         TEXT    NOT NULL,          -- full message content
  type         TEXT    NOT NULL DEFAULT 'info'
               CHECK(type IN ('info','success','alert','brief')),
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','shown','dismissed','expired')),
  priority     INTEGER NOT NULL DEFAULT 5,  -- 1=highest, 10=lowest
  action_url   TEXT,                        -- deeplink to open on tap
  expires_at   INTEGER,                     -- unix epoch; NULL = never expires
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  shown_at     INTEGER,
  dismissed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notif_pending
  ON notifications(priority ASC, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notif_app
  ON notifications(app_id, created_at DESC);

-- ─── Tasks ────────────────────────────────────────────────────────────────────
-- Autonomous, AI-enriched action items. Source: manual, chat, brief, heartbeat, or any app.
-- context JSON: { when, where, why_it_matters, subtasks: [], implementation_intention }
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT    PRIMARY KEY,
  app_id          TEXT    NOT NULL,         -- origin app
  conversation_id TEXT,                     -- source conversation (if any)
  title           TEXT    NOT NULL,
  description     TEXT,                     -- AI-enriched detail
  status          TEXT    NOT NULL DEFAULT 'open'
                  CHECK(status IN ('open','in_progress','done','skipped','archived')),
  priority        INTEGER NOT NULL DEFAULT 5,
  due_at          INTEGER,                  -- unix epoch
  completed_at    INTEGER,
  context         TEXT    NOT NULL DEFAULT '{}',
                  -- JSON: { when, where, why_it_matters, subtasks, implementation_intention }
  source          TEXT    NOT NULL DEFAULT 'manual'
                  CHECK(source IN ('manual','chat','brief','heartbeat','mise','tasks','system')),
  streak_count    INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  is_deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tasks_open
  ON tasks(priority ASC, due_at ASC, created_at ASC)
  WHERE status = 'open' AND is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_tasks_app
  ON tasks(app_id, created_at DESC)
  WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_tasks_due
  ON tasks(due_at ASC)
  WHERE status = 'open' AND due_at IS NOT NULL AND is_deleted = 0;
