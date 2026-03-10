/**
 * Guardrail Events resource handler.
 *
 * Manages the queryable cache of APort audit events in SQLite.
 * Source of truth is always the audit.log file — this table is synced on demand.
 *
 * Registered as 'guardrail-events' in the resource registry.
 * Accessible via GET/POST /api/store/guardrail-events
 */

import type { Database } from 'better-sqlite3'
import type { ResourceHandler, ListQuery } from './registry'

export type GuardrailEventRow = {
  id:        string
  timestamp: number
  tool:      string
  allowed:   number   // SQLite stores booleans as 0/1
  policy:    string
  code:      string
  context:   string
  synced_at: number
}

export const guardrailEventsResource: ResourceHandler = {
  list(db: Database, query: ListQuery) {
    const limit  = Math.min(Number(query.limit)  || 50,  500)
    const offset = Number(query.offset) || 0

    // Filter support: ?allowed=0 (blocked only), ?allowed=1 (allowed only), absent = all
    const allowedFilter = query.allowed as string | undefined
    // Filter by tool: ?tool=system.command.execute
    const toolFilter = query.tool as string | undefined

    const conditions: string[] = []
    const params: unknown[] = []

    if (allowedFilter === '0' || allowedFilter === 'false') {
      conditions.push('allowed = 0')
    } else if (allowedFilter === '1' || allowedFilter === 'true') {
      conditions.push('allowed = 1')
    }

    if (toolFilter) {
      conditions.push('tool = ?')
      params.push(toolFilter)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const items = db.prepare(
      `SELECT id, timestamp, tool, allowed, policy, code, context, synced_at
       FROM guardrail_events
       ${where}
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as GuardrailEventRow[]

    const total = (db.prepare(
      `SELECT COUNT(*) as n FROM guardrail_events ${where}`,
    ).get(...params) as { n: number }).n

    // Stats: total, blocked, allowed, distinct tools
    const stats = db.prepare(
      `SELECT
         COUNT(*)           AS total,
         SUM(1 - allowed)   AS blocked,
         SUM(allowed)       AS allowed_count
       FROM guardrail_events`,
    ).get() as { total: number; blocked: number; allowed_count: number }

    const tools = (db.prepare(
      `SELECT DISTINCT tool FROM guardrail_events ORDER BY tool`,
    ).all() as { tool: string }[]).map((r) => r.tool)

    return {
      items: items.map(normalizeRow),
      total,
      limit,
      offset,
      stats: {
        total:   stats.total   ?? 0,
        blocked: stats.blocked ?? 0,
        allowed: stats.allowed_count ?? 0,
        tools,
      },
    }
  },

  get(db: Database, id: string) {
    const row = db.prepare(
      `SELECT id, timestamp, tool, allowed, policy, code, context, synced_at
       FROM guardrail_events WHERE id = ?`,
    ).get(id) as GuardrailEventRow | undefined
    return row ? normalizeRow(row) : null
  },

  create(db: Database, body: Record<string, unknown>) {
    const id        = String(body['id']        ?? '')
    const timestamp = Number(body['timestamp'] ?? Math.floor(Date.now() / 1000))
    const tool      = String(body['tool']      ?? '')
    const allowed   = body['allowed'] === false || body['allowed'] === 0 ? 0 : 1
    const policy    = String(body['policy']    ?? '')
    const code      = String(body['code']      ?? '')
    const context   = String(body['context']   ?? '').slice(0, 500)
    const syncedAt  = Math.floor(Date.now() / 1000)

    if (!id || !tool) throw new Error('id and tool are required')

    db.prepare(
      `INSERT INTO guardrail_events (id, timestamp, tool, allowed, policy, code, context, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         allowed   = excluded.allowed,
         policy    = excluded.policy,
         code      = excluded.code,
         context   = excluded.context,
         synced_at = excluded.synced_at`,
    ).run(id, timestamp, tool, allowed, policy, code, context, syncedAt)

    return { id }
  },

  update(db: Database, id: string, body: Record<string, unknown>) {
    // Audit events are generally immutable — only context can be updated
    const context = body['context'] !== undefined ? String(body['context']).slice(0, 500) : undefined
    if (context !== undefined) {
      db.prepare(`UPDATE guardrail_events SET context = ? WHERE id = ?`).run(context, id)
    }
    return { ok: true as const }
  },

  delete(db: Database, id: string) {
    // Hard delete — audit events have no soft-delete
    db.prepare(`DELETE FROM guardrail_events WHERE id = ?`).run(id)
    return { ok: true as const }
  },
}

function normalizeRow(row: GuardrailEventRow) {
  return {
    ...row,
    allowed: row.allowed === 1,  // convert SQLite int → boolean for API consumers
  }
}
