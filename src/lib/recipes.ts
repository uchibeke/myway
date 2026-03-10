/**
 * Recipe reader — unified storage for markdown recipes.
 *
 * Dual-mode via content-store:
 *   - Self-hosted: .md files in {MYWAY_ROOT}/vault/recipes/
 *   - Hosted:      rows in the tenant SQLite DB (recipes table)
 *
 * SERVER ONLY — never import in client components.
 */

import fs from 'fs'
import path from 'path'
import type { Database } from 'better-sqlite3'
import { getRoot } from '@/lib/fs-config'
import {
  type ContentDef, type ContentItem,
  useDbStorage, dbList, dbGet, dbCreate,
  fsList, fsGet,
  extractTitle, extractPreview,
  parseFrontmatter,
} from '@/lib/content-store'

export const RECIPES_DEF: ContentDef = {
  table: 'recipes',
  fsSubdir: path.join('vault', 'recipes'),
  extraColumns: ['cook_time', 'servings'],
}

export type Recipe = {
  id: string
  title: string
  preview: string
  content: string
  tags: string[]
  cookTime?: string
  servings?: string
  createdAt: number
  updatedAt: number
}

export type RecipeSummary = Omit<Recipe, 'content'>

// ─── Filesystem parser ────────────────────────────────────────────────────────

function parseRecipeFile(filePath: string): ContentItem {
  const id = path.basename(filePath, '.md')
  const raw = fs.readFileSync(filePath, 'utf-8')
  const stat = fs.statSync(filePath)
  const { fields, body } = parseFrontmatter(raw)

  const tags = Array.isArray(fields.tags) ? fields.tags : []
  const fmTitle = typeof fields.title === 'string' ? fields.title : undefined
  const title = fmTitle || extractTitle(body) || 'Untitled Recipe'

  return {
    id,
    title,
    preview: extractPreview(body),
    content: body,
    tags,
    cookTime: typeof fields.cook_time === 'string' ? fields.cook_time
            : typeof fields.cooktime === 'string' ? fields.cooktime
            : undefined,
    servings: typeof fields.servings === 'string' ? fields.servings : undefined,
    createdAt: Math.floor(stat.birthtimeMs / 1000),
    updatedAt: Math.floor(stat.mtimeMs / 1000),
  }
}

function contentItemToRecipe(item: ContentItem): Recipe {
  return {
    id: item.id,
    title: item.title,
    preview: item.preview,
    content: item.content,
    tags: item.tags,
    cookTime: item.cookTime as string | undefined,
    servings: item.servings as string | undefined,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List all recipes sorted by most recent first.
 * Pass db + tenantId for tenant users (DB storage).
 * Omit both for self-hosted filesystem mode.
 */
export function listRecipes(db?: Database, tenantId?: string): RecipeSummary[] {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (db && useDbStorage(tenantId)) {
    return dbList(db, RECIPES_DEF).map((item) => {
      const r = contentItemToRecipe(item)
      const { content: _, ...summary } = r
      return summary
    })
  }

  let root: string
  try { root = getRoot() } catch { return [] }

  return fsList(root, RECIPES_DEF, parseRecipeFile).map((item) => {
    const r = contentItemToRecipe(item)
    const { content: _, ...summary } = r
    return summary
  })
}

/**
 * Get a single recipe by ID.
 * Pass db + tenantId for tenant users (DB storage).
 * Omit both for self-hosted filesystem mode.
 */
export function getRecipe(id: string, db?: Database, tenantId?: string): Recipe | null {
  // Sanitize ID
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safeId) return null

  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (db && useDbStorage(tenantId)) {
    const item = dbGet(db, RECIPES_DEF, safeId)
    return item ? contentItemToRecipe(item) : null
  }

  let root: string
  try { root = getRoot() } catch { return null }

  const item = fsGet(root, RECIPES_DEF, safeId, parseRecipeFile)
  return item ? contentItemToRecipe(item) : null
}

/**
 * Save a recipe to DB (hosted mode).
 * Used by chat route when AI generates a recipe.
 */
export function saveRecipe(
  db: Database,
  opts: { content: string; tags?: string[]; title?: string; cookTime?: string; servings?: string },
): Recipe {
  const item = dbCreate(db, RECIPES_DEF, {
    content: opts.content,
    tags: opts.tags,
    title: opts.title,
    extra: {
      cook_time: opts.cookTime ?? null,
      servings: opts.servings ?? null,
    },
  })
  return contentItemToRecipe(item)
}

/**
 * Build a concise recipe context string for system prompt injection.
 * Lists recipes as markdown links so the AI can reference them with deep links.
 * Returns null if no recipes exist.
 */
export function buildRecipeContext(db?: Database, limit?: number, tenantId?: string): string | null {
  const all = listRecipes(db, tenantId)
  const recipes = limit ? all.slice(0, limit) : all
  if (recipes.length === 0) return null

  const lines = [`**${recipes.length} recipe${recipes.length !== 1 ? 's' : ''} in your vault:**`]
  for (const r of recipes) {
    const tags = r.tags.length > 0 ? ` [${r.tags.join(', ')}]` : ''
    const time = r.cookTime ? ` · ${r.cookTime}` : ''
    lines.push(`- [${r.title}](/apps/mise?id=${r.id})${time}${tags}`)
  }
  lines.push('> Use the provided links when referencing specific recipes.')
  return lines.join('\n')
}
