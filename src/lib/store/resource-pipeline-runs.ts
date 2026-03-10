/**
 * Pipeline Runs resource handler.
 * Tracks Hunter batch run history — one row per province scan.
 *
 * Storage: Cloudflare D1 when CLOUDFLARE_D1_DB_ID is set; SQLite fallback otherwise.
 *
 * Actions:
 *   cancel — marks a pending/running run as cancelled
 */

import type { Database } from 'better-sqlite3'
import type { ResourceHandler, ListQuery } from './registry'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, openSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { HUNTER_SOURCES } from '../hunter-config'
import { getD1Client } from '../db/cloudflare-d1'

const AGENT_PIPELINES_DIR = join(process.cwd(), '..', 'agent-pipelines')

/** Spawn execute-run.ts as a detached background process. */
function spawnRunExecutor(runId: string): void {
  const scriptPath = join(AGENT_PIPELINES_DIR, 'src', 'scheduler', 'execute-run.ts')
  const envFile = join(AGENT_PIPELINES_DIR, '.env')
  if (!existsSync(scriptPath)) {
    console.warn('[pipeline-runs] execute-run.ts not found at', scriptPath)
    return
  }
  const logPath = join(AGENT_PIPELINES_DIR, '..', `hunter-run-${runId.slice(0, 8)}.log`)
  const args = ['tsx', ...(existsSync(envFile) ? ['--env-file', envFile] : []), scriptPath, runId]
  const logFd = openSync(logPath, 'a')
  const child = spawn('npx', args, {
    cwd: AGENT_PIPELINES_DIR,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env },
  })
  closeSync(logFd)
  child.unref()
  console.log(`[pipeline-runs] Spawned executor for run ${runId} (pid ${child.pid})`)
}

// ─── D1 implementation ───────────────────────────────────────────────────────

const d1PipelineRunsResource: ResourceHandler = {
  async list(_db: Database, query: ListQuery) {
    const d1 = getD1Client()!
    const limit = Math.min(Number(query.limit) || 20, 100)
    const offset = Number(query.offset) || 0
    const province = query.province as string | undefined
    const status = query.status as string | undefined

    const conditions: string[] = ['is_deleted = 0']
    const params: unknown[] = []
    if (province) { conditions.push('province = ?'); params.push(province) }
    if (status)   { conditions.push('status = ?');   params.push(status) }

    const where = conditions.join(' AND ')
    const [runs, countResult] = await Promise.all([
      d1.select(
        `SELECT id, source_id, province, municipality, status,
                started_at, completed_at,
                total_listings, evaluated,
                bid_high, bid_medium, bid_low, no_bid, error_count,
                triggered_by, source_url, discovery_query, source_name,
                available_cash, created_at
         FROM pipeline_runs
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      d1.select<{ n: number }>(
        `SELECT COUNT(*) as n FROM pipeline_runs WHERE ${where}`,
        params
      ),
    ])
    return { items: runs, total: countResult[0]?.n ?? 0, limit, offset }
  },

  async get(_db: Database, id: string) {
    const d1 = getD1Client()!
    const runs = await d1.select(
      `SELECT * FROM pipeline_runs WHERE id = ? AND is_deleted = 0`,
      [id]
    )
    const run = runs[0]
    if (!run) return null

    const properties = await d1.select(
      `SELECT id, address, municipality, province,
              minimum_bid, assessed_value, recommended_bid,
              score, recommendation, rationale, risks, opportunities,
              source_url, created_at
       FROM hunter_properties
       WHERE run_id = ? AND is_deleted = 0
       ORDER BY score DESC`,
      [id]
    )
    return { ...run, properties }
  },

  async create(_db: Database, body: Record<string, unknown>) {
    const d1 = getD1Client()!
    const { source_id, province, municipality, triggered_by, discovery_query, source_name, available_cash } = body

    const source = source_id ? HUNTER_SOURCES.find(s => s.id === source_id) : null
    const resolvedProvince     = province ?? source?.province ?? null
    const resolvedMunicipality = municipality ?? source?.authority ?? null
    const resolvedSourceUrl    = source?.url ?? null
    const resolvedDiscoveryQuery = (discovery_query as string) ?? source?.discovery_query ?? null
    const resolvedSourceName   = (source_name as string) ?? source?.name ?? null

    if (!resolvedProvince && !resolvedDiscoveryQuery) {
      throw new Error('province or discovery_query is required')
    }

    const id = randomUUID()
    const dbProvince = resolvedProvince || 'CA'
    const createdAt = Math.floor(Date.now() / 1000)

    await d1.execute(
      `INSERT INTO pipeline_runs
         (id, source_id, province, municipality, status, triggered_by,
          source_url, discovery_query, source_name, available_cash, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [
        id,
        source_id ?? (resolvedProvince ? `custom-${String(resolvedProvince).toLowerCase()}` : 'ad-hoc'),
        dbProvince,
        resolvedMunicipality ?? null,
        triggered_by ?? 'ui',
        resolvedSourceUrl ?? null,
        resolvedDiscoveryQuery ?? null,
        resolvedSourceName ?? null,
        Number(available_cash) || 100000,
        createdAt,
      ]
    )

    spawnRunExecutor(id)
    return { id }
  },

  async update(_db: Database, id: string, body: Record<string, unknown>) {
    const d1 = getD1Client()!
    const allowed = [
      'status', 'started_at', 'completed_at',
      'total_listings', 'evaluated',
      'bid_high', 'bid_medium', 'bid_low', 'no_bid', 'error_count',
      'errors', 'report_md', 'csv_path',
    ]
    const sets: string[] = []
    const params: unknown[] = []
    for (const key of allowed) {
      if (key in body) { sets.push(`${key} = ?`); params.push(body[key]) }
    }
    if (!sets.length) return { ok: true as const }
    params.push(id)
    await d1.execute(`UPDATE pipeline_runs SET ${sets.join(', ')} WHERE id = ?`, params)
    return { ok: true as const }
  },

  async delete(_db: Database, id: string) {
    const d1 = getD1Client()!
    await d1.execute(`UPDATE pipeline_runs SET is_deleted = 1 WHERE id = ?`, [id])
    return { ok: true as const }
  },

  async action(_db: Database, actionName: string, id: string) {
    if (actionName === 'cancel') {
      const d1 = getD1Client()!
      await d1.execute(
        `UPDATE pipeline_runs SET status = 'cancelled' WHERE id = ? AND status IN ('pending','running')`,
        [id]
      )
      return { ok: true }
    }
    throw new Error(`Unknown action: ${actionName}`)
  },
}

// ─── SQLite fallback implementation ──────────────────────────────────────────

const sqlitePipelineRunsResource: ResourceHandler = {
  list(db: Database, query: ListQuery) {
    const limit = Math.min(Number(query.limit) || 20, 100)
    const offset = Number(query.offset) || 0
    const province = query.province as string | undefined
    const status = query.status as string | undefined

    const conditions: string[] = ['is_deleted = 0']
    const params: unknown[] = []

    if (province) { conditions.push('province = ?'); params.push(province) }
    if (status)   { conditions.push('status = ?');   params.push(status) }

    const where = conditions.join(' AND ')
    const runs = db.prepare(
      `SELECT id, source_id, province, municipality, status,
              started_at, completed_at,
              total_listings, evaluated,
              bid_high, bid_medium, bid_low, no_bid, error_count,
              triggered_by, source_url, discovery_query, source_name,
              available_cash, created_at
       FROM pipeline_runs
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as unknown[]

    const total = (db.prepare(
      `SELECT COUNT(*) as n FROM pipeline_runs WHERE ${where}`
    ).get(...params) as { n: number }).n

    return { items: runs, total, limit, offset }
  },

  get(db: Database, id: string) {
    const run = db.prepare(
      `SELECT * FROM pipeline_runs WHERE id = ? AND is_deleted = 0`
    ).get(id)
    if (!run) return null

    const properties = db.prepare(
      `SELECT id, address, municipality, province,
              minimum_bid, assessed_value, recommended_bid,
              score, recommendation, rationale, risks, opportunities,
              source_url, created_at
       FROM hunter_properties
       WHERE run_id = ? AND is_deleted = 0
       ORDER BY score DESC, recommendation`
    ).all(id)

    return { ...(run as Record<string, unknown>), properties }
  },

  create(db: Database, body: Record<string, unknown>) {
    const { source_id, province, municipality, triggered_by, discovery_query, source_name, available_cash } = body

    const source = source_id ? HUNTER_SOURCES.find(s => s.id === source_id) : null
    const resolvedProvince     = province ?? source?.province ?? null
    const resolvedMunicipality = municipality ?? source?.authority ?? null
    const resolvedSourceUrl    = source?.url ?? null
    const resolvedDiscoveryQuery = (discovery_query as string) ?? source?.discovery_query ?? null
    const resolvedSourceName   = (source_name as string) ?? source?.name ?? null

    if (!resolvedProvince && !resolvedDiscoveryQuery) {
      throw new Error('province or discovery_query is required')
    }

    const id = randomUUID()
    const dbProvince = resolvedProvince || 'CA'
    db.prepare(
      `INSERT INTO pipeline_runs (id, source_id, province, municipality, status, triggered_by, source_url, discovery_query, source_name, available_cash)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
    ).run(
      id,
      source_id ?? (resolvedProvince ? `custom-${String(resolvedProvince).toLowerCase()}` : 'ad-hoc'),
      dbProvince,
      resolvedMunicipality,
      triggered_by ?? 'ui',
      resolvedSourceUrl,
      resolvedDiscoveryQuery,
      resolvedSourceName,
      Number(available_cash) || 100000,
    )

    spawnRunExecutor(id)
    return { id }
  },

  update(db: Database, id: string, body: Record<string, unknown>) {
    const allowed = [
      'status', 'started_at', 'completed_at',
      'total_listings', 'evaluated',
      'bid_high', 'bid_medium', 'bid_low', 'no_bid', 'error_count',
      'errors', 'report_md', 'csv_path',
    ]
    const sets: string[] = []
    const params: unknown[] = []
    for (const key of allowed) {
      if (key in body) { sets.push(`${key} = ?`); params.push(body[key]) }
    }
    if (!sets.length) return { ok: true as const }
    params.push(id)
    db.prepare(`UPDATE pipeline_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return { ok: true as const }
  },

  delete(db: Database, id: string) {
    db.prepare(`UPDATE pipeline_runs SET is_deleted = 1 WHERE id = ?`).run(id)
    return { ok: true as const }
  },

  action(db: Database, actionName: string, id: string) {
    if (actionName === 'cancel') {
      db.prepare(
        `UPDATE pipeline_runs SET status = 'cancelled' WHERE id = ? AND status IN ('pending','running')`
      ).run(id)
      return { ok: true }
    }
    throw new Error(`Unknown action: ${actionName}`)
  },
}

// ─── Export: use D1 if credentials present, otherwise SQLite ─────────────────

export const pipelineRunsResource: ResourceHandler = getD1Client()
  ? d1PipelineRunsResource
  : sqlitePipelineRunsResource
