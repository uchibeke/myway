/**
 * Notes context builder — server-side utility for injecting note summaries
 * into the system prompt of any persistent app.
 *
 * Dual-mode via content-store:
 *   - Self-hosted: .md files in {MYWAY_ROOT}/notes/
 *   - Hosted:      rows in the tenant SQLite DB (notes table)
 *
 * SERVER ONLY — never import in client components.
 */

import type { Database } from 'better-sqlite3'
import { getRoot } from '@/lib/fs-config'
import {
  type ContentDef,
  useDbStorage, dbList, fsList,
  extractTitle, extractPreview,
  parseFrontmatter,
} from '@/lib/content-store'
import fs from 'fs'
import path from 'path'

const NOTES_DEF: ContentDef = {
  table: 'notes',
  fsSubdir: 'notes',
  extraColumns: ['color'],
}

function parseNoteFile(filePath: string) {
  const id = path.basename(filePath, '.md')
  const raw = fs.readFileSync(filePath, 'utf-8')
  const stat = fs.statSync(filePath)
  const { fields, body } = parseFrontmatter(raw)

  const tags = Array.isArray(fields.tags) ? fields.tags : []

  return {
    id,
    title: extractTitle(body),
    preview: extractPreview(body),
    content: body,
    tags,
    createdAt: Math.floor(stat.birthtimeMs / 1000),
    updatedAt: Math.floor(stat.mtimeMs / 1000),
  }
}

/**
 * Build a concise notes context string for system prompt injection.
 * Pass db + tenantId for tenant users (DB storage).
 * Omit both for self-hosted filesystem mode.
 * Returns null if no notes exist.
 */
export function buildNotesContext(db?: Database, limit?: number, tenantId?: string): string | null {
  let notes: Array<{ id: string; title: string; preview: string; tags: string[]; updatedAt: number }>

  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (db && useDbStorage(tenantId)) {
    const all = dbList(db, NOTES_DEF)
    notes = limit ? all.slice(0, limit) : all
  } else {
    let root: string
    try { root = getRoot() } catch { return null }
    const all = fsList(root, NOTES_DEF, parseNoteFile)
    notes = limit ? all.slice(0, limit) : all
  }

  if (notes.length === 0) return null

  const lines = [`**${notes.length} note${notes.length !== 1 ? 's' : ''} saved:**`]
  for (const n of notes) {
    const tags = n.tags.length > 0 ? ` [${n.tags.join(', ')}]` : ''
    lines.push(`- [${n.title}](/apps/notes?id=${n.id})${tags}: ${n.preview}`)
  }
  lines.push('> Use the provided links when referencing specific notes.')
  return lines.join('\n')
}
