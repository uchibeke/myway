-- Hunter Pipeline — pipeline run history + evaluated properties.
--
-- pipeline_runs  — one row per batch run (province scan)
-- hunter_properties — each property evaluated in a run
--
-- The Node scheduler writes here after each batch.
-- The Myway Hunter App reads from here for the UI.

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id              TEXT    PRIMARY KEY,
  source_id       TEXT    NOT NULL,               -- e.g. 'ns-tax-sales'
  province        TEXT    NOT NULL,               -- e.g. 'NS'
  municipality    TEXT,                           -- optional filter
  status          TEXT    NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','running','completed','failed','cancelled')),
  started_at      INTEGER,
  completed_at    INTEGER,
  total_listings  INTEGER NOT NULL DEFAULT 0,
  evaluated       INTEGER NOT NULL DEFAULT 0,
  bid_high        INTEGER NOT NULL DEFAULT 0,
  bid_medium      INTEGER NOT NULL DEFAULT 0,
  bid_low         INTEGER NOT NULL DEFAULT 0,
  no_bid          INTEGER NOT NULL DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0,
  errors          TEXT    NOT NULL DEFAULT '[]',  -- JSON: string[]
  report_md       TEXT,                           -- full markdown report
  csv_path        TEXT,                           -- local file path (server-side)
  triggered_by    TEXT    NOT NULL DEFAULT 'scheduler', -- 'scheduler'|'ui'|'api'
  is_deleted      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_province_status
  ON pipeline_runs(province, status, created_at DESC) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created
  ON pipeline_runs(created_at DESC) WHERE is_deleted = 0;

CREATE TABLE IF NOT EXISTS hunter_properties (
  id                  TEXT    PRIMARY KEY,
  run_id              TEXT    NOT NULL REFERENCES pipeline_runs(id),
  address             TEXT    NOT NULL,
  municipality        TEXT,
  province            TEXT    NOT NULL,
  source_url          TEXT,
  minimum_bid         REAL,
  assessed_value      REAL,
  estimated_value     REAL,
  recommended_bid     REAL,
  score               INTEGER,
  recommendation      TEXT    CHECK(recommendation IN ('BID_HIGH','BID_MEDIUM','BID_LOW','NO_BID','ERROR')),
  rationale           TEXT,
  risks               TEXT    NOT NULL DEFAULT '[]',  -- JSON: string[]
  opportunities       TEXT    NOT NULL DEFAULT '[]',  -- JSON: string[]
  details             TEXT    NOT NULL DEFAULT '{}',  -- JSON: full analysis blob
  is_deleted          INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_hunter_properties_run_id
  ON hunter_properties(run_id, recommendation, score DESC) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_hunter_properties_recommendation
  ON hunter_properties(recommendation, score DESC) WHERE is_deleted = 0;
