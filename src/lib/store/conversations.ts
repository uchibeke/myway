/**
 * Conversation store — session-level grouping of messages.
 * All writes are synchronous (better-sqlite3).
 */

import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'

export interface Conversation {
  id: string
  appId: string
  title: string | null
  context: Record<string, unknown>
  messageCount: number
  startedAt: number
  lastMessageAt: number | null
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export function getConversation(db: Database, id: string): Conversation | null {
  const row = db.prepare(`
    SELECT id, app_id, title, context, message_count, started_at, last_message_at
    FROM conversations WHERE id = ? AND is_deleted = 0
  `).get(id) as RawConversation | undefined

  return row ? toConversation(row) : null
}

/** Most recent conversations for an app, newest first. Supports offset pagination. */
export function listConversations(
  db: Database,
  appId: string,
  limit = 20,
  offset = 0,
): Conversation[] {
  const rows = db.prepare(`
    SELECT id, app_id, title, context, message_count, started_at, last_message_at
    FROM conversations
    WHERE app_id = ? AND is_deleted = 0
    ORDER BY COALESCE(last_message_at, started_at) DESC
    LIMIT ? OFFSET ?
  `).all(appId, limit, offset) as RawConversation[]

  return rows.map(toConversation)
}

/** Most recent conversation for an app (for context loading). */
export function getLastConversation(db: Database, appId: string): Conversation | null {
  const row = db.prepare(`
    SELECT id, app_id, title, context, message_count, started_at, last_message_at
    FROM conversations
    WHERE app_id = ? AND is_deleted = 0
    ORDER BY COALESCE(last_message_at, started_at) DESC
    LIMIT 1
  `).get(appId) as RawConversation | undefined

  return row ? toConversation(row) : null
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export function createConversation(
  db: Database,
  appId: string,
  context: Record<string, unknown> = {},
): string {
  const id = randomUUID()
  // Auto-register the app if it hasn't been seeded by db:init.
  // INSERT OR IGNORE is a no-op when the row already exists — fully idempotent.
  db.prepare(
    `INSERT OR IGNORE INTO apps (id, name, storage_manifest) VALUES (?, ?, '{}')`
  ).run(appId, appId)
  db.prepare(`
    INSERT INTO conversations (id, app_id, context)
    VALUES (@id, @appId, @context)
  `).run({ id, appId, context: JSON.stringify(context) })
  return id
}

/** Ensure app is registered; create conversation if needed. */
export function ensureConversation(
  db: Database,
  conversationId: string | undefined,
  appId: string,
  context?: Record<string, unknown>,
): string {
  if (conversationId) {
    const existing = getConversation(db, conversationId)
    if (existing && existing.appId === appId) return conversationId
  }
  return createConversation(db, appId, context)
}

export function setTitle(db: Database, id: string, title: string): void {
  db.prepare(`UPDATE conversations SET title = ? WHERE id = ?`).run(title, id)
}

/** Bump last_message_at and increment count — called by messages.add(). */
export function touchConversation(db: Database, id: string): void {
  db.prepare(`
    UPDATE conversations
    SET last_message_at = unixepoch(), message_count = message_count + 1
    WHERE id = ?
  `).run(id)
}

export function softDelete(db: Database, id: string): void {
  db.prepare(`UPDATE conversations SET is_deleted = 1 WHERE id = ?`).run(id)
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface RawConversation {
  id: string
  app_id: string
  title: string | null
  context: string
  message_count: number
  started_at: number
  last_message_at: number | null
}

function toConversation(r: RawConversation): Conversation {
  return {
    id: r.id,
    appId: r.app_id,
    title: r.title,
    context: JSON.parse(r.context ?? '{}') as Record<string, unknown>,
    messageCount: r.message_count,
    startedAt: r.started_at,
    lastMessageAt: r.last_message_at,
  }
}
