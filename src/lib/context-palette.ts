/**
 * Context Palette — single source of truth for all available user data.
 *
 * buildContextPalette(db) queries every data source and returns a lightweight
 * summary suitable for:
 *   1. Client-side dynamic opener presets (via /api/context/summary)
 *   2. Server-side 'personal' context injection (system prompt enrichment)
 *
 * Adding a new data source: add one entry to SOURCE_BUILDERS. Everything
 * downstream (API, openers, system prompt) auto-updates.
 *
 * SERVER ONLY — never import in client components.
 */

import type { Database } from 'better-sqlite3'
import { getTaskSummary } from '@/lib/store/tasks'
import { listRecipes } from '@/lib/recipes'
import { getUnreadEmails, getUpcomingEvents } from '@/lib/connections/store'
import { getUserTimezone } from '@/lib/timezone'
import fs from 'fs'
import path from 'path'
import { getRoot } from '@/lib/fs-config'

// ─── Types ──────────────────────────────────────────────────────────────────

export type ContextSource = {
  key: string       // 'tasks', 'recipes', 'notes', etc.
  label: string     // 'Tasks', 'Recipe collection', etc.
  icon: string      // emoji
  count: number
  samples: string[] // 2-3 representative items
  statLine: string  // "7 open, 2 due today"
}

export type ContextPalette = {
  sources: ContextSource[] // only sources with count > 0
  totalItems: number
}

// ─── Source builders ─────────────────────────────────────────────────────────

type SourceBuilder = {
  key: string
  label: string
  icon: string
  build: (db: Database, tz: string, tenantId?: string) => ContextSource | null
}

const SOURCE_BUILDERS: SourceBuilder[] = [
  {
    key: 'tasks',
    label: 'Tasks',
    icon: '\u{1F4CB}', // 📋
    build: (db, tz) => {
      try {
        const summary = getTaskSummary(db, tz)
        if (summary.totalOpen === 0 && summary.doneToday === 0) return null

        const rows = db.prepare(`
          SELECT title FROM tasks
          WHERE status = 'open' AND is_deleted = 0
          ORDER BY priority ASC, due_at ASC NULLS LAST
          LIMIT 3
        `).all() as { title: string }[]

        // eslint-disable-next-line react-hooks/rules-of-hooks -- server-only, not a hook
        return {
          key: 'tasks',
          label: 'Tasks',
          icon: '\u{1F4CB}',
          count: summary.totalOpen,
          samples: rows.map(r => r.title),
          statLine: `${summary.totalOpen} open, ${summary.dueToday} due today`,
        }
      } catch {
        return null
      }
    },
  },
  {
    key: 'recipes',
    label: 'Recipes',
    icon: '\u{1F372}', // 🍲
    build: (db, _tz, tenantId) => {
      try {
        const recipes = listRecipes(db, tenantId)
        if (recipes.length === 0) return null
        const samples = recipes
          .map(r => r.title)
          .filter(t => t && t !== '---' && t !== 'Untitled Recipe')
          .slice(0, 3)
        return {
          key: 'recipes',
          label: 'Recipes',
          icon: '\u{1F372}',
          count: recipes.length,
          samples,
          statLine: `${recipes.length} saved`,
        }
      } catch {
        return null
      }
    },
  },
  {
    key: 'notes',
    label: 'Notes',
    icon: '\u{1F4DD}', // 📝
    build: (db, _tz, tenantId) => {
      try {
        const { useDbStorage, dbList } = require('@/lib/content-store')
        const NOTES_DEF = { table: 'notes', fsSubdir: 'notes', extraColumns: ['color'] }

        let notes: { title: string }[]
        // eslint-disable-next-line react-hooks/rules-of-hooks
        if (useDbStorage(tenantId)) {
          notes = dbList(db, NOTES_DEF)
        } else {
          const notesDir = path.join(getRoot(), 'notes')
          if (!fs.existsSync(notesDir)) return null
          const files = fs.readdirSync(notesDir).filter(f => f.endsWith('.md'))
          if (files.length === 0) return null
          notes = files.map(f => {
            const raw = fs.readFileSync(path.join(notesDir, f), 'utf-8')
            const h1 = raw.match(/^#\s+(.+)/m)
            return { title: h1 ? h1[1].trim() : f.replace('.md', '') }
          })
        }
        if (notes.length === 0) return null

        const samples = notes
          .map(n => n.title)
          .filter(t => t && t !== '---')
          .slice(0, 3)
        return {
          key: 'notes',
          label: 'Notes',
          icon: '\u{1F4DD}',
          count: notes.length,
          samples,
          statLine: `${notes.length} saved`,
        }
      } catch {
        return null
      }
    },
  },
  {
    key: 'memories',
    label: 'Memories',
    icon: '\u{1F9E0}', // 🧠
    build: (db) => {
      try {
        const { cnt } = db.prepare(
          `SELECT COUNT(*) as cnt FROM memories WHERE is_deleted = 0`
        ).get() as { cnt: number }
        if (cnt === 0) return null

        const rows = db.prepare(`
          SELECT content FROM memories
          WHERE is_deleted = 0
          ORDER BY created_at DESC
          LIMIT 3
        `).all() as { content: string }[]

        return {
          key: 'memories',
          label: 'Memories',
          icon: '\u{1F9E0}',
          count: cnt,
          samples: rows.map(r => r.content.slice(0, 60)),
          statLine: `${cnt} remembered`,
        }
      } catch {
        return null
      }
    },
  },
  {
    key: 'email',
    label: 'Emails',
    icon: '\u{1F4E7}', // 📧
    build: (db) => {
      try {
        const emails = getUnreadEmails(db, 5)
        if (emails.length === 0) return null
        return {
          key: 'email',
          label: 'Emails',
          icon: '\u{1F4E7}',
          count: emails.length,
          samples: emails.slice(0, 3).map(e => e.title ?? 'Untitled'),
          statLine: `${emails.length} unread`,
        }
      } catch {
        return null
      }
    },
  },
  {
    key: 'calendar',
    label: 'Calendar',
    icon: '\u{1F4C5}', // 📅
    build: (db, tz) => {
      try {
        const events = getUpcomingEvents(db, 1, tz)
        if (events.length === 0) return null
        return {
          key: 'calendar',
          label: 'Calendar',
          icon: '\u{1F4C5}',
          count: events.length,
          samples: events.slice(0, 3).map(e => e.title ?? 'Untitled event'),
          statLine: `${events.length} event${events.length !== 1 ? 's' : ''} today`,
        }
      } catch {
        return null
      }
    },
  },
  {
    key: 'conversations',
    label: 'Conversations',
    icon: '\u{1F4AC}', // 💬
    build: (db) => {
      try {
        const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400
        const { cnt } = db.prepare(`
          SELECT COUNT(*) as cnt FROM conversations
          WHERE is_deleted = 0 AND COALESCE(last_message_at, started_at) > ?
        `).get(weekAgo) as { cnt: number }
        if (cnt === 0) return null

        const rows = db.prepare(`
          SELECT app_id FROM conversations
          WHERE is_deleted = 0 AND COALESCE(last_message_at, started_at) > ?
          ORDER BY COALESCE(last_message_at, started_at) DESC
          LIMIT 5
        `).all(weekAgo) as { app_id: string }[]

        // Deduplicate app names
        const appNames = [...new Set(rows.map(r => r.app_id))]
          .map(id => id.charAt(0).toUpperCase() + id.slice(1))
          .slice(0, 3)

        return {
          key: 'conversations',
          label: 'Conversations',
          icon: '\u{1F4AC}',
          count: cnt,
          samples: appNames,
          statLine: `${cnt} this week`,
        }
      } catch {
        return null
      }
    },
  },
]

// ─── Main builder ────────────────────────────────────────────────────────────

export function buildContextPalette(db: Database, tenantId?: string): ContextPalette {
  const tz = getUserTimezone(db)
  const sources: ContextSource[] = []
  let totalItems = 0

  for (const builder of SOURCE_BUILDERS) {
    try {
      const source = builder.build(db, tz, tenantId)
      if (source && source.count > 0) {
        sources.push(source)
        totalItems += source.count
      }
    } catch {
      // Individual source failures are non-critical
    }
  }

  return { sources, totalItems }
}

// ─── Personal context for system prompt ──────────────────────────────────────

/**
 * Build a concise personal context section for the system prompt.
 * Used by apps with contextLevel: 'personal' — lightweight but specific.
 * ~100-200 tokens.
 */
export function buildPersonalContext(
  palette: ContextPalette,
  extras?: {
    userName?: string
    timezone?: string
    currentDateTime?: { label: string; timeOfDay: string; iso: string } | null
    signals?: { key: string; value: string; confidence: number }[]
  },
): string {
  const lines: string[] = [
    '',
    '---',
    '## Myway Context',
    '',
    '> The following is live context from the user\'s Myway environment.',
    '> Use it to personalise responses — reference specific items to make it personal.',
    '> The current date/time is authoritative — never hallucinate dates or years.',
    '',
  ]

  if (extras?.currentDateTime) {
    lines.push(`**Current date/time:** ${extras.currentDateTime.label} (${extras.currentDateTime.timeOfDay})`)
  }
  if (extras?.userName) lines.push(`**User:** ${extras.userName}`)
  if (extras?.timezone) lines.push(`**Timezone:** ${extras.timezone}`)

  if (palette.sources.length > 0) {
    lines.push('', '### Your Data')
    for (const s of palette.sources) {
      const samples = s.samples.length > 0
        ? ` — e.g. "${s.samples.join('", "')}"`
        : ''
      lines.push(`- ${s.icon} **${s.label}**: ${s.statLine}${samples}`)
    }
  }

  if (extras?.signals && extras.signals.length > 0) {
    lines.push('')
    for (const s of extras.signals) {
      if (s.key === 'user.streak_count') lines.push(`- \u{1F525} Streak: ${s.value} days`)
      else if (s.key === 'user.mood') lines.push(`- \u{1F4AD} Mood: ${s.value}`)
      else lines.push(`- ${s.key}: ${s.value}`)
    }
  }

  return lines.join('\n')
}
