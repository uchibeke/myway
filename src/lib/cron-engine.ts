/**
 * Built-in Cron Engine — server-only singleton.
 *
 * Replaces OpenClaw's cron scheduler for non-OpenClaw (BYOK) users.
 * Also available as a fallback for OpenClaw users.
 *
 * Architecture (designed for 100k users on one server):
 *
 *   1. Tick loop runs every TICK_INTERVAL (default 15s).
 *   2. Each tick queries the DB for due jobs:
 *        SELECT * FROM cron_jobs WHERE next_run_at <= now AND enabled = 1
 *   3. Due jobs are queued for execution with a concurrency limit.
 *   4. Execution calls the LLM via chat/completions (any OpenAI-compatible provider).
 *   5. Results are stored in cron_runs, next_run_at is advanced.
 *
 * Multi-tenant:
 *   - Self-hosted: default DB only.
 *   - Platform mode: discovers tenant directories, creates heartbeat per tenant.
 *
 * SERVER ONLY — never import from client components.
 */

import type { Database } from 'better-sqlite3'
import { CronExpressionParser } from 'cron-parser'
import { getAIConfig, isAIConfigured, chatCompletionsUrl } from '@/lib/ai-config'
import { getDb } from '@/lib/db'
import { DATA_DIR } from '@/lib/db/config'
import { getWorkspaceContext } from '@/lib/workspace-context'
import { getHeartbeatChecks } from '@/lib/apps'
import { getAppsWithPending } from '@/lib/store/bus'
import { getTaskSummary } from '@/lib/store/tasks'
import { getUserTimezone } from '@/lib/timezone'
import { getActiveNotifications, addNotification } from '@/lib/store/notifications'
import { parseOpenClawJob } from '@/lib/cron-utils'
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'

// ─── Config ──────────────────────────────────────────────────────────────────

const TICK_INTERVAL_MS = parseInt(process.env.MYWAY_CRON_TICK_MS ?? '', 10) || 15_000
const DISCOVERY_INTERVAL_MS = 60_000
const MAX_CONCURRENT = parseInt(process.env.MYWAY_CRON_CONCURRENCY ?? '', 10) || 8
const JOB_TIMEOUT_MS = 120_000
const HEARTBEAT_JOB_ID = 'system_heartbeat'

// ─── State ───────────────────────────────────────────────────────────────────

let _started = false
let _tickTimer: ReturnType<typeof setInterval> | null = null
let _discoveryTimer: ReturnType<typeof setInterval> | null = null
let _running = 0
const _tenantIds: Set<string> = new Set()

// ─── Types ───────────────────────────────────────────────────────────────────

export type CronJob = {
  id: string
  name: string
  description: string | null
  message: string
  schedule_type: string
  schedule_value: string
  tz: string
  enabled: number
  next_run_at: number | null
  last_run_at: number | null
  channel: string | null
  delivery_to: string | null
  is_system: number
  created_at: number
  updated_at: number
}

export type CronRun = {
  id: number
  job_id: string
  status: string
  summary: string | null
  error: string | null
  duration_ms: number | null
  started_at: number
  finished_at: number | null
}

// ─── Schedule helpers ────────────────────────────────────────────────────────

/** Parse interval string like "30m", "1h", "1d", "2h30m" into milliseconds. */
export function parseInterval(s: string): number | null {
  const re = /(\d+)\s*(s|m|h|d|w)/gi
  let total = 0
  let match
  while ((match = re.exec(s)) !== null) {
    const n = parseInt(match[1], 10)
    switch (match[2].toLowerCase()) {
      case 's': total += n * 1000; break
      case 'm': total += n * 60_000; break
      case 'h': total += n * 3_600_000; break
      case 'd': total += n * 86_400_000; break
      case 'w': total += n * 604_800_000; break
    }
  }
  return total > 0 ? total : null
}

/** Compute the next run time (epoch seconds) for a schedule. Returns null if invalid. */
export function computeNextRun(
  scheduleType: string,
  scheduleValue: string,
  tz: string,
  after?: Date,
): number | null {
  const now = after ?? new Date()
  const nowEpoch = Math.floor(now.getTime() / 1000)

  switch (scheduleType) {
    case 'cron':
      try {
        const expr = CronExpressionParser.parse(scheduleValue, { currentDate: now, tz })
        return Math.floor(expr.next().getTime() / 1000)
      } catch { return null }

    case 'every': {
      const ms = parseInterval(scheduleValue)
      return ms ? nowEpoch + Math.floor(ms / 1000) : null
    }

    case 'at': {
      if (scheduleValue.startsWith('+')) {
        const ms = parseInterval(scheduleValue.slice(1))
        return ms ? nowEpoch + Math.floor(ms / 1000) : null
      }
      const ts = Date.parse(scheduleValue)
      if (isNaN(ts)) return null
      const epoch = Math.floor(ts / 1000)
      return epoch > nowEpoch ? epoch : null
    }

    default:
      return null
  }
}

// ─── OpenClaw → DB sync (same pattern as profile-sync for USER.md) ──────────

/**
 * Sync OpenClaw cron jobs into the DB.
 *
 * Same strategy as profile-sync:
 *   - Read OpenClaw file → parse with shared parseOpenClawJob()
 *   - INSERT OR IGNORE into cron_jobs (preserving OpenClaw UUID as id)
 *   - DB is authoritative after import; writes go to DB then sync back to OpenClaw
 *
 * Only imports — never deletes DB rows if OpenClaw file removes a job.
 */
export function syncOpenClawJobsToDb(db: Database, ocJobs: Record<string, unknown>[]): void {
  if (ocJobs.length === 0) return

  try {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO cron_jobs (id, name, description, message, schedule_type, schedule_value, tz, enabled, next_run_at, channel, delivery_to, is_system)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `)

    const txn = db.transaction(() => {
      for (const raw of ocJobs) {
        const parsed = parseOpenClawJob(raw)
        if (!parsed) continue

        insert.run(
          parsed.id,
          parsed.name,
          parsed.description,
          parsed.message,
          parsed.schedule_type,
          parsed.schedule_value,
          parsed.tz,
          parsed.enabled ? 1 : 0,
          parsed.nextRunEpoch ?? computeNextRun(parsed.schedule_type, parsed.schedule_value, parsed.tz),
          parsed.channel,
          parsed.delivery_to,
        )
      }
    })

    txn()
  } catch (e) {
    console.warn('[cron-engine] OpenClaw sync failed:', e instanceof Error ? e.message : e)
  }
}

// ─── Job CRUD ────────────────────────────────────────────────────────────────

function generateId(): string {
  return `cj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function listJobs(db: Database): CronJob[] {
  try {
    return db.prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC').all() as CronJob[]
  } catch { return [] }
}

export function getJob(db: Database, id: string): CronJob | undefined {
  try {
    return db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJob | undefined
  } catch { return undefined }
}

export function createJob(
  db: Database,
  params: {
    name: string
    description?: string
    message: string
    schedule_type: 'cron' | 'every' | 'at'
    schedule_value: string
    tz?: string
    enabled?: boolean
    channel?: string
    delivery_to?: string
    is_system?: boolean
  },
): CronJob {
  const id = generateId()
  const tz = params.tz ?? 'UTC'

  db.prepare(`
    INSERT INTO cron_jobs (id, name, description, message, schedule_type, schedule_value, tz, enabled, next_run_at, channel, delivery_to, is_system)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, params.name, params.description ?? null, params.message,
    params.schedule_type, params.schedule_value, tz,
    params.enabled !== false ? 1 : 0,
    computeNextRun(params.schedule_type, params.schedule_value, tz),
    params.channel ?? null, params.delivery_to ?? null,
    params.is_system ? 1 : 0,
  )

  return getJob(db, id)!
}

/** Columns allowed in cron_jobs updates. Prevents SQL injection via dynamic column names. */
const UPDATABLE_COLUMNS = new Set([
  'name', 'description', 'message', 'schedule_type', 'schedule_value',
  'tz', 'enabled', 'channel', 'delivery_to',
])

export function updateJob(
  db: Database,
  id: string,
  updates: Partial<Pick<CronJob, 'name' | 'description' | 'message' | 'schedule_type' | 'schedule_value' | 'tz' | 'enabled' | 'channel' | 'delivery_to'>>,
): CronJob | undefined {
  const job = getJob(db, id)
  if (!job) return undefined

  const sets: string[] = []
  const vals: unknown[] = []

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue
    if (!UPDATABLE_COLUMNS.has(key)) continue  // whitelist only
    sets.push(`${key} = ?`)
    vals.push(key === 'enabled' ? (value ? 1 : 0) : value)
  }

  // Recompute next_run_at whenever schedule or tz may have changed
  const nextRun = computeNextRun(
    (updates.schedule_type ?? job.schedule_type) as string,
    (updates.schedule_value ?? job.schedule_value) as string,
    (updates.tz ?? job.tz) as string,
  )
  sets.push('next_run_at = ?', 'updated_at = unixepoch()')
  vals.push(nextRun, id)

  db.prepare(`UPDATE cron_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  return getJob(db, id)
}

export function deleteJob(db: Database, id: string): boolean {
  return db.prepare('DELETE FROM cron_jobs WHERE id = ? AND is_system = 0').run(id).changes > 0
}

/** Get the most recent run for each job (batch query for list views). */
export function getLastRuns(db: Database): Map<string, { status: string; error: string | null }> {
  const map = new Map<string, { status: string; error: string | null }>()
  try {
    const rows = db.prepare(`
      SELECT r.job_id, r.status, r.error
      FROM cron_runs r
      INNER JOIN (SELECT job_id, MAX(started_at) as max_started FROM cron_runs GROUP BY job_id) latest
        ON r.job_id = latest.job_id AND r.started_at = latest.max_started
    `).all() as { job_id: string; status: string; error: string | null }[]
    for (const row of rows) {
      map.set(row.job_id, { status: row.status, error: row.error })
    }
  } catch { /* table may not exist yet */ }
  return map
}

export function getJobRuns(db: Database, jobId: string, limit = 20): CronRun[] {
  try {
    return db.prepare(
      'SELECT * FROM cron_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?'
    ).all(jobId, limit) as CronRun[]
  } catch { return [] }
}

// ─── Context building ────────────────────────────────────────────────────────

/** Build system prompt for a cron job. Heartbeat jobs get extra context. */
function buildJobSystemPrompt(db: Database, job: CronJob): string {
  const parts: string[] = [
    'You are an AI assistant executing a scheduled task.',
    `Task name: ${job.name}`,
    `Current time: ${new Date().toISOString()}`,
    `Timezone: ${job.tz}`,
  ]

  if (job.description) parts.splice(2, 0, `Description: ${job.description}`)

  // Workspace context (user profile + AI identity)
  try {
    const ctx = getWorkspaceContext(db)
    if (ctx) parts.push(ctx)
  } catch { /* non-critical */ }

  if (job.is_system) {
    parts.push(...buildHeartbeatContext(db))
  }

  return parts.join('\n\n')
}

/** Heartbeat-specific context: app checks, bus messages, task summary, notifications. */
function buildHeartbeatContext(db: Database): string[] {
  const parts: string[] = []

  try {
    const checks = getHeartbeatChecks()
    if (checks.length > 0) {
      parts.push('## Heartbeat Checks\nEvaluate each and act if appropriate:\n' +
        checks.map((c, i) => `${i + 1}. ${c}`).join('\n'))
    }
  } catch { /* non-critical */ }

  try {
    const pending = getAppsWithPending(db)
    if (pending.length > 0) {
      parts.push('## Pending App Messages\n' +
        pending.map(p => `- ${p.appId}: ${p.count} pending`).join('\n'))
    }
  } catch { /* non-critical */ }

  try {
    const tz = getUserTimezone(db)
    const summary = getTaskSummary(db, tz)
    if (summary.totalOpen > 0) {
      const lines = [`Open tasks: ${summary.totalOpen}`]
      if (summary.dueToday > 0) lines.push(`Due today: ${summary.dueToday}`)
      if (summary.mit) lines.push(`Most important: ${summary.mit.title}`)
      parts.push('## Tasks\n' + lines.join('\n'))
    }
  } catch { /* non-critical */ }

  try {
    const notifs = getActiveNotifications(db)
    if (notifs.length > 0) {
      parts.push(`## Notifications\n${notifs.length} pending notification(s)`)
    }
  } catch { /* non-critical */ }

  return parts
}

// ─── Job execution ───────────────────────────────────────────────────────────

/** Advance next_run_at after a job runs (or disable one-shot 'at' jobs). */
function advanceSchedule(db: Database, job: CronJob): void {
  if (job.schedule_type === 'at') {
    db.prepare(
      'UPDATE cron_jobs SET enabled = 0, last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = ?'
    ).run(job.id)
  } else {
    const nextRun = computeNextRun(job.schedule_type, job.schedule_value, job.tz)
    db.prepare(
      'UPDATE cron_jobs SET next_run_at = ?, last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = ?'
    ).run(nextRun, job.id)
  }
}

async function executeJob(db: Database, job: CronJob): Promise<void> {
  if (!isAIConfigured()) {
    console.warn(`[cron-engine] AI not configured, skipping job ${job.id}`)
    return
  }

  const runId = db.prepare(
    'INSERT INTO cron_runs (job_id, status, started_at) VALUES (?, ?, unixepoch())'
  ).run(job.id, 'running').lastInsertRowid

  const startTime = Date.now()

  try {
    const { baseUrl, token, model } = getAIConfig()
    const systemPrompt = buildJobSystemPrompt(db, job)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS)

    try {
      const res = await fetch(chatCompletionsUrl(baseUrl), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: job.message },
          ],
          max_tokens: 2048,
          ...(model ? { model } : {}),
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText)
        throw new Error(`AI backend error ${res.status}: ${errText}`)
      }

      const data = await res.json() as { choices?: { message?: { content?: string } }[] }
      const summary = (data.choices?.[0]?.message?.content ?? '').slice(0, 500)
      const durationMs = Date.now() - startTime

      db.prepare(
        `UPDATE cron_runs SET status = 'success', summary = ?, duration_ms = ?, finished_at = unixepoch() WHERE id = ?`
      ).run(summary, durationMs, runId)

      // Notify user of result
      try {
        addNotification(db, {
          appId: 'system',
          title: `Cron: ${job.name}`,
          body: summary,
          type: 'success',
          priority: 7,
          actionUrl: `/apps/settings?tab=system`,
        })
      } catch { /* notifications table may not exist */ }
    } finally {
      clearTimeout(timeout)
    }

    advanceSchedule(db, job)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const durationMs = Date.now() - startTime

    db.prepare(
      `UPDATE cron_runs SET status = ?, error = ?, duration_ms = ?, finished_at = unixepoch() WHERE id = ?`
    ).run(error.includes('abort') ? 'timeout' : 'error', error, durationMs, runId)

    advanceSchedule(db, job)
    console.error(`[cron-engine] Job ${job.id} (${job.name}) failed:`, error)

    // Alert notification for failures
    try {
      addNotification(db, {
        appId: 'system',
        title: `Cron failed: ${job.name}`,
        body: error.slice(0, 200),
        type: 'alert',
        priority: 2,
        actionUrl: `/apps/settings?tab=system`,
      })
    } catch { /* notifications table may not exist */ }
  }
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────

/** Ensure the heartbeat system job exists. Creates it if missing. Idempotent. */
export function ensureHeartbeatJob(db: Database): void {
  try {
    const exists = db.prepare('SELECT 1 FROM cron_jobs WHERE id = ?').get(HEARTBEAT_JOB_ID)
    if (exists) return

    db.prepare(`
      INSERT INTO cron_jobs (id, name, description, message, schedule_type, schedule_value, tz, enabled, next_run_at, is_system)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
    `).run(
      HEARTBEAT_JOB_ID,
      'Heartbeat',
      'Periodic autonomous check — evaluates app heartbeat checks, drains bus messages, monitors tasks and health.',
      'Run your heartbeat checks. Evaluate each check against the current context. For any check that triggers, take the appropriate action. Be concise — only report actions taken or important findings. If nothing needs attention, respond with "All clear."',
      'every', '30m', 'UTC',
      computeNextRun('every', '30m', 'UTC'),
    )
    console.log('[cron-engine] Created system heartbeat job')
  } catch { /* table may not exist yet — migration will create it */ }
}

// ─── Tenant discovery ────────────────────────────────────────────────────────

function discoverTenants(): void {
  const tenantsDir = join(DATA_DIR, 'tenants')
  if (!existsSync(tenantsDir)) return

  try {
    for (const entry of readdirSync(tenantsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /^[a-zA-Z0-9_-]{1,64}$/.test(entry.name)) {
        _tenantIds.add(entry.name)
      }
    }
  } catch { /* directory may not exist */ }
}

function ensureHeartbeatForAllTenants(): void {
  for (const tenantId of _tenantIds) {
    try { ensureHeartbeatJob(getDb(tenantId)) } catch { /* skip */ }
  }
}

// ─── Tick loop ───────────────────────────────────────────────────────────────

async function processDueJobs(db: Database, now: number): Promise<void> {
  let dueJobs: CronJob[]
  try {
    dueJobs = db.prepare(
      'SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?'
    ).all(now) as CronJob[]
  } catch { return }

  for (const job of dueJobs) {
    if (_running >= MAX_CONCURRENT) {
      console.warn(`[cron-engine] Concurrency limit (${MAX_CONCURRENT}) reached, deferring remaining jobs`)
      break
    }

    // Advance next_run_at BEFORE execution to prevent double-fire on overlapping ticks.
    // If the job fails, advanceSchedule() inside executeJob is a no-op (already advanced).
    advanceSchedule(db, job)

    _running++
    executeJob(db, job)
      .catch(err => console.error(`[cron-engine] Unexpected error in job ${job.id}:`, err))
      .finally(() => { _running-- })
  }
}

async function tick(): Promise<void> {
  if (!isAIConfigured()) return
  const now = Math.floor(Date.now() / 1000)

  try { await processDueJobs(getDb(), now) } catch (err) {
    console.error('[cron-engine] Default DB tick error:', err instanceof Error ? err.message : err)
  }

  for (const tenantId of _tenantIds) {
    try { await processDueJobs(getDb(tenantId), now) } catch (err) {
      console.error(`[cron-engine] Tenant ${tenantId} tick error:`, err instanceof Error ? err.message : err)
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Manually trigger a job. Returns run ID for polling, or null if job not found. */
export async function triggerJob(db: Database, jobId: string): Promise<number | null> {
  const job = getJob(db, jobId)
  if (!job) return null

  const runId = db.prepare(
    'INSERT INTO cron_runs (job_id, status, started_at) VALUES (?, ?, unixepoch())'
  ).run(job.id, 'queued').lastInsertRowid as number

  executeJob(db, job).catch(err =>
    console.error(`[cron-engine] Manual trigger error for ${jobId}:`, err)
  )

  return runId
}

/** Start the cron engine. Idempotent — only starts once per process. */
export function startCronEngine(): void {
  if (_started) return
  _started = true

  console.log(`[cron-engine] Starting — tick ${TICK_INTERVAL_MS / 1000}s, concurrency ${MAX_CONCURRENT}`)

  // Bootstrap heartbeat jobs
  try { ensureHeartbeatJob(getDb()) } catch { /* DB not ready yet */ }
  discoverTenants()
  ensureHeartbeatForAllTenants()

  _tickTimer = setInterval(() => {
    tick().catch(err => console.error('[cron-engine] Tick error:', err))
  }, TICK_INTERVAL_MS)
  if (_tickTimer.unref) _tickTimer.unref()

  _discoveryTimer = setInterval(() => {
    const prev = _tenantIds.size
    discoverTenants()
    ensureHeartbeatForAllTenants()
    if (_tenantIds.size > prev) {
      console.log(`[cron-engine] Discovered ${_tenantIds.size - prev} new tenant(s), total: ${_tenantIds.size}`)
    }
  }, DISCOVERY_INTERVAL_MS)
  if (_discoveryTimer.unref) _discoveryTimer.unref()
}

/** Stop the cron engine (graceful shutdown / testing). */
export function stopCronEngine(): void {
  if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null }
  if (_discoveryTimer) { clearInterval(_discoveryTimer); _discoveryTimer = null }
  _started = false
  _tenantIds.clear()
}
