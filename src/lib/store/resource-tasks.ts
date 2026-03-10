/**
 * Tasks resource handler — wraps the tasks store for the unified CRUD API.
 * Implements ResourceHandler from registry.ts.
 *
 * Actions supported beyond CRUD:
 *   complete  — marks task done, increments streak
 *   archive   — moves to archived status
 */

import type { Database } from 'better-sqlite3'
import type { ResourceHandler, ListQuery } from './registry'
import {
  getOpenTasks,
  getTodaysTasks,
  getTask,
  addTask,
  updateTask,
  completeTask,
  archiveTask,
  softDelete,
  getTaskSummary,
} from './tasks'
import { getUserTimezone, parseDateInTz, parseDateTimeInTz } from '@/lib/timezone'
import { notifyOpenClawBackground } from '@/lib/openclaw-webhook'

export const tasksResource: ResourceHandler = {
  list(db: Database, query: ListQuery) {
    const limit = Number(query.limit) || 20
    const today = Boolean(query.today)
    const tz = getUserTimezone(db)
    const tasks = today ? getTodaysTasks(db, limit, tz) : getOpenTasks(db, limit, tz)
    const summary = getTaskSummary(db, tz)
    return { items: tasks, summary }
  },

  get(db: Database, id: string) {
    return getTask(db, id) ?? null
  },

  create(db: Database, body: Record<string, unknown>) {
    const { appId, title } = body
    if (!appId || !title) throw new Error('appId and title are required')

    // If dueAt is a string (e.g. "2026-02-23T08:00" or "2026-02-23"), parse it in the
    // user's timezone rather than relying on the caller to supply a correct Unix timestamp.
    let resolvedDueAt = body.dueAt
    let resolvedHasTime = body.dueAtHasTime
    if (typeof body.dueAt === 'string') {
      const tz = getUserTimezone(db)
      if (/^\d{4}-\d{2}-\d{2}$/.test(body.dueAt)) {
        resolvedDueAt = parseDateInTz(body.dueAt, tz)
        resolvedHasTime = false
      } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.dueAt)) {
        // Strip seconds if present to get "YYYY-MM-DDTHH:MM"
        const normalized = body.dueAt.slice(0, 16)
        resolvedDueAt = parseDateTimeInTz(normalized, tz)
        resolvedHasTime = true
      }
    }

    const id = addTask(db, { ...body, dueAt: resolvedDueAt, dueAtHasTime: resolvedHasTime } as Parameters<typeof addTask>[1])
    return { id }
  },

  update(db: Database, id: string, body: Record<string, unknown>) {
    let resolvedBody = body
    if (typeof body.dueAt === 'string') {
      const tz = getUserTimezone(db)
      if (/^\d{4}-\d{2}-\d{2}$/.test(body.dueAt)) {
        resolvedBody = { ...body, dueAt: parseDateInTz(body.dueAt, tz), dueAtHasTime: false }
      } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.dueAt)) {
        const normalized = body.dueAt.slice(0, 16)
        resolvedBody = { ...body, dueAt: parseDateTimeInTz(normalized, tz), dueAtHasTime: true }
      }
    }
    updateTask(db, id, resolvedBody as Parameters<typeof updateTask>[2])
    return { ok: true as const }
  },

  delete(db: Database, id: string) {
    softDelete(db, id)
    return { ok: true as const }
  },

  action(db: Database, actionName: string, id: string) {
    switch (actionName) {
      case 'complete': {
        const task = getTask(db, id)
        completeTask(db, id)
        // Notify OpenClaw immediately — agent celebrates + updates streak
        if (task) {
          notifyOpenClawBackground(`Task completed: ${task.title}`, 'now')
        }
        return { ok: true }
      }
      case 'archive':
        archiveTask(db, id)
        return { ok: true }
      default:
        throw new Error(`Unknown task action: ${actionName}`)
    }
  },
}
