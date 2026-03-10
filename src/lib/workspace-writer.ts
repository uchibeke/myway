/**
 * Workspace Writer — writes DB snapshots to ~/.openclaw/workspace/ as markdown files.
 *
 * DB is the source of truth. These files are read-only snapshots that give OpenClaw's
 * heartbeat agent and memory system full context on tasks, calendar, recipes, notes,
 * and connection status — without needing direct DB access.
 *
 * Files written:
 *   CALENDAR.md   — today + upcoming events from Google Calendar
 *   TASKS.md      — open tasks with context, MIT, streaks
 *   RECIPES.md    — recipe vault summary
 *   NOTES.md      — saved notes summary
 *   CONNECTIONS.md — connection status + recent email highlights
 *
 * Called after: connection sync, task mutations, recipe saves, note saves.
 * All writes are atomic (write tmp → rename) and non-critical (never throws).
 *
 * SERVER ONLY — never import in client components.
 */

import { writeFileSync, mkdirSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Database } from 'better-sqlite3'
import { autoCompletePastCalendarTasks } from '@/lib/store/tasks'
import { isTenantUser } from '@/lib/hosted-storage'

const WORKSPACE = join(homedir(), '.openclaw', 'workspace')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeAtomic(filename: string, content: string): void {
  try {
    // Defense-in-depth: skip writes for tenant/hosted users
    if (isTenantUser()) return
    // Only write if workspace directory already exists (OpenClaw users).
    // Non-OpenClaw users don't need these snapshot files.
    if (!existsSync(WORKSPACE)) return
    const target = join(WORKSPACE, filename)
    const tmp = target + '.tmp'
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, target)
  } catch (e) {
    console.warn(`[workspace-writer] Failed to write ${filename}:`, e instanceof Error ? e.message : e)
  }
}

function formatEpoch(epoch: number, tz: string): string {
  try {
    return new Date(epoch * 1000).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    })
  } catch {
    return new Date(epoch * 1000).toISOString()
  }
}

function formatDate(epoch: number, tz: string): string {
  try {
    return new Date(epoch * 1000).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: tz,
    })
  } catch {
    return new Date(epoch * 1000).toISOString().slice(0, 10)
  }
}

function formatTime(epoch: number, tz: string): string {
  try {
    return new Date(epoch * 1000).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    })
  } catch {
    return new Date(epoch * 1000).toISOString().slice(11, 16)
  }
}

// ─── CALENDAR.md ─────────────────────────────────────────────────────────────

export function writeCalendarContext(db: Database, tz = 'UTC'): void {
  const now = Math.floor(Date.now() / 1000)
  const sevenDaysAhead = now + 7 * 86400

  let rows: Record<string, unknown>[]
  try {
    rows = db.prepare(`
      SELECT * FROM connection_data
      WHERE data_type = 'calendar_event'
        AND occurred_at >= ?
        AND occurred_at <= ?
      ORDER BY occurred_at ASC
      LIMIT 50
    `).all(now - 3600, sevenDaysAhead) as Record<string, unknown>[]
  } catch {
    return // connections table doesn't exist yet
  }

  const lines = [
    '# Calendar',
    `> Auto-generated from Myway DB. Updated: ${new Date().toISOString()}`,
    `> Source of truth: Myway SQLite. This file is a read-only snapshot.`,
    '',
  ]

  if (rows.length === 0) {
    lines.push('No upcoming events in the next 7 days.')
    writeAtomic('CALENDAR.md', lines.join('\n'))
    return
  }

  // Group by day
  const byDay = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const epoch = row.occurred_at as number
    const dayKey = formatDate(epoch, tz)
    if (!byDay.has(dayKey)) byDay.set(dayKey, [])
    byDay.get(dayKey)!.push(row)
  }

  for (const [day, events] of byDay) {
    lines.push(`## ${day}`)
    for (const row of events) {
      let metadata: Record<string, unknown> = {}
      try { metadata = JSON.parse(row.metadata as string) } catch { /* empty */ }

      const title = row.title as string
      const isAllDay = metadata.isAllDay as boolean
      const epoch = row.occurred_at as number
      const time = isAllDay ? 'All day' : formatTime(epoch, tz)
      const location = metadata.location ? ` — ${metadata.location}` : ''
      const meetLink = (metadata.hangoutLink as string) ?? (metadata.conferenceLink as string)
      const meeting = meetLink ? ` [Join](${meetLink})` : ''
      const attendees = metadata.attendees as { displayName?: string; email?: string }[] | undefined
      const attendeeStr = attendees?.length
        ? ` (with ${attendees.slice(0, 3).map(a => a.displayName ?? a.email ?? '').filter(Boolean).join(', ')}${attendees.length > 3 ? ` +${attendees.length - 3}` : ''})`
        : ''

      lines.push(`- **${time}** — ${title}${location}${attendeeStr}${meeting}`)
    }
    lines.push('')
  }

  writeAtomic('CALENDAR.md', lines.join('\n'))
}

// ─── TASKS.md ────────────────────────────────────────────────────────────────

export function writeTasksContext(db: Database, tz = 'UTC'): void {
  // Sweep past calendar events before querying
  autoCompletePastCalendarTasks(db, tz)

  const now = Math.floor(Date.now() / 1000)
  const daysAhead = 14
  const cutoff = now + daysAhead * 86400

  let rows: Record<string, unknown>[]
  try {
    rows = db.prepare(`
      SELECT * FROM tasks
      WHERE is_deleted = 0 AND status IN ('open', 'in_progress')
        AND (due_at IS NULL OR due_at <= ?)
      ORDER BY priority ASC, due_at ASC NULLS LAST, created_at ASC
      LIMIT 30
    `).all(cutoff) as Record<string, unknown>[]
  } catch {
    return // tasks table doesn't exist yet
  }

  // Stats
  let totalOpen = 0
  let dueToday = 0
  let doneToday = 0
  try {
    const endOfDay = Math.floor(new Date(new Date().toLocaleDateString('en-US', { timeZone: tz })).getTime() / 1000) + 86400
    const startOfDay = endOfDay - 86400
    totalOpen = (db.prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE status = 'open' AND is_deleted = 0 AND (due_at IS NULL OR due_at <= ?)`).get(cutoff) as { cnt: number }).cnt
    dueToday = (db.prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE status IN ('open','in_progress') AND due_at <= ? AND is_deleted = 0`).get(endOfDay) as { cnt: number }).cnt
    doneToday = (db.prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE status = 'done' AND completed_at >= ? AND is_deleted = 0`).get(startOfDay) as { cnt: number }).cnt
  } catch { /* non-critical */ }

  const lines = [
    '# Tasks',
    `> Auto-generated from Myway DB. Updated: ${new Date().toISOString()}`,
    `> Source of truth: Myway SQLite. This file is a read-only snapshot.`,
    '',
    `**Summary:** ${totalOpen} open, ${dueToday} due today, ${doneToday} done today`,
    '',
  ]

  if (rows.length === 0) {
    lines.push('No open tasks.')
    writeAtomic('TASKS.md', lines.join('\n'))
    return
  }

  // MIT = first task
  const mit = rows[0]

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const title = row.title as string
    const priority = row.priority as number
    const status = row.status as string
    const dueAt = row.due_at as number | null
    const hasTime = (row.due_at_has_time as number) === 1

    let context: Record<string, unknown> = {}
    try { context = JSON.parse(row.context as string) } catch { /* empty */ }

    const isMit = i === 0
    const prefix = isMit ? '**MIT →** ' : '- '
    const due = dueAt
      ? hasTime ? ` (due: ${formatEpoch(dueAt, tz)})` : ` (due: ${formatDate(dueAt, tz)})`
      : ''
    const statusTag = status === 'in_progress' ? ' [in progress]' : ''
    const people = (context.people as string[])?.length ? ` — people: ${(context.people as string[]).join(', ')}` : ''
    const why = context.why_it_matters ? ` — ${context.why_it_matters}` : ''
    const calendarLink = context.calendar_event_id ? ' 📅' : ''

    if (isMit) {
      lines.push(`${prefix}${title}${due}${statusTag}${calendarLink}`)
      if (why) lines.push(`  ${why}`)
      if (people) lines.push(`  ${people}`)
      lines.push('')
    } else {
      lines.push(`${prefix}${title} (p${priority})${due}${statusTag}${calendarLink}${people}${why}`)
    }
  }

  writeAtomic('TASKS.md', lines.join('\n'))
}

// ─── RECIPES.md ──────────────────────────────────────────────────────────────

export function writeRecipesContext(): void {
  let listRecipes: () => { id: string; title: string; tags: string[]; cookTime?: string }[]
  try {
    // Lazy import to avoid circular deps and startup cost
    listRecipes = require('@/lib/recipes').listRecipes
  } catch {
    return
  }

  let recipes: { id: string; title: string; tags: string[]; cookTime?: string }[]
  try {
    recipes = listRecipes()
  } catch {
    return
  }

  const lines = [
    '# Recipes',
    `> Auto-generated from recipe vault. Updated: ${new Date().toISOString()}`,
    `> Source of truth: ~/vault/recipes/. This file is a read-only snapshot.`,
    '',
    `**${recipes.length} recipe${recipes.length !== 1 ? 's' : ''} saved.**`,
    '',
  ]

  if (recipes.length === 0) {
    lines.push('No recipes in vault yet.')
    writeAtomic('RECIPES.md', lines.join('\n'))
    return
  }

  for (const r of recipes.slice(0, 40)) {
    const tags = r.tags.length > 0 ? ` [${r.tags.join(', ')}]` : ''
    const time = r.cookTime ? ` · ${r.cookTime}` : ''
    lines.push(`- ${r.title}${time}${tags}`)
  }

  if (recipes.length > 40) {
    lines.push(`- ... and ${recipes.length - 40} more`)
  }

  writeAtomic('RECIPES.md', lines.join('\n'))
}

// ─── NOTES.md ────────────────────────────────────────────────────────────────

export function writeNotesContext(): void {
  let buildNotesContext: () => string | null
  try {
    buildNotesContext = require('@/lib/notes-context').buildNotesContext
  } catch {
    return
  }

  let notesCtx: string | null
  try {
    notesCtx = buildNotesContext()
  } catch {
    return
  }

  const lines = [
    '# Notes',
    `> Auto-generated from notes directory. Updated: ${new Date().toISOString()}`,
    `> Source of truth: $MYWAY_ROOT/notes/. This file is a read-only snapshot.`,
    '',
  ]

  if (!notesCtx) {
    lines.push('No notes saved yet.')
  } else {
    lines.push(notesCtx)
  }

  writeAtomic('NOTES.md', lines.join('\n'))
}

// ─── CONNECTIONS.md ──────────────────────────────────────────────────────────

export function writeConnectionsContext(db: Database): void {
  let connections: Record<string, unknown>[]
  try {
    connections = db.prepare('SELECT * FROM connections').all() as Record<string, unknown>[]
  } catch {
    return // connections table doesn't exist yet
  }

  const lines = [
    '# Connections',
    `> Auto-generated from Myway DB. Updated: ${new Date().toISOString()}`,
    `> Source of truth: Myway SQLite. This file is a read-only snapshot.`,
    '',
  ]

  if (connections.length === 0) {
    lines.push('No connections configured.')
    writeAtomic('CONNECTIONS.md', lines.join('\n'))
    return
  }

  for (const conn of connections) {
    const id = conn.id as string
    const status = conn.status as string
    const lastSync = conn.last_sync_at as number | null
    const error = conn.error as string | null
    const syncInfo = lastSync ? `last sync: ${new Date(lastSync * 1000).toISOString()}` : 'never synced'
    const errorInfo = error ? ` — error: ${error}` : ''
    lines.push(`## ${id}`)
    lines.push(`Status: **${status}** (${syncInfo}${errorInfo})`)
    lines.push('')
  }

  // Unread email count
  try {
    const unread = (db.prepare(`
      SELECT COUNT(*) as cnt FROM connection_data WHERE data_type = 'email' AND is_read = 0
    `).get() as { cnt: number }).cnt
    if (unread > 0) {
      lines.push(`**${unread} unread email${unread !== 1 ? 's' : ''}** in Gmail.`)
      // Top 5 subjects
      const emails = db.prepare(`
        SELECT title, metadata FROM connection_data
        WHERE data_type = 'email' AND is_read = 0
        ORDER BY occurred_at DESC LIMIT 5
      `).all() as Record<string, unknown>[]
      for (const e of emails) {
        let meta: Record<string, unknown> = {}
        try { meta = JSON.parse(e.metadata as string) } catch { /* empty */ }
        const from = (meta.from as string) ?? 'unknown'
        const shortFrom = from.includes('<') ? from.split('<')[0].trim() : from
        lines.push(`- ${e.title as string} (from ${shortFrom})`)
      }
      lines.push('')
    }
  } catch { /* non-critical */ }

  // Pending actions
  try {
    const pending = (db.prepare(`
      SELECT COUNT(*) as cnt FROM connection_actions WHERE status = 'pending'
    `).get() as { cnt: number }).cnt
    if (pending > 0) {
      lines.push(`**${pending} pending action${pending !== 1 ? 's' : ''}** awaiting approval.`)
    }
  } catch { /* non-critical */ }

  writeAtomic('CONNECTIONS.md', lines.join('\n'))
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Write all workspace context files. Called after sync, task mutations, etc.
 * Non-critical — never throws. Each file written independently.
 */
export function writeAllWorkspaceContext(db: Database, tz = 'UTC'): void {
  if (isTenantUser({ db })) return
  writeCalendarContext(db, tz)
  writeTasksContext(db, tz)
  writeRecipesContext()
  writeNotesContext()
  writeConnectionsContext(db)
}
