-- APort guardrail events — synced from the audit log on demand.
-- Source of truth is always the audit.log file; this is a queryable cache.
CREATE TABLE IF NOT EXISTS guardrail_events (
  id          TEXT    PRIMARY KEY,               -- decision_id from APort
  timestamp   INTEGER NOT NULL,                  -- unix epoch seconds
  tool        TEXT    NOT NULL,                  -- e.g. "system.command.execute"
  allowed     INTEGER NOT NULL DEFAULT 1,        -- 1 = allowed, 0 = blocked
  policy      TEXT    NOT NULL DEFAULT '',       -- e.g. "system.command.execute.v1"
  code        TEXT    NOT NULL DEFAULT '',       -- e.g. "oap.allowed" | "oap.denied"
  context     TEXT    NOT NULL DEFAULT '',       -- truncated command / context string
  synced_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_guardrail_events_timestamp ON guardrail_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_guardrail_events_allowed   ON guardrail_events (allowed);
CREATE INDEX IF NOT EXISTS idx_guardrail_events_tool      ON guardrail_events (tool);
