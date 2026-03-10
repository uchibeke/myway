/**
 * Content Registry — single source of truth for all markdown content types.
 *
 * Each content type (notes, recipes, etc.) registers here with:
 *   - A ContentDef (DB table, filesystem subdir, extra columns)
 *   - Optional filesystem parse/build helpers
 *
 * The unified content API (content-api.ts) and action block handler
 * (content-actions.ts) look up content types from this registry.
 *
 * Adding a new content type:
 *   1. Add a migration for the DB table
 *   2. Register one entry here
 *   3. That's it — CRUD API, action blocks, and context injection all work
 *
 * SERVER ONLY.
 */

import fs from 'fs'
import path from 'path'
import type { ContentDef, ContentItem } from '@/lib/content-store'
import {
  extractTitle, extractPreview, parseFrontmatter, buildFrontmatter,
} from '@/lib/content-store'

// ─── Types ──────────────────────────────────────────────────────────────────

export type ContentTypeConfig = {
  def: ContentDef
  /** Parse a .md file into a ContentItem (filesystem reads). */
  parseFile: (filePath: string) => ContentItem
  /** Build a .md file string from content + metadata (filesystem writes). */
  buildFile: (content: string, tags: string[], extra: Record<string, string | undefined>) => string
  /** Map extra columns from API body keys → DB column names. */
  extraFieldMap: Record<string, string>
}

// ─── Filesystem helpers ─────────────────────────────────────────────────────

function defaultParseFile(def: ContentDef, filePath: string): ContentItem {
  const id = path.basename(filePath, '.md')
  const raw = fs.readFileSync(filePath, 'utf-8')
  const stat = fs.statSync(filePath)
  const { fields, body } = parseFrontmatter(raw)

  const tags = Array.isArray(fields.tags) ? fields.tags : []
  const fmTitle = typeof fields.title === 'string' ? fields.title : undefined
  const title = fmTitle || extractTitle(body) || 'Untitled'

  const item: ContentItem = {
    id,
    title,
    preview: extractPreview(body),
    content: body,
    tags,
    createdAt: Math.floor(stat.birthtimeMs / 1000),
    updatedAt: Math.floor(stat.mtimeMs / 1000),
  }

  // Extract extra columns from frontmatter
  for (const col of def.extraColumns ?? []) {
    const val = fields[col]
    if (typeof val === 'string') item[col] = val
  }

  return item
}

function defaultBuildFile(content: string, tags: string[], extra: Record<string, string | undefined>): string {
  const fm = buildFrontmatter({ tags, ...extra })
  return fm + content
}

// ─── Registry ───────────────────────────────────────────────────────────────

const REGISTRY = new Map<string, ContentTypeConfig>()

export function registerContentType(type: string, config: ContentTypeConfig): void {
  REGISTRY.set(type, config)
}

export function getContentType(type: string): ContentTypeConfig | undefined {
  return REGISTRY.get(type)
}

export function getRegisteredTypes(): string[] {
  return Array.from(REGISTRY.keys())
}

// ─── Built-in types ─────────────────────────────────────────────────────────

const NOTES_DEF: ContentDef = {
  table: 'notes',
  fsSubdir: 'notes',
  extraColumns: ['color'],
}

const RECIPES_DEF: ContentDef = {
  table: 'recipes',
  fsSubdir: path.join('vault', 'recipes'),
  extraColumns: ['cook_time', 'servings'],
}

registerContentType('notes', {
  def: NOTES_DEF,
  parseFile: (filePath) => defaultParseFile(NOTES_DEF, filePath),
  buildFile: (content, tags, extra) => defaultBuildFile(content, tags, { color: extra.color }),
  extraFieldMap: { color: 'color' },
})

registerContentType('recipes', {
  def: RECIPES_DEF,
  parseFile: (filePath) => {
    const item = defaultParseFile(RECIPES_DEF, filePath)
    // Normalize cook_time aliases
    if (!item.cook_time && item.cooktime) {
      item.cook_time = item.cooktime
    }
    return item
  },
  buildFile: (content, tags, extra) =>
    defaultBuildFile(content, tags, {
      title: extra.title,
      cook_time: extra.cookTime ?? extra.cook_time,
      servings: extra.servings,
    }),
  extraFieldMap: { cookTime: 'cook_time', servings: 'servings' },
})
