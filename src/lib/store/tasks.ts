/**
 * Tasks store — autonomous, AI-enriched action items.
 *
 * Tasks cross-feed apps: Morning Brief reads today's tasks, Chat reads context,
 * Heartbeat enriches and archives stale tasks, Mise generates shopping tasks.
 *
 * Soft deletes only. Status lifecycle:
 *   open → in_progress → done / skipped / archived
 */

import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { startOfDayInTz, endOfDayInTz } from '@/lib/timezone'

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'skipped' | 'archived'
export type TaskSource = 'manual' | 'chat' | 'brief' | 'heartbeat' | 'mise' | 'tasks' | 'system'

export type TaskContext = {
  when?: string                          // "Tomorrow morning", "Before Friday EOD"
  where?: string                         // "At the office", "On the call with Steve"
  why_it_matters?: string                // "Key account — closing this quarter"
  subtasks?: string[]                    // AI-decomposed sub-items
  implementation_intention?: string      // "When X, I will Y"
  people?: string[]                      // ["Steve", "Louden"]
  companies?: string[]                   // ["Mitsubishi", "APort"]
  deliverables?: string[]                // ["proposal draft", "CSV export"]
  references?: string[]                  // ["previous meeting notes", "Q4 pipeline"]
  calendar_event_id?: string             // Google Calendar event ID for bidirectional sync
}

export type Task = {
  id: string
  appId: string
  conversationId: string | null
  title: string
  description: string | null
  status: TaskStatus
  priority: number
  dueAt: number | null
  /** True when dueAt includes a specific time (not just a date). */
  dueAtHasTime: boolean
  completedAt: number | null
  context: TaskContext
  source: TaskSource
  streakCount: number
  createdAt: number
  updatedAt: number
}

export type AddTaskOpts = {
  appId: string
  title: string
  description?: string
  priority?: number
  dueAt?: number | null
  dueAtHasTime?: boolean
  conversationId?: string | null
  context?: TaskContext
  source?: TaskSource
}

export type UpdateTaskOpts = {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: number
  dueAt?: number | null
  dueAtHasTime?: boolean
  context?: Partial<TaskContext>
}

function rowToTask(row: Record<string, unknown>): Task {
  let context: TaskContext = {}
  try { context = JSON.parse(row.context as string) } catch { /* fallback empty */ }
  return {
    id: row.id as string,
    appId: row.app_id as string,
    conversationId: row.conversation_id as string | null,
    title: row.title as string,
    description: row.description as string | null,
    status: row.status as TaskStatus,
    priority: row.priority as number,
    dueAt: row.due_at as number | null,
    dueAtHasTime: (row.due_at_has_time as number) === 1,
    completedAt: row.completed_at as number | null,
    context,
    source: row.source as TaskSource,
    streakCount: row.streak_count as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

/**
 * Auto-complete past calendar events — lazy GC pattern.
 *
 * Marks calendar-synced tasks as 'done' when their event time has passed.
 * Uses `completed_at = due_at` (event time, not now) so "done today" counts
 * aren't inflated by stale completions from weeks ago.
 *
 * Returns the number of tasks auto-completed (for logging).
 */
export function autoCompletePastCalendarTasks(db: Database, tz?: string): number {
  const now = Math.floor(Date.now() / 1000)
  try {
    const result = db.prepare(`
      UPDATE tasks SET
        status = 'done',
        completed_at = due_at,
        updated_at = ?
      WHERE is_deleted = 0
        AND status IN ('open', 'in_progress')
        AND json_extract(context, '$.calendar_event_id') IS NOT NULL
        AND due_at IS NOT NULL
        AND due_at_has_time = 1
        AND due_at < ?
    `).run(now, now)
    return result.changes
  } catch {
    return 0
  }
}

/** Get open tasks, ordered by priority then due date.
 *  Auto-completes past calendar events before querying.
 *  Scoped to tasks due within `daysAhead` days (default 14). */
export function getOpenTasks(db: Database, limit = 20, tz?: string, daysAhead = 14): Task[] {
  // Sweep past calendar events before reading
  autoCompletePastCalendarTasks(db, tz)

  const now = Math.floor(Date.now() / 1000)
  const cutoff = now + daysAhead * 86400
  const rows = db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'open' AND is_deleted = 0
      AND (due_at IS NULL OR due_at <= ?)
    ORDER BY priority ASC, due_at ASC NULLS LAST, created_at ASC
    LIMIT ?
  `).all(cutoff, limit) as Record<string, unknown>[]
  return rows.map(rowToTask)
}

/**
 * Get today's tasks — open tasks due today or overdue, plus in_progress.
 * Capped at `limit` to prevent overwhelm (default 3 for MIT view).
 */
export function getTodaysTasks(db: Database, limit = 3, tz?: string): Task[] {
  const endOfDay = endOfDayInTz(tz ?? 'UTC')
  const rows = db.prepare(`
    SELECT * FROM tasks
    WHERE is_deleted = 0
      AND status IN ('open', 'in_progress')
      AND (due_at IS NULL OR due_at <= ?)
    ORDER BY priority ASC, due_at ASC NULLS LAST
    LIMIT ?
  `).all(endOfDay, limit) as Record<string, unknown>[]
  return rows.map(rowToTask)
}

/** Get tasks for a specific app. */
export function getTasksByApp(db: Database, appId: string, limit = 50): Task[] {
  const rows = db.prepare(`
    SELECT * FROM tasks
    WHERE app_id = ? AND is_deleted = 0
    ORDER BY status ASC, priority ASC, created_at DESC
    LIMIT ?
  `).all(appId, limit) as Record<string, unknown>[]
  return rows.map(rowToTask)
}

/** Get a single task by ID. */
export function getTask(db: Database, id: string): Task | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND is_deleted = 0').get(id) as Record<string, unknown> | undefined
  return row ? rowToTask(row) : null
}

/** Create a new task. Returns the new ID. */
export function addTask(db: Database, opts: AddTaskOpts): string {
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT INTO tasks (
      id, app_id, conversation_id, title, description,
      priority, due_at, due_at_has_time, context, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.appId,
    opts.conversationId ?? null,
    opts.title,
    opts.description ?? null,
    opts.priority ?? 5,
    opts.dueAt ?? null,
    opts.dueAtHasTime ? 1 : 0,
    JSON.stringify(opts.context ?? {}),
    opts.source ?? 'manual',
    now,
    now,
  )
  return id
}

/** Update a task's fields. */
export function updateTask(db: Database, id: string, opts: UpdateTaskOpts): void {
  const now = Math.floor(Date.now() / 1000)
  const existing = getTask(db, id)
  if (!existing) return

  const newContext = opts.context
    ? { ...existing.context, ...opts.context }
    : existing.context

  db.prepare(`
    UPDATE tasks SET
      title = ?,
      description = ?,
      status = ?,
      priority = ?,
      due_at = ?,
      due_at_has_time = ?,
      context = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    opts.title ?? existing.title,
    opts.description ?? existing.description,
    opts.status ?? existing.status,
    opts.priority ?? existing.priority,
    opts.dueAt !== undefined ? opts.dueAt : existing.dueAt,
    (opts.dueAtHasTime !== undefined ? opts.dueAtHasTime : existing.dueAtHasTime) ? 1 : 0,
    JSON.stringify(newContext),
    now,
    id,
  )
}

/** Mark a task as done. Updates streak_count and completed_at. */
export function completeTask(db: Database, id: string): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE tasks SET
      status = 'done',
      completed_at = ?,
      streak_count = streak_count + 1,
      updated_at = ?
    WHERE id = ? AND is_deleted = 0
  `).run(now, now, id)
}

/** Archive a task (soft-close with dignity — not failure). */
export function archiveTask(db: Database, id: string): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE tasks SET status = 'archived', updated_at = ?
    WHERE id = ? AND is_deleted = 0
  `).run(now, id)
}

/** Soft delete a task. */
export function softDelete(db: Database, id: string): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE tasks SET is_deleted = 1, updated_at = ? WHERE id = ?
  `).run(now, id)
}

/**
 * Count tasks done today — used for streak and completion display.
 */
export function getDoneToday(db: Database, tz?: string): number {
  const startOfDay = startOfDayInTz(tz ?? 'UTC')
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM tasks
    WHERE status = 'done'
      AND completed_at >= ?
      AND is_deleted = 0
  `).get(startOfDay) as { cnt: number }
  return row.cnt
}

/**
 * Get summary for Morning Brief and cross-app context.
 * Returns: { total_open, due_today, mit (Most Important Task), done_today }
 *
 * Auto-completes past calendar events before counting.
 * `totalOpen` is scoped to the same `daysAhead` window as getOpenTasks
 * so the count is consistent with what users actually see.
 */
export function getTaskSummary(db: Database, tz?: string, daysAhead = 14): {
  totalOpen: number
  dueToday: number
  mit: Task | null
  doneToday: number
} {
  // Sweep past calendar events before counting
  autoCompletePastCalendarTasks(db, tz)

  const endOfDay = endOfDayInTz(tz ?? 'UTC')
  const startOfDay = startOfDayInTz(tz ?? 'UTC')
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now + daysAhead * 86400

  const totalOpen = (db.prepare(`
    SELECT COUNT(*) as cnt FROM tasks
    WHERE status = 'open' AND is_deleted = 0
      AND (due_at IS NULL OR due_at <= ?)
  `).get(cutoff) as { cnt: number }).cnt

  const dueToday = (db.prepare(`
    SELECT COUNT(*) as cnt FROM tasks
    WHERE status IN ('open', 'in_progress') AND due_at <= ? AND is_deleted = 0
  `).get(endOfDay) as { cnt: number }).cnt

  const mitRow = db.prepare(`
    SELECT * FROM tasks
    WHERE status IN ('open', 'in_progress') AND is_deleted = 0
    ORDER BY priority ASC, due_at ASC NULLS LAST
    LIMIT 1
  `).get() as Record<string, unknown> | undefined

  const doneToday = (db.prepare(`
    SELECT COUNT(*) as cnt FROM tasks
    WHERE status = 'done' AND completed_at >= ? AND is_deleted = 0
  `).get(startOfDay) as { cnt: number }).cnt

  return {
    totalOpen,
    dueToday,
    mit: mitRow ? rowToTask(mitRow) : null,
    doneToday,
  }
}

/** Find a task linked to a Google Calendar event via context.calendar_event_id. */
export function getTaskByCalendarEventId(db: Database, eventId: string): Task | null {
  const row = db.prepare(`
    SELECT * FROM tasks
    WHERE json_extract(context, '$.calendar_event_id') = ?
      AND is_deleted = 0
    LIMIT 1
  `).get(eventId) as Record<string, unknown> | undefined
  return row ? rowToTask(row) : null
}
