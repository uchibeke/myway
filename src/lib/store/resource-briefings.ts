/**
 * Briefings resource handler — wraps the briefings store for the unified CRUD API.
 *
 * GET  /api/store/briefings                → list all (newest first)
 * GET  /api/store/briefings?type=morning   → filter by type
 * GET  /api/store/briefings?id=<id>        → single briefing
 * POST /api/store/briefings { action: 'create', type, subject, sections, sentTo, ... }
 */

import type { Database } from 'better-sqlite3'
import type { ResourceHandler, ListQuery } from './registry'
import {
  listBriefings,
  getBriefing,
  addBriefing,
  softDelete,
} from './briefings'
import type { BriefingType } from './briefings'

export const briefingsResource: ResourceHandler = {
  list(db: Database, query: ListQuery) {
    const type = query.type as BriefingType | undefined
    const limit = Number(query.limit) || 20
    const offset = Number(query.offset) || 0
    const items = listBriefings(db, { type, limit, offset })
    return { items }
  },

  get(db: Database, id: string) {
    return getBriefing(db, id) ?? null
  },

  create(db: Database, body: Record<string, unknown>) {
    const { type, subject, sections, sentTo } = body
    if (!type || !subject || !sections || !sentTo) {
      throw new Error('type, subject, sections, and sentTo are required')
    }
    const id = addBriefing(db, body as Parameters<typeof addBriefing>[1])
    return { id }
  },

  update(_db: Database, _id: string, _body: Record<string, unknown>): { ok: true } {
    throw new Error('Briefings are immutable once sent. Cannot update.')
  },

  delete(db: Database, id: string) {
    softDelete(db, id)
    return { ok: true as const }
  },
}
