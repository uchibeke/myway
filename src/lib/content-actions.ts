/**
 * Unified content action blocks — server-side CRUD driven by AI responses.
 *
 * Apps instruct the AI to append machine-readable action blocks:
 *
 *   <myway:content>{"type":"recipes","action":"save","title":"Pasta","content":"# Pasta\n..."}</myway:content>
 *   <myway:content>{"type":"recipes","action":"update","id":"pasta","title":"Pasta v2","content":"..."}</myway:content>
 *   <myway:content>{"type":"recipes","action":"delete","id":"pasta"}</myway:content>
 *
 * Supported actions:
 *   - save   — create a new item
 *   - update — update an existing item by id
 *   - delete — soft-delete an existing item by id
 *
 * These blocks are:
 *   - Stripped from content before saving to DB / displaying in UI
 *   - Parsed and executed server-side in the chat route's flush() callback
 *
 * Works for ALL registered content types (notes, recipes, future types).
 *
 * SERVER ONLY.
 */

import type { Database } from 'better-sqlite3'
import { createContent, updateContent, deleteContent } from '@/lib/content-api'
import { getContentType } from '@/lib/content-registry'

/** Regex to match <myway:content>…</myway:content> blocks (non-greedy). */
const BLOCK_RE = /<myway:content>([\s\S]*?)<\/myway:content>/g

/**
 * Also match legacy app-specific blocks for backwards compatibility:
 *   <myway:recipe>…</myway:recipe>
 *   <myway:note>…</myway:note>
 */
const LEGACY_RECIPE_RE = /<myway:recipe>([\s\S]*?)<\/myway:recipe>/g
const LEGACY_NOTE_RE = /<myway:note>([\s\S]*?)<\/myway:note>/g

/**
 * Strip all content action blocks from text.
 * Handles both unified and legacy block formats.
 */
export function stripContentActions(text: string): string {
  return text
    .replace(BLOCK_RE, '')
    .replace(LEGACY_RECIPE_RE, '')
    .replace(LEGACY_NOTE_RE, '')
    .replace(/<myway:content>[\s\S]*$/, '')   // incomplete at end of stream
    .replace(/<myway:recipe>[\s\S]*$/, '')
    .replace(/<myway:note>[\s\S]*$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type ContentAction = {
  type?: string                 // content type: 'recipes', 'notes', etc.
  action: 'save' | 'update' | 'delete'
  id?: string                   // required for update/delete
  title?: string
  content?: string              // required for save/update
  tags?: string[]
  [key: string]: unknown        // extra fields (cookTime, servings, color, etc.)
}

/**
 * Parse and execute all content action blocks found in the AI response.
 * Called in the flush() callback after streaming completes.
 */
export function executeContentActions(
  db: Database,
  content: string,
  tenantId?: string,
): void {
  // Unified blocks
  execBlocks(BLOCK_RE, content, db, tenantId)
  // Legacy <myway:recipe> blocks → type: 'recipes'
  execBlocks(LEGACY_RECIPE_RE, content, db, tenantId, 'recipes')
  // Legacy <myway:note> blocks → type: 'notes'
  execBlocks(LEGACY_NOTE_RE, content, db, tenantId, 'notes')
}

function execBlocks(
  re: RegExp,
  text: string,
  db: Database,
  tenantId?: string,
  defaultType?: string,
): void {
  re.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim()) as ContentAction
      const type = parsed.type || defaultType
      if (!type) {
        console.warn('[content-actions] Skipping block: missing type')
        continue
      }

      const config = getContentType(type)
      if (!config) {
        console.warn(`[content-actions] Unknown content type: ${type}`)
        continue
      }

      const action = parsed.action

      // ── Delete ──────────────────────────────────────────────────────────
      if (action === 'delete') {
        if (!parsed.id) {
          console.warn(`[content-actions] Delete requires id for ${type}`)
          continue
        }
        console.log(`[content-actions] Deleting ${type}: id="${parsed.id}" (tenantId=${tenantId ?? 'none'})`)
        const deleted = deleteContent(db, type, parsed.id, tenantId)
        console.log(`[content-actions] Delete ${type} id="${parsed.id}": ${deleted ? 'success' : 'not found'}`)
        continue
      }

      // ── Save & Update both require content ──────────────────────────────
      if (!parsed.content?.trim()) {
        console.warn('[content-actions] Skipping block: missing content', { type, action })
        continue
      }

      // Map extra fields from the action payload to DB column names
      const extra: Record<string, string | null> = {}
      for (const [key, col] of Object.entries(config.extraFieldMap)) {
        const val = parsed[key]
        extra[col] = typeof val === 'string' ? val : null
      }

      // ── Update ──────────────────────────────────────────────────────────
      if (action === 'update') {
        if (!parsed.id) {
          console.warn(`[content-actions] Update requires id for ${type}`)
          continue
        }
        console.log(`[content-actions] Updating ${type}: id="${parsed.id}" (tenantId=${tenantId ?? 'none'})`)
        const updated = updateContent(db, type, parsed.id, {
          content: parsed.content,
          tags: parsed.tags,
          title: parsed.title,
          extra,
        }, tenantId)
        console.log(`[content-actions] Update ${type} id="${parsed.id}": ${updated ? 'success' : 'not found'}`)
        continue
      }

      // ── Save (create) ──────────────────────────────────────────────────
      if (action === 'save') {
        console.log(`[content-actions] Saving ${type}: "${parsed.title}" (tenantId=${tenantId ?? 'none'})`)
        createContent(db, type, {
          content: parsed.content,
          tags: parsed.tags,
          title: parsed.title,
          extra,
        }, tenantId)
        console.log(`[content-actions] Saved ${type}: "${parsed.title}" successfully`)
        continue
      }

      console.warn(`[content-actions] Unknown action: ${action}`)
    } catch (e) {
      console.error('[content-actions] Failed to execute block:', e)
    }
  }
}
