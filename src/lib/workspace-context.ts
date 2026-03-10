/**
 * workspace-context — cached wrapper around profile-sync for AI system prompts.
 *
 * Delegates to profile-sync for the unified DB + OpenClaw file merge.
 * Adds a 5-min TTL cache so high-frequency AI calls don't re-read on every request.
 *
 * SERVER ONLY — never import from 'use client' components.
 */

import type { Database } from 'better-sqlite3'
import { buildWorkspaceContext, getWorkspaceFileContent } from '@/lib/profile-sync'

interface CacheEntry {
  content: string
  loadedAt: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes

/**
 * Returns a combined context block for AI system prompt injection.
 *
 * With db: merges DB profiles + OpenClaw workspace files (DB wins per-field).
 * Without db: falls back to OpenClaw files only (backwards compat).
 *
 * Cached for 5 minutes per mode (db vs file-only).
 * Returns null if no sources have content.
 */
export function getWorkspaceContext(db?: Database): string | null {
  const now = Date.now()
  const cacheKey = db ? 'with_db' : 'file_only'
  const cached = cache.get(cacheKey)
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.content || null
  }

  let combined: string | null

  if (db) {
    combined = buildWorkspaceContext(db)
  } else {
    // File-only mode: read USER.md + IDENTITY.md directly (no DB merge).
    // Used by callers without a db handle (backwards compat).
    const parts: string[] = []
    for (const type of ['user', 'ai'] as const) {
      const content = getWorkspaceFileContent(type, db)
      if (content) {
        const label = type === 'user' ? 'USER.md' : 'IDENTITY.md'
        parts.push(`### ${label}\n${content}`)
      }
    }
    combined = parts.length > 0 ? parts.join('\n\n') : null
  }

  cache.set(cacheKey, { content: combined ?? '', loadedAt: now })
  return combined
}

/** Force-clears the cache. Call after profile edits or workspace file changes. */
export function invalidateWorkspaceCache(): void {
  cache.clear()
}
