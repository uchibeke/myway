/**
 * Myway action blocks — server-side task operations driven by AI responses.
 *
 * The Tasks (and other) SKILL.md instructs the AI to append machine-readable
 * action blocks to its human-readable response:
 *
 *   <myway:task>{"action":"create","title":"Call dentist","priority":3,"dueAt":"2024-02-23"}</myway:task>
 *
 * These blocks are:
 *   - Stripped from the content before saving to DB and before display in the UI
 *   - Parsed and executed server-side in the chat route's flush() callback
 *
 * Security: inputs are validated before touching the DB. Invalid JSON or unknown
 * actions are silently skipped (non-critical path).
 */

import type { Database } from 'better-sqlite3'
import { addTask, completeTask, softDelete, updateTask } from '@/lib/store/tasks'
import type { TaskContext } from '@/lib/store/tasks'
import { parseDateInTz, parseDateTimeInTz } from '@/lib/timezone'

/** Regex to match a complete <myway:task>…</myway:task> block (non-greedy). */
const BLOCK_RE = /<myway:task>([\s\S]*?)<\/myway:task>/g

/**
 * Strip all <myway:task>…</myway:task> blocks from content.
 * Also strips incomplete blocks that start but haven't closed yet (safe for streaming).
 */
export function stripTaskActions(text: string): string {
  return text
    .replace(BLOCK_RE, '')            // complete blocks
    .replace(/<myway:task>[\s\S]*$/, '') // incomplete block at end of stream
    .replace(/\n{3,}/g, '\n\n')       // collapse extra blank lines left behind
    .trim()
}

type TaskAction =
  | { action: 'create'; title: string; description?: string; priority?: number; dueAt?: string | null; context?: TaskContext }
  | { action: 'complete'; id: string }
  | { action: 'delete'; id: string }
  | { action: 'update'; id: string; title?: string; description?: string; priority?: number; status?: string; dueAt?: string | null; context?: TaskContext }

/**
 * Parse and execute all task action blocks found in the AI response.
 * Called in the flush() callback after streaming completes.
 *
 * @param db     — open DB connection
 * @param appId  — the app the response belongs to (stored on created tasks)
 * @param content — the raw accumulated AI response (may include action blocks)
 * @param conversationId — optional; linked to created tasks for context
 */
export function executeMywayTaskActions(
  db: Database,
  appId: string,
  content: string,
  conversationId?: string | null,
  tz?: string,
): void {
  let match: RegExpExecArray | null
  BLOCK_RE.lastIndex = 0 // reset stateful regex

  while ((match = BLOCK_RE.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim()) as TaskAction
      runTaskAction(db, appId, parsed, conversationId, tz)
    } catch {
      // Invalid JSON or unknown action — skip silently
    }
  }
}

function runTaskAction(
  db: Database,
  appId: string,
  action: TaskAction,
  conversationId?: string | null,
  tz?: string,
): void {
  switch (action.action) {
    case 'create': {
      if (!action.title?.trim()) return
      const due = parseDueAt(action.dueAt, tz)
      addTask(db, {
        appId,
        conversationId: conversationId ?? null,
        title: action.title.trim(),
        description: action.description?.trim() || undefined,
        priority: clampPriority(action.priority),
        dueAt: due?.epoch ?? null,
        dueAtHasTime: due?.hasTime ?? false,
        context: action.context ?? {},
        source: 'tasks',
      })
      break
    }

    case 'complete': {
      if (!action.id) return
      completeTask(db, action.id)
      break
    }

    case 'delete': {
      if (!action.id) return
      softDelete(db, action.id)
      break
    }

    case 'update': {
      if (!action.id) return
      const updDue = action.dueAt !== undefined ? parseDueAt(action.dueAt, tz) : undefined
      updateTask(db, action.id, {
        title: action.title,
        description: action.description,
        priority: action.priority !== undefined ? clampPriority(action.priority) : undefined,
        status: action.status as Parameters<typeof updateTask>[2]['status'],
        dueAt: updDue !== undefined ? (updDue?.epoch ?? null) : undefined,
        dueAtHasTime: updDue !== undefined ? (updDue?.hasTime ?? false) : undefined,
        context: action.context,
      })
      break
    }
  }
}

type DueAtResult = { epoch: number; hasTime: boolean } | null

function parseDueAt(raw: string | null | undefined, tz?: string): DueAtResult {
  if (!raw) return null
  const useTz = tz ?? 'UTC'

  // Defensive: LLMs often append "Z" to local times (e.g. "2026-02-23T11:00:00Z")
  // when they mean the user's local time. Strip trailing "Z" from simple ISO strings
  // and treat as local time in the user's timezone. Only trust explicit non-Z offsets
  // like "-05:00" or "+09:00".
  let normalized = typeof raw === 'string' ? raw.trim() : raw
  const zStripped = typeof normalized === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/i.test(normalized)
  if (zStripped && typeof normalized === 'string') {
    normalized = normalized.replace(/Z$/i, '').replace(/:\d{2}$/, '') // strip Z and optional seconds → "YYYY-MM-DDTHH:MM"
  }

  // "YYYY-MM-DD" → parse as midnight in user's timezone (date-only)
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return { epoch: parseDateInTz(normalized, useTz), hasTime: false }
  }

  // "YYYY-MM-DDTHH:MM" — exact match (no seconds, no offset)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
    return { epoch: parseDateTimeInTz(normalized, useTz), hasTime: true }
  }

  // "YYYY-MM-DDTHH:MM:SS" — with seconds but no timezone offset
  // Treat the wall-clock time as the user's timezone, not UTC
  const withSecondsMatch = normalized.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):\d{2}$/)
  if (withSecondsMatch) {
    return { epoch: parseDateTimeInTz(withSecondsMatch[1], useTz), hasTime: true }
  }

  // ISO 8601 with explicit non-Z timezone offset (e.g. "2026-02-23T08:00:00-05:00")
  // These encode a specific instant — trust native parsing
  if (/[+-]\d{2}:\d{2}$/.test(normalized)) {
    const d = new Date(normalized)
    if (!isNaN(d.getTime())) return { epoch: Math.floor(d.getTime() / 1000), hasTime: true }
  }

  // Last resort: native parse — re-interpret as user's timezone
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return null
  return { epoch: Math.floor(d.getTime() / 1000), hasTime: String(normalized).includes('T') }
}

function clampPriority(p: number | undefined): number {
  if (p === undefined || isNaN(p)) return 5
  return Math.min(10, Math.max(1, Math.round(p)))
}
