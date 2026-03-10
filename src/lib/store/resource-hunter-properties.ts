/**
 * Hunter Properties resource handler.
 * Each row is one evaluated property from a batch run.
 *
 * Storage: Cloudflare D1 when CLOUDFLARE_D1_DB_ID is set; SQLite fallback otherwise.
 */

import type { Database } from 'better-sqlite3'
import type { ResourceHandler, ListQuery } from './registry'
import { getD1Client } from '../db/cloudflare-d1'

// ─── D1 implementation ───────────────────────────────────────────────────────

const d1HunterPropertiesResource: ResourceHandler = {
  async list(_db: Database, query: ListQuery) {
    const d1 = getD1Client()!
    const limit = Math.min(Number(query.limit) || 50, 200)
    const offset = Number(query.offset) || 0
    const runId         = query.run_id as string | undefined
    const recommendation = query.recommendation as string | undefined
    const province      = query.province as string | undefined
    const propertyKey   = query.property_key as string | undefined

    const conditions: string[] = ['is_deleted = 0']
    const params: unknown[] = []

    if (runId)          { conditions.push('run_id = ?');           params.push(runId) }
    if (recommendation) { conditions.push('recommendation = ?');   params.push(recommendation) }
    if (province)       { conditions.push('province = ?');         params.push(province) }
    if (propertyKey)    { conditions.push('property_key = ?');     params.push(propertyKey) }

    const where = conditions.join(' AND ')
    const [items, countResult] = await Promise.all([
      d1.select(
        `SELECT id, run_id, address, municipality, province, property_key,
                minimum_bid, assessed_value, estimated_value, recommended_bid,
                score, recommendation, rationale, risks, opportunities, source_url,
                details, created_at
         FROM hunter_properties
         WHERE ${where}
         ORDER BY score DESC, recommendation, created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      d1.select<{ n: number }>(
        `SELECT COUNT(*) as n FROM hunter_properties WHERE ${where}`,
        params
      ),
    ])
    return { items, total: countResult[0]?.n ?? 0, limit, offset }
  },

  async get(_db: Database, id: string) {
    const d1 = getD1Client()!
    const rows = await d1.select(
      `SELECT * FROM hunter_properties WHERE id = ? AND is_deleted = 0`,
      [id]
    )
    return rows[0] ?? null
  },

  async create(_db: Database, body: Record<string, unknown>) {
    const d1 = getD1Client()!
    const { id, run_id, address, province } = body
    if (!id || !run_id || !address || !province) {
      throw new Error('id, run_id, address, province are required')
    }
    const createdAt = Math.floor(Date.now() / 1000)
    await d1.execute(
      `INSERT OR REPLACE INTO hunter_properties
         (id, run_id, address, municipality, province, property_key, source_url,
          minimum_bid, assessed_value, estimated_value, recommended_bid,
          score, recommendation, rationale, risks, opportunities, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, run_id, address,
        body.municipality ?? null, province, body.property_key ?? null,
        body.source_url ?? null,
        body.minimum_bid ?? null, body.assessed_value ?? null,
        body.estimated_value ?? null, body.recommended_bid ?? null,
        body.score ?? null, body.recommendation ?? null,
        body.rationale ?? null,
        typeof body.risks === 'string' ? body.risks : JSON.stringify(body.risks ?? []),
        typeof body.opportunities === 'string' ? body.opportunities : JSON.stringify(body.opportunities ?? []),
        typeof body.details === 'string' ? body.details : JSON.stringify(body.details ?? {}),
        createdAt,
      ]
    )
    return { id: id as string }
  },

  async update(_db: Database, id: string, body: Record<string, unknown>) {
    const d1 = getD1Client()!
    const allowed = ['recommendation', 'score', 'rationale', 'notes']
    const sets: string[] = []
    const params: unknown[] = []
    for (const key of allowed) {
      if (key in body) { sets.push(`${key} = ?`); params.push(body[key]) }
    }
    if (!sets.length) return { ok: true as const }
    params.push(id)
    await d1.execute(`UPDATE hunter_properties SET ${sets.join(', ')} WHERE id = ?`, params)
    return { ok: true as const }
  },

  async delete(_db: Database, id: string) {
    const d1 = getD1Client()!
    await d1.execute(`UPDATE hunter_properties SET is_deleted = 1 WHERE id = ?`, [id])
    return { ok: true as const }
  },
}

// ─── SQLite fallback implementation ──────────────────────────────────────────

const sqliteHunterPropertiesResource: ResourceHandler = {
  list(db: Database, query: ListQuery) {
    const limit = Math.min(Number(query.limit) || 50, 200)
    const offset = Number(query.offset) || 0
    const runId         = query.run_id as string | undefined
    const recommendation = query.recommendation as string | undefined
    const province      = query.province as string | undefined
    const propertyKey   = query.property_key as string | undefined

    const conditions: string[] = ['is_deleted = 0']
    const params: unknown[] = []

    if (runId)          { conditions.push('run_id = ?');           params.push(runId) }
    if (recommendation) { conditions.push('recommendation = ?');   params.push(recommendation) }
    if (province)       { conditions.push('province = ?');         params.push(province) }
    if (propertyKey)    { conditions.push('property_key = ?');     params.push(propertyKey) }

    const where = conditions.join(' AND ')
    const items = db.prepare(
      `SELECT id, run_id, address, municipality, province, property_key,
              minimum_bid, assessed_value, estimated_value, recommended_bid,
              score, recommendation, rationale, risks, opportunities, source_url,
              details, created_at
       FROM hunter_properties
       WHERE ${where}
       ORDER BY score DESC, recommendation, created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as unknown[]

    const total = (db.prepare(
      `SELECT COUNT(*) as n FROM hunter_properties WHERE ${where}`
    ).get(...params) as { n: number }).n

    return { items, total, limit, offset }
  },

  get(db: Database, id: string) {
    return db.prepare(
      `SELECT * FROM hunter_properties WHERE id = ? AND is_deleted = 0`
    ).get(id) ?? null
  },

  create(db: Database, body: Record<string, unknown>) {
    const { id, run_id, address, province } = body
    if (!id || !run_id || !address || !province) {
      throw new Error('id, run_id, address, province are required')
    }
    db.prepare(
      `INSERT OR REPLACE INTO hunter_properties
         (id, run_id, address, municipality, province, property_key, source_url,
          minimum_bid, assessed_value, estimated_value, recommended_bid,
          score, recommendation, rationale, risks, opportunities, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, run_id, address,
      body.municipality ?? null, province, body.property_key ?? null,
      body.source_url ?? null,
      body.minimum_bid ?? null, body.assessed_value ?? null,
      body.estimated_value ?? null, body.recommended_bid ?? null,
      body.score ?? null, body.recommendation ?? null,
      body.rationale ?? null,
      typeof body.risks === 'string' ? body.risks : JSON.stringify(body.risks ?? []),
      typeof body.opportunities === 'string' ? body.opportunities : JSON.stringify(body.opportunities ?? []),
      typeof body.details === 'string' ? body.details : JSON.stringify(body.details ?? {}),
    )
    return { id: id as string }
  },

  update(db: Database, id: string, body: Record<string, unknown>) {
    const allowed = ['recommendation', 'score', 'rationale', 'notes']
    const sets: string[] = []
    const params: unknown[] = []
    for (const key of allowed) {
      if (key in body) { sets.push(`${key} = ?`); params.push(body[key]) }
    }
    if (!sets.length) return { ok: true as const }
    params.push(id)
    db.prepare(`UPDATE hunter_properties SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return { ok: true as const }
  },

  delete(db: Database, id: string) {
    db.prepare(`UPDATE hunter_properties SET is_deleted = 1 WHERE id = ?`).run(id)
    return { ok: true as const }
  },
}

// ─── Export: use D1 if credentials present, otherwise SQLite ─────────────────

export const hunterPropertiesResource: ResourceHandler = getD1Client()
  ? d1HunterPropertiesResource
  : sqliteHunterPropertiesResource
