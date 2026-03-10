/**
 * Tests for the built-in cron engine.
 *
 * Covers: schedule parsing, job CRUD, next-run computation,
 * heartbeat job creation, and multi-tenant discovery.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'

// ─── In-memory DB setup ──────────────────────────────────────────────────────

function createTestDb(): DB {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      message     TEXT NOT NULL,
      schedule_type  TEXT NOT NULL CHECK(schedule_type IN ('cron', 'every', 'at')),
      schedule_value TEXT NOT NULL,
      tz          TEXT NOT NULL DEFAULT 'UTC',
      enabled     INTEGER NOT NULL DEFAULT 1,
      next_run_at INTEGER,
      last_run_at INTEGER,
      channel     TEXT,
      delivery_to TEXT,
      is_system   INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_cron_jobs_due
      ON cron_jobs(next_run_at) WHERE enabled = 1;

    CREATE TABLE IF NOT EXISTS cron_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
      status      TEXT NOT NULL DEFAULT 'running',
      summary     TEXT,
      error       TEXT,
      duration_ms INTEGER,
      started_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      finished_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_cron_runs_job
      ON cron_runs(job_id, started_at);
  `)

  return db
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('parseInterval', () => {
  let parseInterval: typeof import('@/lib/cron-engine').parseInterval

  beforeEach(async () => {
    const mod = await import('@/lib/cron-engine')
    parseInterval = mod.parseInterval
  })

  it('parses minutes', () => {
    expect(parseInterval('30m')).toBe(30 * 60_000)
  })

  it('parses hours', () => {
    expect(parseInterval('2h')).toBe(2 * 3_600_000)
  })

  it('parses days', () => {
    expect(parseInterval('1d')).toBe(86_400_000)
  })

  it('parses weeks', () => {
    expect(parseInterval('1w')).toBe(604_800_000)
  })

  it('parses combined intervals', () => {
    expect(parseInterval('1h30m')).toBe(3_600_000 + 30 * 60_000)
  })

  it('returns null for invalid input', () => {
    expect(parseInterval('abc')).toBeNull()
    expect(parseInterval('')).toBeNull()
  })
})

describe('computeNextRun', () => {
  let computeNextRun: typeof import('@/lib/cron-engine').computeNextRun

  beforeEach(async () => {
    const mod = await import('@/lib/cron-engine')
    computeNextRun = mod.computeNextRun
  })

  it('computes next run for cron expression', () => {
    const now = new Date('2026-03-04T12:00:00Z')
    const next = computeNextRun('cron', '0 13 * * *', 'UTC', now)
    expect(next).toBe(Math.floor(new Date('2026-03-04T13:00:00Z').getTime() / 1000))
  })

  it('computes next run for every interval', () => {
    const now = new Date('2026-03-04T12:00:00Z')
    const next = computeNextRun('every', '30m', 'UTC', now)
    expect(next).toBe(Math.floor(now.getTime() / 1000) + 30 * 60)
  })

  it('computes next run for at (relative)', () => {
    const now = new Date('2026-03-04T12:00:00Z')
    const next = computeNextRun('at', '+2h', 'UTC', now)
    expect(next).toBe(Math.floor(now.getTime() / 1000) + 2 * 3600)
  })

  it('computes next run for at (ISO date in future)', () => {
    const future = '2026-12-25T10:00:00Z'
    const now = new Date('2026-03-04T12:00:00Z')
    const next = computeNextRun('at', future, 'UTC', now)
    expect(next).toBe(Math.floor(new Date(future).getTime() / 1000))
  })

  it('returns null for past at date', () => {
    const past = '2020-01-01T00:00:00Z'
    const now = new Date('2026-03-04T12:00:00Z')
    expect(computeNextRun('at', past, 'UTC', now)).toBeNull()
  })

  it('returns null for invalid cron', () => {
    expect(computeNextRun('cron', 'not a cron', 'UTC')).toBeNull()
  })

  it('returns null for invalid interval', () => {
    expect(computeNextRun('every', 'banana', 'UTC')).toBeNull()
  })
})

describe('Job CRUD', () => {
  let db: DB
  let createJob: typeof import('@/lib/cron-engine').createJob
  let listJobs: typeof import('@/lib/cron-engine').listJobs
  let getJob: typeof import('@/lib/cron-engine').getJob
  let updateJob: typeof import('@/lib/cron-engine').updateJob
  let deleteJob: typeof import('@/lib/cron-engine').deleteJob
  let getJobRuns: typeof import('@/lib/cron-engine').getJobRuns

  beforeEach(async () => {
    db = createTestDb()
    const mod = await import('@/lib/cron-engine')
    createJob = mod.createJob
    listJobs = mod.listJobs
    getJob = mod.getJob
    updateJob = mod.updateJob
    deleteJob = mod.deleteJob
    getJobRuns = mod.getJobRuns
  })

  afterEach(() => {
    db.close()
  })

  it('creates a cron job', () => {
    const job = createJob(db, {
      name: 'Morning brief',
      message: 'Generate morning brief',
      schedule_type: 'cron',
      schedule_value: '0 8 * * *',
      tz: 'America/New_York',
    })

    expect(job.id).toMatch(/^cj_/)
    expect(job.name).toBe('Morning brief')
    expect(job.schedule_type).toBe('cron')
    expect(job.schedule_value).toBe('0 8 * * *')
    expect(job.tz).toBe('America/New_York')
    expect(job.enabled).toBe(1)
    expect(job.next_run_at).toBeGreaterThan(0)
    expect(job.is_system).toBe(0)
  })

  it('creates an every-interval job', () => {
    const job = createJob(db, {
      name: 'Check email',
      message: 'Check for new emails',
      schedule_type: 'every',
      schedule_value: '15m',
    })

    expect(job.schedule_type).toBe('every')
    expect(job.next_run_at).toBeGreaterThan(0)
  })

  it('creates a one-shot at job', () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    const job = createJob(db, {
      name: 'Reminder',
      message: 'Remind me',
      schedule_type: 'at',
      schedule_value: future,
    })

    expect(job.schedule_type).toBe('at')
    expect(job.next_run_at).toBeGreaterThan(0)
  })

  it('creates a disabled job', () => {
    const job = createJob(db, {
      name: 'Disabled',
      message: 'test',
      schedule_type: 'every',
      schedule_value: '1h',
      enabled: false,
    })

    expect(job.enabled).toBe(0)
  })

  it('creates a job with delivery config', () => {
    const job = createJob(db, {
      name: 'With delivery',
      message: 'test',
      schedule_type: 'every',
      schedule_value: '1h',
      channel: 'telegram',
      delivery_to: '123456',
    })

    expect(job.channel).toBe('telegram')
    expect(job.delivery_to).toBe('123456')
  })

  it('lists all jobs', () => {
    createJob(db, { name: 'A', message: 'a', schedule_type: 'every', schedule_value: '1h' })
    createJob(db, { name: 'B', message: 'b', schedule_type: 'every', schedule_value: '2h' })

    const jobs = listJobs(db)
    expect(jobs.length).toBe(2)
  })

  it('gets a single job by ID', () => {
    const created = createJob(db, { name: 'Test', message: 'test', schedule_type: 'every', schedule_value: '1h' })
    const fetched = getJob(db, created.id)
    expect(fetched?.name).toBe('Test')
  })

  it('returns undefined for non-existent job', () => {
    expect(getJob(db, 'nonexistent')).toBeUndefined()
  })

  it('updates a job', () => {
    const job = createJob(db, { name: 'Old', message: 'old msg', schedule_type: 'every', schedule_value: '1h' })
    const updated = updateJob(db, job.id, { name: 'New', message: 'new msg' })

    expect(updated?.name).toBe('New')
    expect(updated?.message).toBe('new msg')
  })

  it('updates schedule and recomputes next_run_at', () => {
    const job = createJob(db, { name: 'Test', message: 'test', schedule_type: 'every', schedule_value: '1h' })
    const oldNext = job.next_run_at

    const updated = updateJob(db, job.id, { schedule_type: 'every', schedule_value: '5m' })
    // 5m job should have a closer next_run_at than 1h
    expect(updated?.next_run_at).toBeLessThan(oldNext!)
  })

  it('enables/disables a job', () => {
    const job = createJob(db, { name: 'Test', message: 'test', schedule_type: 'every', schedule_value: '1h' })
    expect(job.enabled).toBe(1)

    const disabled = updateJob(db, job.id, { enabled: 0 })
    expect(disabled?.enabled).toBe(0)

    const enabled = updateJob(db, job.id, { enabled: 1 })
    expect(enabled?.enabled).toBe(1)
  })

  it('deletes a user job', () => {
    const job = createJob(db, { name: 'Delete me', message: 'test', schedule_type: 'every', schedule_value: '1h' })
    expect(deleteJob(db, job.id)).toBe(true)
    expect(getJob(db, job.id)).toBeUndefined()
  })

  it('cannot delete a system job', () => {
    const job = createJob(db, {
      name: 'System',
      message: 'system task',
      schedule_type: 'every',
      schedule_value: '30m',
      is_system: true,
    })
    expect(deleteJob(db, job.id)).toBe(false)
    expect(getJob(db, job.id)).toBeDefined()
  })

  it('returns empty runs for a new job', () => {
    const job = createJob(db, { name: 'Test', message: 'test', schedule_type: 'every', schedule_value: '1h' })
    expect(getJobRuns(db, job.id)).toEqual([])
  })

  it('retrieves job runs', () => {
    const job = createJob(db, { name: 'Test', message: 'test', schedule_type: 'every', schedule_value: '1h' })

    // Insert a run manually
    db.prepare(`
      INSERT INTO cron_runs (job_id, status, summary, duration_ms, started_at, finished_at)
      VALUES (?, 'success', 'All good', 1234, unixepoch(), unixepoch())
    `).run(job.id)

    const runs = getJobRuns(db, job.id)
    expect(runs.length).toBe(1)
    expect(runs[0].status).toBe('success')
    expect(runs[0].summary).toBe('All good')
    expect(runs[0].duration_ms).toBe(1234)
  })

  it('cascades deletes to runs', () => {
    const job = createJob(db, { name: 'Test', message: 'test', schedule_type: 'every', schedule_value: '1h' })
    db.prepare('INSERT INTO cron_runs (job_id, status) VALUES (?, ?)').run(job.id, 'success')

    db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(job.id)
    const runs = db.prepare('SELECT * FROM cron_runs WHERE job_id = ?').all(job.id)
    expect(runs.length).toBe(0)
  })
})

describe('ensureHeartbeatJob', () => {
  let db: DB
  let ensureHeartbeatJob: typeof import('@/lib/cron-engine').ensureHeartbeatJob

  beforeEach(async () => {
    db = createTestDb()
    const mod = await import('@/lib/cron-engine')
    ensureHeartbeatJob = mod.ensureHeartbeatJob
  })

  afterEach(() => {
    db.close()
  })

  it('creates the heartbeat job on first call', () => {
    ensureHeartbeatJob(db)

    const job = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get('system_heartbeat') as Record<string, unknown>
    expect(job).toBeDefined()
    expect(job.name).toBe('Heartbeat')
    expect(job.is_system).toBe(1)
    expect(job.schedule_type).toBe('every')
    expect(job.schedule_value).toBe('30m')
    expect(job.enabled).toBe(1)
  })

  it('is idempotent — does not duplicate', () => {
    ensureHeartbeatJob(db)
    ensureHeartbeatJob(db)
    ensureHeartbeatJob(db)

    const count = db.prepare('SELECT COUNT(*) as cnt FROM cron_jobs WHERE id = ?').get('system_heartbeat') as { cnt: number }
    expect(count.cnt).toBe(1)
  })
})

describe('Due job query', () => {
  let db: DB

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('finds due jobs (next_run_at in the past)', () => {
    const now = Math.floor(Date.now() / 1000)

    // Due job (next_run_at is in the past)
    db.prepare(`
      INSERT INTO cron_jobs (id, name, message, schedule_type, schedule_value, enabled, next_run_at)
      VALUES ('due1', 'Due', 'test', 'every', '1h', 1, ?)
    `).run(now - 60)

    // Future job
    db.prepare(`
      INSERT INTO cron_jobs (id, name, message, schedule_type, schedule_value, enabled, next_run_at)
      VALUES ('future1', 'Future', 'test', 'every', '1h', 1, ?)
    `).run(now + 3600)

    // Disabled job (past but disabled)
    db.prepare(`
      INSERT INTO cron_jobs (id, name, message, schedule_type, schedule_value, enabled, next_run_at)
      VALUES ('disabled1', 'Disabled', 'test', 'every', '1h', 0, ?)
    `).run(now - 60)

    const due = db.prepare(
      'SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?'
    ).all(now) as { id: string }[]

    expect(due.length).toBe(1)
    expect(due[0].id).toBe('due1')
  })

  it('handles 1000 jobs efficiently', () => {
    const now = Math.floor(Date.now() / 1000)
    const insert = db.prepare(`
      INSERT INTO cron_jobs (id, name, message, schedule_type, schedule_value, enabled, next_run_at)
      VALUES (?, ?, 'test', 'every', '1h', 1, ?)
    `)

    const insertMany = db.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        // 10 due, 990 future
        const nextRun = i < 10 ? now - 60 : now + 3600 + i
        insert.run(`job_${i}`, `Job ${i}`, nextRun)
      }
    })
    insertMany()

    const start = performance.now()
    const due = db.prepare(
      'SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?'
    ).all(now)
    const elapsed = performance.now() - start

    expect(due.length).toBe(10)
    expect(elapsed).toBeLessThan(50) // Should be sub-millisecond with index
  })
})
