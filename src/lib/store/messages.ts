/**
 * Message store — individual messages within a conversation.
 *
 * role = 'user' | 'assistant'  — normal chat
 * role = 'app'                 — inter-app autonomous message (source_app set)
 * role = 'system'              — system context injected by skill
 *
 * Append-only: soft deletes only (is_deleted = 1), never overwrite.
 */

import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { touchConversation } from './conversations'

export type MessageRole = 'system' | 'user' | 'assistant' | 'app'

export interface Message {
  id: string
  conversationId: string
  appId: string
  role: MessageRole
  content: string
  sourceApp: string | null
  metadata: Record<string, unknown>
  embeddingId: string | null
  createdAt: number
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** All non-deleted messages for a conversation, oldest first (for AI context). */
export function getMessages(
  db: Database,
  conversationId: string,
  limit = 100,
): Message[] {
  const rows = db.prepare(`
    SELECT id, conversation_id, app_id, role, content, source_app,
           metadata, embedding_id, created_at
    FROM messages
    WHERE conversation_id = ? AND is_deleted = 0
    ORDER BY created_at ASC
    LIMIT ?
  `).all(conversationId, limit) as RawMessage[]

  return rows.map(toMessage)
}

/** Recent messages across all conversations for an app (for memory/context). */
export function getRecentByApp(
  db: Database,
  appId: string,
  limit = 50,
): Message[] {
  const rows = db.prepare(`
    SELECT id, conversation_id, app_id, role, content, source_app,
           metadata, embedding_id, created_at
    FROM messages
    WHERE app_id = ? AND is_deleted = 0
    ORDER BY created_at DESC
    LIMIT ?
  `).all(appId, limit) as RawMessage[]

  return rows.map(toMessage).reverse()
}

/** Load last N messages for AI context injection (user+assistant only). */
export function getContextMessages(
  db: Database,
  conversationId: string,
  limit = 20,
): { role: 'user' | 'assistant'; content: string }[] {
  const rows = db.prepare(`
    SELECT role, content
    FROM messages
    WHERE conversation_id = ?
      AND role IN ('user','assistant')
      AND is_deleted = 0
    ORDER BY created_at DESC
    LIMIT ?
  `).all(conversationId, limit) as { role: string; content: string }[]

  return rows
    .reverse()
    .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }))
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export interface AddMessageOpts {
  conversationId: string
  appId: string
  role: MessageRole
  content: string
  sourceApp?: string
  metadata?: Record<string, unknown>
}

export function addMessage(db: Database, opts: AddMessageOpts): string {
  const id = randomUUID()
  db.prepare(`
    INSERT INTO messages
      (id, conversation_id, app_id, role, content, source_app, metadata)
    VALUES
      (@id, @conversationId, @appId, @role, @content, @sourceApp, @metadata)
  `).run({
    id,
    conversationId: opts.conversationId,
    appId: opts.appId,
    role: opts.role,
    content: opts.content,
    sourceApp: opts.sourceApp ?? null,
    metadata: JSON.stringify(opts.metadata ?? {}),
  })

  touchConversation(db, opts.conversationId)
  return id
}

/** Convenience wrappers */
export const addUser = (db: Database, convId: string, appId: string, content: string) =>
  addMessage(db, { conversationId: convId, appId, role: 'user', content })

export const addAssistant = (
  db: Database,
  convId: string,
  appId: string,
  content: string,
  metadata?: Record<string, unknown>,
) =>
  addMessage(db, { conversationId: convId, appId, role: 'assistant', content, metadata })

export const addAppMessage = (
  db: Database,
  convId: string,
  appId: string,
  sourceApp: string,
  content: string,
) => addMessage(db, { conversationId: convId, appId, role: 'app', content, sourceApp })

export function softDelete(db: Database, id: string): void {
  db.prepare(`UPDATE messages SET is_deleted = 1 WHERE id = ?`).run(id)
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface RawMessage {
  id: string
  conversation_id: string
  app_id: string
  role: string
  content: string
  source_app: string | null
  metadata: string
  embedding_id: string | null
  created_at: number
}

function toMessage(r: RawMessage): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    appId: r.app_id,
    role: r.role as MessageRole,
    content: r.content,
    sourceApp: r.source_app,
    metadata: JSON.parse(r.metadata ?? '{}') as Record<string, unknown>,
    embeddingId: r.embedding_id,
    createdAt: r.created_at,
  }
}
