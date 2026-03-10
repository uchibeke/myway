/**
 * Artifact store — metadata for files produced by apps.
 *
 * Content-addressed by SHA-256: two apps producing the same bytes share
 * one file automatically. Overwrite is structurally impossible.
 *
 * Files live at: MYWAY_DATA_DIR/artifacts/<hash[0:2]>/<hash><ext>
 * Two-level sharding (first 2 hex chars) keeps each directory to ≤256 entries.
 *
 * storeArtifact() is idempotent: same content → returns existing row.
 */

import { createHash } from 'crypto'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join, extname } from 'path'
import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { ARTIFACTS_DIR } from '@/lib/db/config'

export interface Artifact {
  id: string
  appId: string
  conversationId: string | null
  originalName: string
  filePath: string        // relative to ARTIFACTS_DIR
  fileHash: string        // SHA-256 hex
  mimeType: string | null
  sizeBytes: number | null
  metadata: Record<string, unknown>
  createdAt: number
}

export interface StoreArtifactOpts {
  appId: string
  conversationId?: string
  originalName: string
  content: Buffer | string
  mimeType?: string
  metadata?: Record<string, unknown>
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/**
 * Store a file. If the same content already exists (matching SHA-256),
 * returns the existing row without writing to disk again.
 */
export function storeArtifact(
  db: Database,
  opts: StoreArtifactOpts,
): { id: string; filePath: string; existed: boolean } {
  const buf = typeof opts.content === 'string' ? Buffer.from(opts.content) : opts.content
  const hash = createHash('sha256').update(buf).digest('hex')

  // Dedup check — same bytes already stored?
  const existing = db.prepare(`
    SELECT id, file_path FROM artifacts
    WHERE file_hash = ? AND is_deleted = 0 LIMIT 1
  `).get(hash) as { id: string; file_path: string } | undefined

  if (existing) {
    return { id: existing.id, filePath: existing.file_path, existed: true }
  }

  // Shard into <first-2-chars>/<hash><ext>
  const shard = hash.slice(0, 2)
  const ext = extname(opts.originalName) || ''
  const fileName = `${hash}${ext}`
  const relPath = join(shard, fileName)
  const absDir = join(ARTIFACTS_DIR, shard)
  const absPath = join(ARTIFACTS_DIR, relPath)

  mkdirSync(absDir, { recursive: true })
  if (!existsSync(absPath)) writeFileSync(absPath, buf)

  const id = randomUUID()
  db.prepare(`
    INSERT INTO artifacts
      (id, app_id, conversation_id, original_name, file_path,
       file_hash, mime_type, size_bytes, metadata)
    VALUES
      (@id, @appId, @conversationId, @originalName, @filePath,
       @fileHash, @mimeType, @sizeBytes, @metadata)
  `).run({
    id,
    appId: opts.appId,
    conversationId: opts.conversationId ?? null,
    originalName: opts.originalName,
    filePath: relPath,
    fileHash: hash,
    mimeType: opts.mimeType ?? null,
    sizeBytes: buf.length,
    metadata: JSON.stringify(opts.metadata ?? {}),
  })

  return { id, filePath: relPath, existed: false }
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export function getArtifact(db: Database, id: string): Artifact | null {
  const row = db.prepare(`
    SELECT id, app_id, conversation_id, original_name, file_path,
           file_hash, mime_type, size_bytes, metadata, created_at
    FROM artifacts WHERE id = ? AND is_deleted = 0
  `).get(id) as RawArtifact | undefined

  return row ? toArtifact(row) : null
}

export function listArtifacts(
  db: Database,
  appId: string,
  conversationId?: string,
  limit = 50,
): Artifact[] {
  const rows = conversationId
    ? (db.prepare(`
        SELECT id, app_id, conversation_id, original_name, file_path,
               file_hash, mime_type, size_bytes, metadata, created_at
        FROM artifacts
        WHERE app_id = ? AND conversation_id = ? AND is_deleted = 0
        ORDER BY created_at DESC LIMIT ?
      `).all(appId, conversationId, limit) as RawArtifact[])
    : (db.prepare(`
        SELECT id, app_id, conversation_id, original_name, file_path,
               file_hash, mime_type, size_bytes, metadata, created_at
        FROM artifacts
        WHERE app_id = ? AND is_deleted = 0
        ORDER BY created_at DESC LIMIT ?
      `).all(appId, limit) as RawArtifact[])

  return rows.map(toArtifact)
}

export function softDelete(db: Database, id: string): void {
  db.prepare(`UPDATE artifacts SET is_deleted = 1 WHERE id = ?`).run(id)
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface RawArtifact {
  id: string
  app_id: string
  conversation_id: string | null
  original_name: string
  file_path: string
  file_hash: string
  mime_type: string | null
  size_bytes: number | null
  metadata: string
  created_at: number
}

function toArtifact(r: RawArtifact): Artifact {
  return {
    id: r.id,
    appId: r.app_id,
    conversationId: r.conversation_id,
    originalName: r.original_name,
    filePath: r.file_path,
    fileHash: r.file_hash,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    metadata: JSON.parse(r.metadata ?? '{}') as Record<string, unknown>,
    createdAt: r.created_at,
  }
}
