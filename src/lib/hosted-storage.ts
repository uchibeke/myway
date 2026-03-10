/**
 * Hosted Storage — artifact-backed file storage for hosted (multi-tenant) users.
 *
 * Self-hosted users get direct filesystem access via MYWAY_ROOT.
 * Hosted users don't have a server directory — their files live in the
 * artifact store (content-addressed, tenant-isolated, DB-tracked).
 *
 * Limits (hosted only):
 *   - 100 MB total per user
 *   - 10 MB per file
 *   - 500 files max
 *   - Blocked types: archives, binaries, video (abuse vectors)
 */

import type { Database } from 'better-sqlite3'
import { extname } from 'path'
import { getCategory, type FileCategory } from '@/lib/file-types'
import { storeArtifact, listArtifacts, getArtifact, softDelete } from '@/lib/store/artifacts'

// ─── Limits ──────────────────────────────────────────────────────────────────

export const HOSTED_MAX_TOTAL_BYTES = 100 * 1024 * 1024  // 100 MB
export const HOSTED_MAX_FILE_BYTES = 10 * 1024 * 1024    // 10 MB
export const HOSTED_MAX_FILES = 500

/** Categories blocked for hosted uploads. */
const BLOCKED_CATEGORIES: Set<FileCategory> = new Set(['archive', 'binary', 'video'])

/** Check if a file extension is allowed for hosted upload. */
export function isAllowedType(filename: string): boolean {
  const ext = extname(filename).toLowerCase()
  if (!ext) return false
  const category = getCategory(ext)
  return !BLOCKED_CATEGORIES.has(category)
}

// ─── Hosted mode detection ───────────────────────────────────────────────────

/**
 * True when the instance is running in hosted/platform mode.
 *
 * Detected by any of:
 *   - MYWAY_PARTNER_APPROOM_SECRET — AppRoom partnership (multi-tenant SaaS)
 *   - MYWAY_API_TOKEN              — single-tenant hosted with API key auth
 *   - MYWAY_BASE_DOMAIN            — shared domain deployment (e.g. myway.sh)
 */
export function isHostedMode(): boolean {
  return !!(
    process.env.MYWAY_PARTNER_APPROOM_SECRET?.trim() ||
    process.env.MYWAY_API_TOKEN?.trim() ||
    process.env.MYWAY_BASE_DOMAIN?.trim()
  )
}

/**
 * THE single authoritative check for whether the current context is a
 * tenant / hosted user — meaning local and workspace files must NOT be
 * accessed.
 *
 * Accepts whatever context the call-site has available:
 *
 *   isTenantUser({ db })        — library code that already holds a handle
 *   isTenantUser({ tenantId })  — API routes before DB is opened
 *   isTenantUser()              — falls back to server-level env vars
 *
 * Returns true when ANY of:
 *   1. Server is in hosted mode (env vars)
 *   2. A tenantId was provided (extracted from session / request)
 *   3. The DB is a per-tenant database (path contains /tenants/)
 *
 * Use this instead of isHostedMode() wherever you guard filesystem access.
 * Keep isHostedMode() only for server-level feature flags (quotas, admin).
 */
export function isTenantUser(
  ctx?: { db?: Database; tenantId?: string },
): boolean {
  if (isHostedMode()) return true
  if (ctx?.tenantId) return true
  if (ctx?.db) {
    try {
      // Tenant DBs live at .../tenants/{userId}/myway.db
      // The default self-hosted DB lives at .../myway.db (no /tenants/ segment)
      return ctx.db.name.includes('/tenants/')
    } catch { /* fallback to false */ }
  }
  return false
}

/**
 * True when this request should use artifact-backed storage.
 * Self-hosted users with MYWAY_ROOT always use filesystem.
 * Hosted users (no MYWAY_ROOT) use artifact store.
 */
export function useArtifactStorage(): boolean {
  return isHostedMode() && !process.env.MYWAY_ROOT?.trim()
}

// ─── Quota ───────────────────────────────────────────────────────────────────

export type StorageUsage = {
  totalBytes: number
  fileCount: number
  remainingBytes: number
  remainingFiles: number
  percentUsed: number
}

/** Get current storage usage for a user (from artifacts table). */
export function getStorageUsage(db: Database): StorageUsage {
  const row = db.prepare(`
    SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes,
           COUNT(*) AS file_count
    FROM artifacts
    WHERE app_id = 'files' AND is_deleted = 0
  `).get() as { total_bytes: number; file_count: number }

  const totalBytes = row.total_bytes
  const fileCount = row.file_count

  return {
    totalBytes,
    fileCount,
    remainingBytes: Math.max(0, HOSTED_MAX_TOTAL_BYTES - totalBytes),
    remainingFiles: Math.max(0, HOSTED_MAX_FILES - fileCount),
    percentUsed: Math.round((totalBytes / HOSTED_MAX_TOTAL_BYTES) * 100),
  }
}

export type QuotaCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string }

/** Check if a file can be uploaded within quota limits. */
export function checkQuota(db: Database, fileSize: number, filename: string): QuotaCheckResult {
  if (fileSize > HOSTED_MAX_FILE_BYTES) {
    return {
      allowed: false,
      reason: `File exceeds 10 MB limit (${(fileSize / 1024 / 1024).toFixed(1)} MB)`,
    }
  }

  if (!isAllowedType(filename)) {
    const ext = extname(filename).toLowerCase()
    const category = getCategory(ext)
    return {
      allowed: false,
      reason: `File type not allowed: ${category} files (${ext})`,
    }
  }

  const usage = getStorageUsage(db)

  if (usage.remainingFiles <= 0) {
    return {
      allowed: false,
      reason: `File limit reached (${HOSTED_MAX_FILES} files). Delete some files to upload more.`,
    }
  }

  if (fileSize > usage.remainingBytes) {
    return {
      allowed: false,
      reason: `Storage quota exceeded. ${(usage.remainingBytes / 1024 / 1024).toFixed(1)} MB remaining of ${HOSTED_MAX_TOTAL_BYTES / 1024 / 1024} MB.`,
    }
  }

  return { allowed: true }
}

// ─── File operations (artifact-backed) ───────────────────────────────────────

export type HostedFile = {
  id: string
  name: string
  path: string
  type: 'file'
  size: number
  modified: string
  ext: string | null
  category: FileCategory | null
  mimeType: string | null
}

/** List all files for the user. */
export function listHostedFiles(
  db: Database,
  limit = 100,
): HostedFile[] {
  const artifacts = listArtifacts(db, 'files', undefined, limit)
  return artifacts.map(a => {
    const ext = extname(a.originalName).toLowerCase() || null
    return {
      id: a.id,
      name: a.originalName,
      path: a.id, // use artifact ID as virtual path
      type: 'file' as const,
      size: a.sizeBytes ?? 0,
      modified: new Date(a.createdAt * 1000).toISOString(),
      ext,
      category: ext ? getCategory(ext) : null,
      mimeType: a.mimeType,
    }
  })
}

/** Upload a file to the artifact store. Returns the artifact ID. */
export function uploadHostedFile(
  db: Database,
  filename: string,
  content: Buffer,
  mimeType?: string,
): { id: string; existed: boolean } {
  const result = storeArtifact(db, {
    appId: 'files',
    originalName: filename,
    content,
    mimeType,
    metadata: { source: 'hosted-upload' },
  })
  return { id: result.id, existed: result.existed }
}

/** Get a single file's metadata. */
export function getHostedFile(db: Database, id: string): HostedFile | null {
  const a = getArtifact(db, id)
  if (!a || a.appId !== 'files') return null
  const ext = extname(a.originalName).toLowerCase() || null
  return {
    id: a.id,
    name: a.originalName,
    path: a.id,
    type: 'file',
    size: a.sizeBytes ?? 0,
    modified: new Date(a.createdAt * 1000).toISOString(),
    ext,
    category: ext ? getCategory(ext) : null,
    mimeType: a.mimeType,
  }
}

/** Delete a hosted file (soft delete). */
export function deleteHostedFile(db: Database, id: string): boolean {
  const a = getArtifact(db, id)
  if (!a || a.appId !== 'files') return false
  softDelete(db, id)
  return true
}
