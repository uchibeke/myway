/**
 * content-store — unified storage layer for markdown content (notes, recipes, etc.).
 *
 * Dual-mode:
 *   - Self-hosted (MYWAY_ROOT set): markdown files with optional YAML frontmatter
 *   - Hosted (no MYWAY_ROOT):       rows in the tenant SQLite DB
 *
 * Each content type registers a ContentDef that describes its schema.
 * Route handlers call the store with a DB handle (hosted) or without (filesystem).
 *
 * SERVER ONLY.
 */

import fs from 'fs'
import path from 'path'
import type { Database } from 'better-sqlite3'
import { isTenantUser } from '@/lib/hosted-storage'

// ─── Registry ─────────────────────────────────────────────────────────────────

export interface ContentDef {
  /** DB table name (e.g. 'notes', 'recipes') */
  table: string
  /** Subdirectory under MYWAY_ROOT for filesystem mode (e.g. 'notes', 'vault/recipes') */
  fsSubdir: string
  /** Extra columns beyond the base set (id, title, content, tags, created_at, updated_at, is_deleted) */
  extraColumns?: string[]
}

export interface ContentItem {
  id: string
  title: string
  preview: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
  /** Any extra fields (color, cook_time, servings, etc.) */
  [key: string]: unknown
}

export type ContentCreateOpts = {
  content: string
  tags?: string[]
  title?: string
  /** Extra DB columns to set (e.g. { color: 'blue', cook_time: '30 min' }) */
  extra?: Record<string, string | null>
}

export type ContentUpdateOpts = ContentCreateOpts

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function extractTitle(content: string): string {
  const h1 = content.match(/^#\s+(.+)/m)
  return h1
    ? h1[1].trim()
    : (content.split('\n').find((l) => l.trim()) ?? '').slice(0, 60) || 'Untitled'
}

export function extractPreview(content: string): string {
  return content
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*|__|\*|_|~~|`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
    .slice(0, 200)
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .trim() || 'item'
}

export function makeId(title?: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const slug = title ? slugify(title) : 'item'
  return `${date}-${slug}-${Date.now().toString(36)}`
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

export function parseFrontmatter(raw: string): {
  fields: Record<string, string | string[]>
  body: string
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return { fields: {}, body: raw }

  const fm = match[1]
  const fields: Record<string, string | string[]> = {}

  // Parse tags: [...]
  const tagsLine = fm.match(/tags:\s*\[([^\]]*)\]/)
  if (tagsLine) {
    fields.tags = tagsLine[1].split(',').map((t) => t.trim().replace(/['"]/g, '')).filter(Boolean)
  }

  // Parse simple key: value lines
  for (const line of fm.split('\n')) {
    const kv = line.match(/^(\w[\w_]*):\s*['"]?(.+?)['"]?\s*$/)
    if (kv && kv[1] !== 'tags') {
      fields[kv[1]] = kv[2]
    }
  }

  return { fields, body: raw.slice(match[0].length) }
}

export function buildFrontmatter(fields: Record<string, string | string[] | undefined>): string {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined && v !== null)
  if (entries.length === 0) return ''

  const lines = ['---']
  for (const [key, val] of entries) {
    if (Array.isArray(val)) {
      if (val.length > 0) lines.push(`${key}: [${val.map((t) => `"${t}"`).join(', ')}]`)
    } else if (val) {
      lines.push(`${key}: ${val}`)
    }
  }
  lines.push('---', '')
  return lines.join('\n')
}

// ─── Mode detection ───────────────────────────────────────────────────────────

/**
 * True when content should be stored in DB rows instead of the filesystem.
 * Delegates to isTenantUser() — the single authoritative check.
 */
export function useDbStorage(tenantId?: string): boolean {
  return isTenantUser({ tenantId })
}

// ─── DB operations ────────────────────────────────────────────────────────────

export function dbList(db: Database, def: ContentDef): ContentItem[] {
  const extraCols = def.extraColumns?.length ? ', ' + def.extraColumns.join(', ') : ''
  const rows = db.prepare(`
    SELECT id, title, content, tags, created_at, updated_at${extraCols}
    FROM ${def.table} WHERE is_deleted = 0
    ORDER BY updated_at DESC
  `).all() as Array<Record<string, unknown>>

  return rows.map((r) => rowToItem(r, def))
}

export function dbGet(db: Database, def: ContentDef, id: string): ContentItem | null {
  const extraCols = def.extraColumns?.length ? ', ' + def.extraColumns.join(', ') : ''
  const r = db.prepare(`
    SELECT id, title, content, tags, created_at, updated_at${extraCols}
    FROM ${def.table} WHERE id = ? AND is_deleted = 0
  `).get(id) as Record<string, unknown> | undefined

  return r ? rowToItem(r, def) : null
}

export function dbCreate(db: Database, def: ContentDef, opts: ContentCreateOpts): ContentItem {
  const title = opts.title || extractTitle(opts.content)
  const id = makeId(title)
  const now = Math.floor(Date.now() / 1000)
  const tags = JSON.stringify(opts.tags ?? [])

  const extraNames = def.extraColumns ?? []
  const extraPlaceholders = extraNames.length ? ', ' + extraNames.map(() => '?').join(', ') : ''
  const extraColNames = extraNames.length ? ', ' + extraNames.join(', ') : ''
  const extraValues = extraNames.map((col) => opts.extra?.[col] ?? null)

  db.prepare(`
    INSERT INTO ${def.table} (id, title, content, tags, created_at, updated_at${extraColNames})
    VALUES (?, ?, ?, ?, ?, ?${extraPlaceholders})
  `).run(id, title, opts.content, tags, now, now, ...extraValues)

  return {
    id, title, content: opts.content,
    preview: extractPreview(opts.content),
    tags: opts.tags ?? [],
    createdAt: now, updatedAt: now,
    ...Object.fromEntries(extraNames.map((col) => [camelCase(col), opts.extra?.[col] ?? undefined])),
  }
}

export function dbUpdate(db: Database, def: ContentDef, id: string, opts: ContentUpdateOpts): ContentItem | null {
  const title = opts.title || extractTitle(opts.content)
  const now = Math.floor(Date.now() / 1000)
  const tags = JSON.stringify(opts.tags ?? [])

  const extraNames = def.extraColumns ?? []
  const extraSets = extraNames.length ? ', ' + extraNames.map((col) => `${col} = ?`).join(', ') : ''
  const extraValues = extraNames.map((col) => opts.extra?.[col] ?? null)

  const result = db.prepare(`
    UPDATE ${def.table} SET title = ?, content = ?, tags = ?, updated_at = ?${extraSets}
    WHERE id = ? AND is_deleted = 0
  `).run(title, opts.content, tags, now, ...extraValues, id)

  if (result.changes === 0) return null

  return {
    id, title, content: opts.content,
    preview: extractPreview(opts.content),
    tags: opts.tags ?? [],
    createdAt: 0,
    updatedAt: now,
    ...Object.fromEntries(extraNames.map((col) => [camelCase(col), opts.extra?.[col] ?? undefined])),
  }
}

export function dbDelete(db: Database, def: ContentDef, id: string): boolean {
  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(`
    UPDATE ${def.table} SET is_deleted = 1, updated_at = ? WHERE id = ? AND is_deleted = 0
  `).run(now, id)
  return result.changes > 0
}

// ─── Filesystem operations ────────────────────────────────────────────────────

export function fsList(rootDir: string, def: ContentDef, parseFn: (filePath: string) => ContentItem): ContentItem[] {
  const dir = path.join(rootDir, def.fsSubdir)
  if (!fs.existsSync(dir)) return []

  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .flatMap((f) => {
        try { return [parseFn(path.join(dir, f))] } catch { return [] }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export function fsGet(rootDir: string, def: ContentDef, id: string, parseFn: (filePath: string) => ContentItem): ContentItem | null {
  const dir = path.join(rootDir, def.fsSubdir)
  const filePath = path.join(dir, `${id}.md`)
  if (!fs.existsSync(filePath)) return null

  try { return parseFn(filePath) } catch { return null }
}

export function fsWrite(rootDir: string, def: ContentDef, id: string, fileContent: string): void {
  const dir = path.join(rootDir, def.fsSubdir)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${id}.md`), fileContent, 'utf-8')
}

export function fsDelete(rootDir: string, def: ContentDef, id: string): boolean {
  const dir = path.join(rootDir, def.fsSubdir)
  const filePath = path.join(dir, `${id}.md`)
  if (!fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  return true
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowToItem(r: Record<string, unknown>, def: ContentDef): ContentItem {
  const item: ContentItem = {
    id: r.id as string,
    title: r.title as string,
    preview: extractPreview(r.content as string),
    content: r.content as string,
    tags: JSON.parse((r.tags as string) || '[]'),
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  }
  for (const col of def.extraColumns ?? []) {
    const val = r[col]
    item[camelCase(col)] = val === null ? undefined : val
  }
  return item
}

function camelCase(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}
