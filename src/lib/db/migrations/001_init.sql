-- Migration 001 — initial schema
-- All tables use INTEGER unix-epoch timestamps (faster than TEXT for range queries).
-- Soft deletes only: is_deleted = 1, never DELETE.
-- Vec tables (vec_messages, vec_memories) are created separately in index.ts
-- because they require a runtime-configurable EMBEDDING_DIM parameter.

-- ─── Identity ────────────────────────────────────────────────────────────────
-- User profile and learned signals, shared across all apps.
-- Seeded by db:init with name/timezone; updated by any app as it learns.
CREATE TABLE IF NOT EXISTS identity (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_by TEXT    NOT NULL DEFAULT 'system',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── Apps ────────────────────────────────────────────────────────────────────
-- Mirrors apps.ts at runtime. Seeded by db:init from the registry.
-- storage_manifest documents what each app persists and which events it handles.
CREATE TABLE IF NOT EXISTS apps (
  id               TEXT    PRIMARY KEY,
  name             TEXT    NOT NULL,
  storage_manifest TEXT    NOT NULL DEFAULT '{}', -- JSON: {conversations,memory,artifacts,emits,subscribes}
  registered_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── Conversations ───────────────────────────────────────────────────────────
-- Session-level grouping. One conversation = one UI session in an app.
-- Persists across restarts; enables cross-session memory.
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT    PRIMARY KEY,
  app_id          TEXT    NOT NULL REFERENCES apps(id),
  title           TEXT,                        -- auto-generated after first exchange
  context         TEXT    NOT NULL DEFAULT '{}', -- JSON: {mode, quickAction, input, ...}
  message_count   INTEGER NOT NULL DEFAULT 0,
  started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  last_message_at INTEGER,
  is_deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conv_app
  ON conversations(app_id, started_at DESC)
  WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_conv_recent
  ON conversations(last_message_at DESC)
  WHERE is_deleted = 0;

-- ─── Messages ────────────────────────────────────────────────────────────────
-- Individual messages within a conversation.
-- role = 'app' marks inter-app autonomous messages (the core bus feature).
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT    PRIMARY KEY,
  conversation_id TEXT    NOT NULL REFERENCES conversations(id),
  app_id          TEXT    NOT NULL,
  role            TEXT    NOT NULL CHECK(role IN ('system','user','assistant','app')),
  content         TEXT    NOT NULL,
  source_app      TEXT,            -- set when role='app'; the originating app id
  metadata        TEXT    NOT NULL DEFAULT '{}', -- JSON: {tokens, model, latency_ms}
  embedding_id    TEXT,            -- FK to vec_messages.message_id (set after embedding)
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  is_deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_msg_conv
  ON messages(conversation_id, created_at ASC)
  WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_msg_app
  ON messages(app_id, created_at DESC)
  WHERE is_deleted = 0;

-- ─── Memories ────────────────────────────────────────────────────────────────
-- Long-term facts, preferences, and events persisted beyond sessions.
-- app_id = NULL means global (shared by all apps) — builds shared personality.
CREATE TABLE IF NOT EXISTS memories (
  id           TEXT    PRIMARY KEY,
  app_id       TEXT,   -- NULL = global
  type         TEXT    NOT NULL CHECK(type IN (
                 'preference','fact','event','personality',
                 'skill_event','chat_summary','artifact_ref'
               )),
  content      TEXT    NOT NULL,
  metadata     TEXT    NOT NULL DEFAULT '{}', -- JSON: arbitrary app-specific data
  embedding_id TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  is_deleted   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mem_app
  ON memories(app_id, type, created_at DESC)
  WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_mem_global
  ON memories(type, created_at DESC)
  WHERE app_id IS NULL AND is_deleted = 0;

-- ─── Artifacts ───────────────────────────────────────────────────────────────
-- Metadata for files stored on disk. File path = relative to ARTIFACTS_DIR.
-- Content-addressed by SHA-256 hash: overwrite is structurally impossible.
CREATE TABLE IF NOT EXISTS artifacts (
  id              TEXT    PRIMARY KEY,
  app_id          TEXT    NOT NULL,
  conversation_id TEXT    REFERENCES conversations(id),
  original_name   TEXT    NOT NULL,
  file_path       TEXT    NOT NULL, -- relative to MYWAY_DATA_DIR/artifacts/
  file_hash       TEXT    NOT NULL, -- SHA-256; unique enforces content-addressing
  mime_type       TEXT,
  size_bytes      INTEGER,
  metadata        TEXT    NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  is_deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_hash
  ON artifacts(file_hash)
  WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_artifact_app
  ON artifacts(app_id, created_at DESC)
  WHERE is_deleted = 0;

-- ─── App Message Bus ─────────────────────────────────────────────────────────
-- Inter-app autonomous communication. This is the core feature that lets apps
-- share signals and react to each other without user input.
--
-- Flow: App A publishes event → bus.publish() fans out to subscribers →
--       Heartbeat calls bus.getPending(appId) for each app →
--       App B receives and acts on the message → bus.markDelivered()
CREATE TABLE IF NOT EXISTS app_messages (
  id           TEXT    PRIMARY KEY,
  from_app     TEXT    NOT NULL, -- source app id, 'system', or 'heartbeat'
  to_app       TEXT    NOT NULL, -- target app id (already fanned-out at publish time)
  type         TEXT    NOT NULL CHECK(type IN ('event','request','response','notification')),
  subject      TEXT    NOT NULL, -- e.g. 'user.shipped', 'recipe.saved', 'user.burnout'
  payload      TEXT    NOT NULL DEFAULT '{}', -- JSON
  status       TEXT    NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','processing','delivered','failed')),
  priority     INTEGER NOT NULL DEFAULT 5, -- 1=highest, 10=lowest
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  processed_at INTEGER,
  expires_at   INTEGER -- unix epoch; NULL = never expires
);

CREATE INDEX IF NOT EXISTS idx_bus_pending
  ON app_messages(to_app, priority ASC, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_bus_subject
  ON app_messages(subject, status, created_at DESC);

-- ─── App Subscriptions ───────────────────────────────────────────────────────
-- Which apps want to receive which event subjects.
-- subject_pattern supports exact match ('user.shipped') or prefix wildcard ('user.*').
-- handler: 'heartbeat' = processed next heartbeat; 'immediate' = synchronous delivery.
CREATE TABLE IF NOT EXISTS app_subscriptions (
  id              TEXT    PRIMARY KEY,
  app_id          TEXT    NOT NULL,
  subject_pattern TEXT    NOT NULL,
  handler         TEXT    NOT NULL DEFAULT 'heartbeat'
                  CHECK(handler IN ('heartbeat','immediate','next_session')),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_unique
  ON app_subscriptions(app_id, subject_pattern);

-- ─── Personality State ───────────────────────────────────────────────────────
-- Mutable, shared user model. Any app can read or write.
-- This is how apps build a coherent picture of the user over time:
-- the Familiar writes 'user.mood'; Morning Brief reads it; they share context.
-- confidence: 0.0–1.0, degrades over time for inferred signals.
CREATE TABLE IF NOT EXISTS personality_state (
  key        TEXT    PRIMARY KEY,  -- e.g. 'user.mood', 'user.last_shipped', 'user.streak'
  value      TEXT    NOT NULL,
  confidence REAL    NOT NULL DEFAULT 1.0,
  updated_by TEXT    NOT NULL DEFAULT 'system',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── Schema Migrations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT    PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);
