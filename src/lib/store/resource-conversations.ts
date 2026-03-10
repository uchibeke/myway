/**
 * Store resource handler for conversations.
 * Registered in registry.ts as 'conversations'.
 *
 * GET  /api/store/conversations?appId=<id>&limit=20   — list conversations
 * GET  /api/store/conversations?id=<id>               — single conversation
 * POST /api/store/conversations { action:'delete', id } — soft-delete
 */

import type { Database } from 'better-sqlite3'
import type { ResourceHandler, ListQuery } from './registry'
import {
  getConversation,
  listConversations,
  createConversation,
  setTitle,
  softDelete,
} from './conversations'

export const conversationsResource: ResourceHandler = {
  list(db: Database, query: ListQuery) {
    if (!query.appId) throw new Error('appId is required')
    return listConversations(db, String(query.appId), query.limit ?? 20, query.offset ?? 0)
  },

  get(db: Database, id: string) {
    return getConversation(db, id)
  },

  create(db: Database, body: Record<string, unknown>) {
    if (!body.appId) throw new Error('appId is required')
    const id = createConversation(db, String(body.appId))
    return { id }
  },

  update(db: Database, id: string, body: Record<string, unknown>) {
    if (typeof body.title === 'string') setTitle(db, id, body.title)
    return { ok: true as const }
  },

  delete(db: Database, id: string) {
    softDelete(db, id)
    return { ok: true as const }
  },
}
