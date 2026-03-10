-- Influence posts: social media content calendar and queue
CREATE TABLE IF NOT EXISTS influence_posts (
  id             TEXT    PRIMARY KEY,
  platform       TEXT    NOT NULL,                    -- 'x', 'reddit', 'tiktok'
  account        TEXT    NOT NULL,                    -- '@handle', 'u/username'
  integration_id TEXT    NOT NULL,                    -- Postiz integration ID
  content        TEXT    NOT NULL,                    -- post body
  topic          TEXT,                                -- source topic/angle
  status         TEXT    NOT NULL DEFAULT 'draft',    -- draft|approved|scheduled|posted|rejected
  scheduled_at   INTEGER,                             -- Unix timestamp (ET)
  posted_at      INTEGER,                             -- Unix timestamp when posted
  postiz_id      TEXT,                                -- Postiz post ID after scheduling
  tags           TEXT    NOT NULL DEFAULT '[]',       -- JSON array of strings
  notes          TEXT,                                -- reviewer notes
  is_deleted     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_influence_posts_status       ON influence_posts(status);
CREATE INDEX IF NOT EXISTS idx_influence_posts_platform     ON influence_posts(platform);
CREATE INDEX IF NOT EXISTS idx_influence_posts_scheduled_at ON influence_posts(scheduled_at);
