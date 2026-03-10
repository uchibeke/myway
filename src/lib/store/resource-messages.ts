/**
 * Store resource handler for messages within a conversation.
 * Registered in registry.ts as 'messages'.
 *
 * GET /api/store/messages?conversationId=<id>&limit=100 — list messages
 * GET /api/store/messages?id=<id>                       — single message
 *
 * Messages are append-only — create/update/delete return not-supported errors.
 * (Writes happen exclusively through /api/openclaw/chat.)
 */

import type { Database } from 'better-sqlite3'
import type { ResourceHandler, ListQuery } from './registry'
import { getMessages, softDelete } from './messages'

function notSupported(): never {
  throw new Error('Direct message writes are not supported. Use /api/openclaw/chat.')
}

export const messagesResource: ResourceHandler = {
  list(db: Database, query: ListQuery) {
    const conversationId = query.conversationId as string | undefined
    if (!conversationId) throw new Error('conversationId is required')
    return getMessages(db, conversationId, query.limit ?? 100)
  },

  get(db: Database, id: string) {
    // Fetch a single message by ID
    const row = db
      .prepare(
        `SELECT id, conversation_id, app_id, role, content, source_app,
                metadata, embedding_id, created_at
         FROM messages WHERE id = ? AND is_deleted = 0`,
      )
      .get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      id: row.id,
      conversationId: row.conversation_id,
      appId: row.app_id,
      role: row.role,
      content: row.content,
      sourceApp: row.source_app,
      metadata: JSON.parse((row.metadata as string) ?? '{}'),
      embeddingId: row.embedding_id,
      createdAt: row.created_at,
    }
  },

  create: notSupported,
  update: notSupported,

  delete(db: Database, id: string) {
    softDelete(db, id)
    return { ok: true as const }
  },
}
