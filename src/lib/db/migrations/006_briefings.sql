-- Briefings — structured daily/weekly briefing archive.
--
-- Every briefing sent via send-email.mjs is persisted here with its full
-- structured sections data. Enables:
--   - Historical lookup ("what was in Monday's morning brief?")
--   - Weekly/monthly rollups from structured sections
--   - Dedup (prevent duplicate briefs per type per day)
--   - Dashboard / UI display of past briefings

CREATE TABLE IF NOT EXISTS briefings (
  id              TEXT    PRIMARY KEY,
  type            TEXT    NOT NULL CHECK(type IN ('morning', 'evening', 'weekly', 'update')),
  subject         TEXT    NOT NULL,
  greeting        TEXT,
  date_label      TEXT,
  sections        TEXT    NOT NULL DEFAULT '[]',   -- JSON: BriefingSection[]
  signoff         TEXT,
  sent_to         TEXT    NOT NULL,
  external_id     TEXT,                            -- Gmail message ID
  metadata        TEXT    NOT NULL DEFAULT '{}',
  is_deleted      INTEGER NOT NULL DEFAULT 0,
  sent_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_briefings_type_sent
  ON briefings(type, sent_at DESC) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_briefings_sent_at
  ON briefings(sent_at DESC) WHERE is_deleted = 0;
