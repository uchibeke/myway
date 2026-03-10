-- Built-in cron scheduler tables.
-- Replaces OpenClaw's cron/jobs.json for non-OpenClaw users.
-- OpenClaw users can also use this as a fallback or parallel scheduler.

CREATE TABLE IF NOT EXISTS cron_jobs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  message     TEXT NOT NULL,
  -- 'cron' = 5-field expression, 'every' = interval like "30m", 'at' = one-shot ISO/relative
  schedule_type  TEXT NOT NULL CHECK(schedule_type IN ('cron', 'every', 'at')),
  schedule_value TEXT NOT NULL,
  tz          TEXT NOT NULL DEFAULT 'UTC',
  enabled     INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER,          -- epoch seconds, indexed for fast polling
  last_run_at INTEGER,
  -- Delivery
  channel     TEXT,             -- 'telegram', 'email', etc.
  delivery_to TEXT,             -- target address/chat ID
  -- System jobs (heartbeat, etc.) — cannot be deleted by user
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_due
  ON cron_jobs(next_run_at) WHERE enabled = 1;

CREATE TABLE IF NOT EXISTS cron_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'running',  -- running, success, error, timeout
  summary     TEXT,
  error       TEXT,
  duration_ms INTEGER,
  started_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job
  ON cron_runs(job_id, started_at);
