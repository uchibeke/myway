/**
 * Context Refs — server-side resolver for on-demand context injection.
 *
 * When a client sends `contextRefs: ['tasks', 'recipes']` alongside a message,
 * this module resolves each ref into detailed context data and returns a
 * formatted string for system prompt injection.
 *
 * Unlike the palette (counts + samples), refs resolve FULL data for the
 * requested sources — giving the AI enough detail to roast, dramatize, or
 * decode based on real user data.
 *
 * The data goes into the system prompt, never the user message bubble.
 *
 * SERVER ONLY — never import in client components.
 */

import type { Database } from 'better-sqlite3'
import { getOpenTasks } from '@/lib/store/tasks'
import { buildRecipeContext } from '@/lib/recipes'
import { buildNotesContext } from '@/lib/notes-context'
import { buildEmailContext, buildCalendarContext } from '@/lib/connections/context'
import { getUserTimezone, formatDueDateInTz } from '@/lib/timezone'
import { isTenantUser } from '@/lib/hosted-storage'
import { readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

// ─── Individual ref resolvers ────────────────────────────────────────────────

type RefResolver = (db: Database, tz: string, tenantId?: string) => string | null

function resolveTasks(db: Database, tz: string): string | null {
  try {
    const tasks = getOpenTasks(db, 20, tz)
    if (tasks.length === 0) return null
    const lines = ['**Your Open Tasks:**']
    for (const t of tasks) {
      const due = t.dueAt
        ? ` — due: ${formatDueDateInTz(t.dueAt, tz, t.dueAtHasTime)}`
        : ''
      lines.push(`- ${t.title} (priority ${t.priority}${due})`)
      if (t.description) lines.push(`  > ${t.description.slice(0, 120)}`)
    }
    return lines.join('\n')
  } catch {
    return null
  }
}

function resolveRecipes(db: Database, _tz: string, tenantId?: string): string | null {
  try {
    return buildRecipeContext(db, undefined, tenantId)
  } catch {
    return null
  }
}

function resolveNotes(db: Database, _tz: string, tenantId?: string): string | null {
  try {
    return buildNotesContext(db, undefined, tenantId)
  } catch {
    return null
  }
}

function resolveMemories(db: Database): string | null {
  try {
    const rows = db.prepare(`
      SELECT type, content, app_id FROM memories
      WHERE is_deleted = 0
      ORDER BY created_at DESC
      LIMIT 20
    `).all() as { type: string; content: string; app_id: string | null }[]
    if (rows.length === 0) return null
    const lines = [`**${rows.length} memories:**`]
    for (const m of rows) {
      const scope = m.app_id ? ` (${m.app_id})` : ' (global)'
      lines.push(`- [${m.type}${scope}] ${m.content}`)
    }
    return lines.join('\n')
  } catch {
    return null
  }
}

function resolveEmail(db: Database): string | null {
  try {
    return buildEmailContext(db, 10)
  } catch {
    return null
  }
}

function resolveCalendar(db: Database, tz: string): string | null {
  try {
    return buildCalendarContext(db, 2, tz)
  } catch {
    return null
  }
}

function resolveConversations(db: Database): string | null {
  try {
    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400
    const rows = db.prepare(`
      SELECT c.app_id, c.title, c.message_count,
             COALESCE(c.last_message_at, c.started_at) as last_at
      FROM conversations c
      WHERE c.is_deleted = 0 AND COALESCE(c.last_message_at, c.started_at) > ?
      ORDER BY last_at DESC
      LIMIT 15
    `).all(weekAgo) as { app_id: string; title: string | null; message_count: number; last_at: number }[]
    if (rows.length === 0) return null
    const lines = [`**${rows.length} recent conversations (past week):**`]
    for (const c of rows) {
      const name = c.app_id.charAt(0).toUpperCase() + c.app_id.slice(1)
      const title = c.title ? `: ${c.title}` : ''
      lines.push(`- ${name}${title} (${c.message_count} messages)`)
    }
    return lines.join('\n')
  } catch {
    return null
  }
}

function resolveFiles(_db: Database, _tz: string, tenantId?: string): string | null {
  if (isTenantUser({ db: _db })) return null
  const root = process.env.MYWAY_ROOT
  if (!root) return null
  try {
    const files = walkFiles(root)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 15)
    if (files.length === 0) return null
    const lines = [`**User's vault files (${files.length} most recent):**`]
    for (const f of files) {
      const size = f.size < 1024 ? `${f.size}B`
        : f.size < 1_048_576 ? `${(f.size / 1024).toFixed(0)}KB`
        : `${(f.size / 1_048_576).toFixed(1)}MB`
      const mins = Math.floor((Date.now() - f.mtime) / 60_000)
      const age = mins < 60 ? `${mins}m ago`
        : mins < 1440 ? `${Math.floor(mins / 60)}h ago`
        : `${Math.floor(mins / 1440)}d ago`
      lines.push(`- ${f.rel} (${size}, ${age})`)
    }
    return lines.join('\n')
  } catch {
    return null
  }
}

function walkFiles(dir: string, depth = 0): { rel: string; size: number; mtime: number }[] {
  if (depth > 3) return []
  const root = process.env.MYWAY_ROOT ?? dir
  let results: { rel: string; size: number; mtime: number }[] = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isFile()) {
        const st = statSync(full)
        results.push({ rel: relative(root, full), size: st.size, mtime: st.mtimeMs })
      } else if (e.isDirectory()) {
        results = results.concat(walkFiles(full, depth + 1))
      }
    }
  } catch { /* ignore unreadable dirs */ }
  return results
}

// ─── Resolver registry ───────────────────────────────────────────────────────

const RESOLVERS: Record<string, RefResolver> = {
  tasks:         (db, tz) => resolveTasks(db, tz),
  recipes:       (db, _tz, tenantId) => resolveRecipes(db, _tz, tenantId),
  notes:         (db, _tz, tenantId) => resolveNotes(db, _tz, tenantId),
  memories:      (db) => resolveMemories(db),
  email:         (db) => resolveEmail(db),
  calendar:      (db, tz) => resolveCalendar(db, tz),
  conversations: (db) => resolveConversations(db),
  files:         (db, _tz, tenantId) => resolveFiles(db, _tz, tenantId),
}

// ─── Main resolver ───────────────────────────────────────────────────────────

/**
 * Resolve context refs into a formatted string for system prompt injection.
 *
 * @param refs - Array of ref keys ('tasks', 'recipes', etc.) or '*' for all
 * @param tenantId - Tenant ID for DB-backed content resolution
 * @returns Formatted context string or null if nothing resolved
 */
export function resolveContextRefs(
  db: Database,
  refs: string[],
  tenantId?: string,
): string | null {
  const tz = getUserTimezone(db)
  const keys = refs.includes('*') ? Object.keys(RESOLVERS) : refs

  const sections: string[] = []
  for (const key of keys) {
    const resolver = RESOLVERS[key]
    if (!resolver) continue
    try {
      const result = resolver(db, tz, tenantId)
      if (result) sections.push(result)
    } catch {
      // Individual failures are non-critical
    }
  }

  if (sections.length === 0) return null
  return sections.join('\n\n')
}
