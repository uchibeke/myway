/**
 * Memory store — long-term facts, preferences, and events persisted beyond sessions.
 *
 * app_id = null means "global" — personality signals readable by all apps.
 * Memories are append-only (soft delete only). Use personality_state for
 * mutable signals (mood, streak, etc.); use memories for immutable log entries.
 */

import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'

export type MemoryType =
  | 'preference'
  | 'fact'
  | 'event'
  | 'personality'
  | 'skill_event'
  | 'chat_summary'
  | 'artifact_ref'

export interface Memory {
  id: string
  appId: string | null
  type: MemoryType
  content: string
  metadata: Record<string, unknown>
  embeddingId: string | null
  createdAt: number
}

export interface AddMemoryOpts {
  /** null = global memory, readable by all apps */
  appId?: string | null
  type: MemoryType
  content: string
  metadata?: Record<string, unknown>
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** All non-deleted memories for an app, newest first. */
export function getMemories(
  db: Database,
  appId: string,
  type?: MemoryType,
  limit = 50,
): Memory[] {
  const rows = type
    ? (db.prepare(`
        SELECT id, app_id, type, content, metadata, embedding_id, created_at
        FROM memories
        WHERE app_id = ? AND type = ? AND is_deleted = 0
        ORDER BY created_at DESC LIMIT ?
      `).all(appId, type, limit) as RawMemory[])
    : (db.prepare(`
        SELECT id, app_id, type, content, metadata, embedding_id, created_at
        FROM memories
        WHERE app_id = ? AND is_deleted = 0
        ORDER BY created_at DESC LIMIT ?
      `).all(appId, limit) as RawMemory[])

  return rows.map(toMemory)
}

/** Global memories (app_id IS NULL), optionally filtered by type. */
export function getGlobalMemories(
  db: Database,
  type?: MemoryType,
  limit = 50,
): Memory[] {
  const rows = type
    ? (db.prepare(`
        SELECT id, app_id, type, content, metadata, embedding_id, created_at
        FROM memories
        WHERE app_id IS NULL AND type = ? AND is_deleted = 0
        ORDER BY created_at DESC LIMIT ?
      `).all(type, limit) as RawMemory[])
    : (db.prepare(`
        SELECT id, app_id, type, content, metadata, embedding_id, created_at
        FROM memories
        WHERE app_id IS NULL AND is_deleted = 0
        ORDER BY created_at DESC LIMIT ?
      `).all(limit) as RawMemory[])

  return rows.map(toMemory)
}

/**
 * Combined: app-specific + global memories, oldest-first for AI context injection.
 * This is the main function for building context: an app gets its own memories
 * plus global personality signals in a single query.
 */
export function getContextMemories(
  db: Database,
  appId: string,
  limit = 30,
): Memory[] {
  const rows = db.prepare(`
    SELECT id, app_id, type, content, metadata, embedding_id, created_at
    FROM memories
    WHERE (app_id = ? OR app_id IS NULL) AND is_deleted = 0
    ORDER BY created_at DESC LIMIT ?
  `).all(appId, limit) as RawMemory[]

  return rows.map(toMemory).reverse() // oldest-first for AI context
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export function addMemory(db: Database, opts: AddMemoryOpts): string {
  const id = randomUUID()
  db.prepare(`
    INSERT INTO memories (id, app_id, type, content, metadata)
    VALUES (@id, @appId, @type, @content, @metadata)
  `).run({
    id,
    appId: opts.appId ?? null,
    type: opts.type,
    content: opts.content,
    metadata: JSON.stringify(opts.metadata ?? {}),
  })
  return id
}

export function softDelete(db: Database, id: string): void {
  db.prepare(`UPDATE memories SET is_deleted = 1 WHERE id = ?`).run(id)
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface RawMemory {
  id: string
  app_id: string | null
  type: string
  content: string
  metadata: string
  embedding_id: string | null
  created_at: number
}

function toMemory(r: RawMemory): Memory {
  return {
    id: r.id,
    appId: r.app_id,
    type: r.type as MemoryType,
    content: r.content,
    metadata: JSON.parse(r.metadata ?? '{}') as Record<string, unknown>,
    embeddingId: r.embedding_id,
    createdAt: r.created_at,
  }
}
