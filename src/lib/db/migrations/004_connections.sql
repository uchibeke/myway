-- Migration 004 — connections
-- Bidirectional data bridges between Myway and external services.
-- Tables: connections (auth state), connection_tokens (encrypted OAuth),
--         connection_data (synced emails/events), connection_actions (pending writes)

-- ─── Connections ──────────────────────────────────────────────────────────────
-- Installed connections with auth state and sync position.
CREATE TABLE IF NOT EXISTS connections (
  id           TEXT    PRIMARY KEY,
  provider     TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'disconnected'
               CHECK(status IN ('connected','disconnected','error','syncing')),
  connected_at INTEGER,
  last_sync_at INTEGER,
  sync_cursor  TEXT,
  error        TEXT,
  config       TEXT    NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── Connection Tokens ───────────────────────────────────────────────────────
-- Encrypted OAuth tokens (one per connection).
CREATE TABLE IF NOT EXISTS connection_tokens (
  connection_id TEXT    PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
  access_token  TEXT    NOT NULL,
  refresh_token TEXT,
  token_type    TEXT    DEFAULT 'Bearer',
  expires_at    INTEGER,
  scopes        TEXT,
  raw           TEXT,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── Connection Data ─────────────────────────────────────────────────────────
-- Generic store for all synced external data (emails, events, etc.).
CREATE TABLE IF NOT EXISTS connection_data (
  id             TEXT    PRIMARY KEY,
  connection_id  TEXT    NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  data_type      TEXT    NOT NULL,
  title          TEXT,
  summary        TEXT,
  content        TEXT,
  metadata       TEXT    NOT NULL DEFAULT '{}',
  external_url   TEXT,
  occurred_at    INTEGER,
  synced_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  is_read        INTEGER NOT NULL DEFAULT 0,
  is_actionable  INTEGER NOT NULL DEFAULT 0,
  action_status  TEXT    NOT NULL DEFAULT 'pending'
                 CHECK(action_status IN ('pending','drafted','sent','dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_conndata_type
  ON connection_data(data_type);

CREATE INDEX IF NOT EXISTS idx_conndata_conn
  ON connection_data(connection_id);

CREATE INDEX IF NOT EXISTS idx_conndata_actionable
  ON connection_data(is_actionable)
  WHERE is_actionable = 1;

CREATE INDEX IF NOT EXISTS idx_conndata_occurred
  ON connection_data(occurred_at);

-- ─── Connection Actions ──────────────────────────────────────────────────────
-- Pending write actions (drafts, events) awaiting approval.
CREATE TABLE IF NOT EXISTS connection_actions (
  id              TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  connection_id   TEXT    NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  action_type     TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','approved','executed','rejected','failed')),
  payload         TEXT    NOT NULL,
  source_data_id  TEXT,
  source_app_id   TEXT,
  conversation_id TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  executed_at     INTEGER,
  error           TEXT
);
