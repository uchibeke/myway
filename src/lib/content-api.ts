/**
 * Unified Content API — shared CRUD handler for all markdown content types.
 *
 * Routes delegate here instead of duplicating storage logic.
 * The content registry (content-registry.ts) maps type → schema.
 *
 * Handles:
 *   - Tenant ID → DB storage (never expose server filesystem)
 *   - No tenant + MYWAY_ROOT → filesystem storage
 *   - No tenant + no MYWAY_ROOT → DB via artifact storage (hosted-only server)
 *
 * SERVER ONLY.
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import type { Database } from 'better-sqlite3'
import {
  useDbStorage,
  dbList, dbGet, dbCreate, dbUpdate, dbDelete,
  fsList, fsGet, fsWrite, fsDelete,
  makeId, extractTitle,
} from '@/lib/content-store'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { getRoot, isPathAllowed } from '@/lib/fs-config'
import { getContentType, type ContentTypeConfig } from '@/lib/content-registry'

function errorJson(msg: string, status: number) {
  return NextResponse.json({ error: msg }, { status })
}

// ─── Resolve storage context ────────────────────────────────────────────────

type StorageContext =
  | { mode: 'db'; db: Database; tenantId: string | undefined }
  | { mode: 'fs'; root: string }

function resolveStorage(req: NextRequest): StorageContext | { mode: 'error'; response: NextResponse } {
  const tenantId = getTenantId(req)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (useDbStorage(tenantId)) {
    return { mode: 'db', db: getDb(tenantId), tenantId }
  }
  try {
    return { mode: 'fs', root: getRoot() }
  } catch {
    return { mode: 'error', response: errorJson('Storage not configured', 503) }
  }
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export function handleGet(req: NextRequest, config: ContentTypeConfig): NextResponse {
  const id = req.nextUrl.searchParams.get('id')
  const listKey = config.def.table // 'notes', 'recipes', etc. — matches existing API contracts
  const ctx = resolveStorage(req)
  if (ctx.mode === 'error') return ctx.response

  if (ctx.mode === 'db') {
    if (id) {
      const item = dbGet(ctx.db, config.def, id)
      return item ? NextResponse.json(item) : errorJson('Not found', 404)
    }
    return NextResponse.json({ [listKey]: dbList(ctx.db, config.def) })
  }

  // Filesystem
  if (id) {
    const item = fsGet(ctx.root, config.def, id, config.parseFile)
    return item ? NextResponse.json(item) : errorJson('Not found', 404)
  }
  return NextResponse.json({ [listKey]: fsList(ctx.root, config.def, config.parseFile) })
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function handlePost(req: NextRequest, config: ContentTypeConfig): Promise<NextResponse> {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const content = typeof body.content === 'string' ? body.content : ''
  if (!content.trim()) return errorJson('content is required', 400)

  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : []
  const title = typeof body.title === 'string' ? body.title : undefined
  const extra = buildExtra(body, config)

  const ctx = resolveStorage(req)
  if (ctx.mode === 'error') return ctx.response

  if (ctx.mode === 'db') {
    const item = dbCreate(ctx.db, config.def, { content, tags, title, extra })
    return NextResponse.json(item, { status: 201 })
  }

  // Filesystem
  const itemTitle = title || extractTitle(content) || 'Untitled'
  const id = makeId(itemTitle)
  const filePath = path.join(ctx.root, config.def.fsSubdir, `${id}.md`)
  if (!isPathAllowed(filePath)) return errorJson('Access denied', 403)

  const extraForFile: Record<string, string | undefined> = { title: itemTitle }
  for (const [key, col] of Object.entries(config.extraFieldMap)) {
    const val = body[key]
    extraForFile[key] = typeof val === 'string' ? val : undefined
  }
  fsWrite(ctx.root, config.def, id, config.buildFile(content, tags, extraForFile))

  // Re-read to return consistent shape
  const saved = fsGet(ctx.root, config.def, id, config.parseFile)
  return NextResponse.json(saved ?? { id, title: itemTitle }, { status: 201 })
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

export async function handlePut(req: NextRequest, config: ContentTypeConfig): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return errorJson('id is required', 400)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const content = typeof body.content === 'string' ? body.content : ''
  if (!content.trim()) return errorJson('content is required', 400)

  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : []
  const title = typeof body.title === 'string' ? body.title : undefined
  const extra = buildExtra(body, config)

  const ctx = resolveStorage(req)
  if (ctx.mode === 'error') return ctx.response

  if (ctx.mode === 'db') {
    const item = dbUpdate(ctx.db, config.def, id, { content, tags, title, extra })
    return item ? NextResponse.json(item) : errorJson('Not found', 404)
  }

  // Filesystem
  const filePath = path.join(ctx.root, config.def.fsSubdir, `${id}.md`)
  if (!isPathAllowed(filePath)) return errorJson('Access denied', 403)
  if (!fs.existsSync(filePath)) return errorJson('Not found', 404)

  const itemTitle = title || extractTitle(content) || 'Untitled'
  const extraForFile: Record<string, string | undefined> = { title: itemTitle }
  for (const [key] of Object.entries(config.extraFieldMap)) {
    const val = body[key]
    extraForFile[key] = typeof val === 'string' ? val : undefined
  }
  fsWrite(ctx.root, config.def, id, config.buildFile(content, tags, extraForFile))

  const saved = fsGet(ctx.root, config.def, id, config.parseFile)
  return NextResponse.json(saved ?? { id, title: itemTitle })
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export function handleDelete(req: NextRequest, config: ContentTypeConfig): NextResponse {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return errorJson('id is required', 400)

  const ctx = resolveStorage(req)
  if (ctx.mode === 'error') return ctx.response

  if (ctx.mode === 'db') {
    return dbDelete(ctx.db, config.def, id)
      ? NextResponse.json({ ok: true })
      : errorJson('Not found', 404)
  }

  // Filesystem
  const filePath = path.join(ctx.root, config.def.fsSubdir, `${id}.md`)
  if (!isPathAllowed(filePath)) return errorJson('Access denied', 403)

  return fsDelete(ctx.root, config.def, id)
    ? NextResponse.json({ ok: true })
    : errorJson('Not found', 404)
}

// ─── Programmatic create (for action blocks, post-login seeds, etc.) ────────

/**
 * Create a content item programmatically (not from an HTTP request).
 * Used by action block executors and internal code.
 */
export function createContent(
  db: Database,
  type: string,
  data: { content: string; tags?: string[]; title?: string; extra?: Record<string, string | null> },
  tenantId?: string,
): void {
  const config = getContentType(type)
  if (!config) return

  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (useDbStorage(tenantId)) {
    const created = dbCreate(db, config.def, {
      content: data.content,
      tags: data.tags,
      title: data.title,
      extra: data.extra,
    })
    console.log(`[content-api] createContent: inserted ${type} id=${created.id} title="${created.title}" into DB (tenantId=${tenantId ?? 'none'})`)
    // Verify the insert by reading back
    const count = (db.prepare(`SELECT COUNT(*) as cnt FROM ${config.def.table} WHERE is_deleted = 0`).get() as { cnt: number }).cnt
    console.log(`[content-api] createContent: ${config.def.table} table now has ${count} row(s)`)
  } else {
    try {
      const root = getRoot()
      const title = data.title || extractTitle(data.content) || 'Untitled'
      const id = makeId(title)
      const extraForFile: Record<string, string | undefined> = { title }
      for (const [key, col] of Object.entries(config.extraFieldMap)) {
        extraForFile[key] = data.extra?.[col] ?? undefined
      }
      fsWrite(root, config.def, id, config.buildFile(data.content, data.tags ?? [], extraForFile))
    } catch { /* filesystem not configured */ }
  }
}

// ─── Programmatic update ─────────────────────────────────────────────────────

/**
 * Update a content item programmatically.
 * Used by action block executors (AI-driven updates).
 */
export function updateContent(
  db: Database,
  type: string,
  id: string,
  data: { content: string; tags?: string[]; title?: string; extra?: Record<string, string | null> },
  tenantId?: string,
): boolean {
  const config = getContentType(type)
  if (!config) return false

  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (useDbStorage(tenantId)) {
    const updated = dbUpdate(db, config.def, id, {
      content: data.content,
      tags: data.tags,
      title: data.title,
      extra: data.extra,
    })
    if (updated) {
      console.log(`[content-api] updateContent: updated ${type} id=${id} (tenantId=${tenantId ?? 'none'})`)
    }
    return updated !== null
  }

  // Filesystem
  try {
    const root = getRoot()
    const filePath = path.join(root, config.def.fsSubdir, `${id}.md`)
    if (!fs.existsSync(filePath)) return false
    const title = data.title || extractTitle(data.content) || 'Untitled'
    const extraForFile: Record<string, string | undefined> = { title }
    for (const [key, col] of Object.entries(config.extraFieldMap)) {
      extraForFile[key] = data.extra?.[col] ?? undefined
    }
    fsWrite(root, config.def, id, config.buildFile(data.content, data.tags ?? [], extraForFile))
    return true
  } catch {
    return false
  }
}

// ─── Programmatic delete ─────────────────────────────────────────────────────

/**
 * Delete a content item programmatically.
 * Used by action block executors (AI-driven deletes).
 */
export function deleteContent(
  db: Database,
  type: string,
  id: string,
  tenantId?: string,
): boolean {
  const config = getContentType(type)
  if (!config) return false

  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (useDbStorage(tenantId)) {
    const deleted = dbDelete(db, config.def, id)
    if (deleted) {
      console.log(`[content-api] deleteContent: deleted ${type} id=${id} (tenantId=${tenantId ?? 'none'})`)
    }
    return deleted
  }

  // Filesystem
  try {
    const root = getRoot()
    return fsDelete(root, config.def, id)
  } catch {
    return false
  }
}

// ─── Internal ───────────────────────────────────────────────────────────────

function buildExtra(body: Record<string, unknown>, config: ContentTypeConfig): Record<string, string | null> {
  const extra: Record<string, string | null> = {}
  for (const [key, col] of Object.entries(config.extraFieldMap)) {
    const val = body[key]
    extra[col] = typeof val === 'string' ? val : null
  }
  return extra
}
