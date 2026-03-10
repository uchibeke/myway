/**
 * Bidirectional Calendar Sync — three-way merge between Myway tasks and Google Calendar.
 *
 * Architecture: per-field LWW (last-writer-wins) with snapshot-based three-way diff.
 * The sync_pairs table stores the last-synced snapshot of shared fields. On each cycle:
 *   1. Compare task fields vs snapshot → detect local changes
 *   2. Compare Google event fields vs snapshot → detect remote changes
 *   3. If only one side changed → accept that side's value
 *   4. If both changed same field → latest updatedAt wins (LWW)
 *   5. Update snapshot to new agreed state
 *
 * Field ownership:
 *   Shared (LWW):     title, description, dueAt/start, location
 *   Myway only:      status, priority, context enrichment
 *   Google only:      attendees, conferenceData, hangoutLink, end time
 *
 * Deletion semantics:
 *   Google event deleted/cancelled → archive linked task
 *   Task completed/deleted → Google event stays untouched
 */

import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { ConnectionTokens } from './types'
import type { SyncPair } from './store'
import {
  getSyncPairByEventId,
  getSyncPairByTaskId,
  upsertSyncPair,
  deleteSyncPair,
  getDirtySyncPairs,
  getConnection,
  updateSyncCursor,
} from './store'
import {
  getTaskByCalendarEventId,
  addTask,
  updateTask,
  archiveTask,
  getTask,
} from '@/lib/store/tasks'
import type { TaskContext } from '@/lib/store/tasks'
import {
  listCalendarChanges,
  patchCalendarEvent,
} from './providers/google-workspace'
import type { CalendarChangeEvent } from './providers/google-workspace'

// ─── Three-Way Diff ──────────────────────────────────────────────────────────

type FieldVerdict = 'no_change' | 'take_local' | 'take_remote' | 'conflict'

type DiffResult = {
  title: FieldVerdict
  description: FieldVerdict
  dueAt: FieldVerdict
  location: FieldVerdict
}

type SharedFields = {
  title: string | null
  description: string | null
  dueAt: number | null
  location: string | null
}

/**
 * Pure three-way diff: compare local (task) and remote (Google event) against
 * the last-synced snapshot. Returns a per-field verdict.
 */
export function threeWayDiff(
  snapshot: SharedFields,
  local: SharedFields,
  remote: SharedFields,
): DiffResult {
  function diffField(
    snapshotVal: string | number | null,
    localVal: string | number | null,
    remoteVal: string | number | null,
  ): FieldVerdict {
    const localChanged = snapshotVal !== localVal
    const remoteChanged = snapshotVal !== remoteVal

    if (!localChanged && !remoteChanged) return 'no_change'
    if (localChanged && !remoteChanged) return 'take_local'
    if (!localChanged && remoteChanged) return 'take_remote'
    // Both changed — if they agree, no conflict
    if (localVal === remoteVal) return 'no_change'
    return 'conflict'
  }

  return {
    title: diffField(snapshot.title, local.title, remote.title),
    description: diffField(snapshot.description, local.description, remote.description),
    dueAt: diffField(snapshot.dueAt, local.dueAt, remote.dueAt),
    location: diffField(snapshot.location, local.location, remote.location),
  }
}

/**
 * Resolve a conflict using LWW (last-writer-wins).
 * Compares task.updatedAt (epoch seconds) vs Google event.updated (RFC3339).
 */
function resolveConflict(taskUpdatedAt: number, googleUpdated: string): 'take_local' | 'take_remote' {
  const googleEpoch = Math.floor(new Date(googleUpdated).getTime() / 1000)
  return taskUpdatedAt >= googleEpoch ? 'take_local' : 'take_remote'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract start time as epoch seconds from a Google Calendar event. */
function eventStartEpoch(event: CalendarChangeEvent): number | null {
  const startStr = event.start?.dateTime ?? event.start?.date
  if (!startStr) return null
  return Math.floor(new Date(startStr).getTime() / 1000)
}

/** Convert epoch seconds to ISO datetime string for Google Calendar. */
function epochToISODateTime(epoch: number): string {
  return new Date(epoch * 1000).toISOString()
}

/** Build shared fields from a task. */
function taskToSharedFields(task: { title: string; description: string | null; dueAt: number | null; context: TaskContext | string }): SharedFields {
  const ctx = typeof task.context === 'string' ? JSON.parse(task.context) as TaskContext : task.context
  return {
    title: task.title,
    description: task.description,
    dueAt: task.dueAt,
    location: ctx?.where ?? null,
  }
}

/** Build shared fields from a Google Calendar event. */
function eventToSharedFields(event: CalendarChangeEvent): SharedFields {
  return {
    title: event.summary ?? null,
    description: event.description ?? null,
    dueAt: eventStartEpoch(event),
    location: event.location ?? null,
  }
}

/** Build shared fields from a sync_pair snapshot. */
function snapshotToSharedFields(pair: SyncPair): SharedFields {
  return {
    title: pair.lastTitle,
    description: pair.lastDescription,
    dueAt: pair.lastDueAt,
    location: pair.lastLocation,
  }
}

/** Parse sync_cursor JSON to get calendar syncToken. */
function getCalendarSyncToken(cursor: string | null): string | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(cursor) as { calendar?: string }
    return parsed.calendar ?? null
  } catch {
    return null
  }
}

/** Build sync_cursor JSON with calendar syncToken. */
function buildSyncCursor(existing: string | null, calendarToken: string): string {
  let parsed: Record<string, unknown> = {}
  if (existing) {
    try { parsed = JSON.parse(existing) as Record<string, unknown> } catch { /* empty */ }
  }
  parsed.calendar = calendarToken
  return JSON.stringify(parsed)
}

// ─── Pull: Google → Myway ───────────────────────────────────────────────────

/**
 * Pull changes from Google Calendar into Myway tasks.
 * Handles: new events → create tasks, cancelled events → archive tasks,
 * updated events → three-way merge with snapshot.
 */
export async function pullChanges(
  db: Database,
  connectionId: string,
  tokens: ConnectionTokens,
): Promise<{ syncToken: string | null; requiresFullSync: boolean }> {
  const conn = getConnection(db, connectionId)
  const existingSyncToken = getCalendarSyncToken(conn?.syncCursor ?? null)

  const result = await listCalendarChanges(tokens, existingSyncToken)

  if (result.requiresFullSync) {
    return { syncToken: null, requiresFullSync: true }
  }

  const now = Math.floor(Date.now() / 1000)

  for (const event of result.events) {
    // ── Cancelled event → archive linked task ───────────────────────────
    if (event.status === 'cancelled') {
      const pair = getSyncPairByEventId(db, event.id)
      if (pair) {
        archiveTask(db, pair.taskId)
        deleteSyncPair(db, pair.id)
      }
      continue
    }

    const existingPair = getSyncPairByEventId(db, event.id)

    if (existingPair) {
      // ── Existing sync pair → three-way merge ────────────────────────
      const task = getTask(db, existingPair.taskId)
      if (!task) {
        // Task was hard-deleted — clean up the orphaned sync pair
        deleteSyncPair(db, existingPair.id)
        continue
      }

      const snapshot = snapshotToSharedFields(existingPair)
      const local = taskToSharedFields(task)
      const remote = eventToSharedFields(event)
      const diff = threeWayDiff(snapshot, local, remote)

      // Apply remote changes to task
      const taskUpdates: Record<string, unknown> = {}
      const newSnapshot: SharedFields = { ...snapshot }

      function applyVerdict(
        field: keyof DiffResult,
        verdict: FieldVerdict,
      ) {
        if (verdict === 'conflict') {
          verdict = resolveConflict(task!.updatedAt, event.updated)
        }
        if (verdict === 'take_remote') {
          if (field === 'title') taskUpdates.title = remote.title
          else if (field === 'description') taskUpdates.description = remote.description
          else if (field === 'dueAt') taskUpdates.dueAt = remote.dueAt
          else if (field === 'location') taskUpdates.context = { where: remote.location }
          newSnapshot[field] = remote[field] as never
        } else if (verdict === 'take_local') {
          newSnapshot[field] = local[field] as never
        }
      }

      applyVerdict('title', diff.title)
      applyVerdict('description', diff.description)
      applyVerdict('dueAt', diff.dueAt)
      applyVerdict('location', diff.location)

      // Apply task updates if any remote fields won
      if (Object.keys(taskUpdates).length > 0) {
        updateTask(db, task.id, taskUpdates as Parameters<typeof updateTask>[2])
      }

      // Refresh task to get accurate updatedAt
      const refreshedTask = getTask(db, task.id)
      const finalUpdatedAt = refreshedTask?.updatedAt ?? now

      // Update sync pair snapshot — critical for loop prevention
      upsertSyncPair(db, {
        id: existingPair.id,
        taskId: existingPair.taskId,
        calendarEventId: existingPair.calendarEventId,
        connectionId,
        lastTitle: newSnapshot.title,
        lastDescription: newSnapshot.description,
        lastDueAt: newSnapshot.dueAt,
        lastLocation: newSnapshot.location,
        lastPushedAt: existingPair.lastPushedAt,
        lastPulledAt: now,
        googleUpdated: event.updated,
        taskUpdatedAt: finalUpdatedAt,
      })
      continue
    }

    // ── No sync pair — check for adoptable existing task ──────────────
    const existingTask = getTaskByCalendarEventId(db, event.id)
    if (existingTask) {
      // Adopt: create sync pair with current state as snapshot
      const fields = taskToSharedFields(existingTask)
      upsertSyncPair(db, {
        id: randomUUID(),
        taskId: existingTask.id,
        calendarEventId: event.id,
        connectionId,
        lastTitle: fields.title,
        lastDescription: fields.description,
        lastDueAt: fields.dueAt,
        lastLocation: fields.location,
        lastPushedAt: null,
        lastPulledAt: now,
        googleUpdated: event.updated,
        taskUpdatedAt: existingTask.updatedAt,
      })
      continue
    }

    // ── New event — create task + sync pair ──────────────────────────
    const isAllDay = !event.start?.dateTime
    if (isAllDay) continue // Skip all-day events

    const startEpoch = eventStartEpoch(event)
    if (!startEpoch) continue

    const taskId = addTask(db, {
      appId: 'connections',
      title: event.summary ?? 'Calendar event',
      description: event.description?.slice(0, 500) ?? 'Auto-synced from Google Calendar',
      dueAt: startEpoch,
      dueAtHasTime: true,
      source: 'system',
      context: {
        calendar_event_id: event.id,
        where: event.location ?? undefined,
      },
    })

    const createdTask = getTask(db, taskId)

    upsertSyncPair(db, {
      id: randomUUID(),
      taskId,
      calendarEventId: event.id,
      connectionId,
      lastTitle: event.summary ?? null,
      lastDescription: event.description?.slice(0, 500) ?? null,
      lastDueAt: startEpoch,
      lastLocation: event.location ?? null,
      lastPushedAt: null,
      lastPulledAt: now,
      googleUpdated: event.updated,
      taskUpdatedAt: createdTask?.updatedAt ?? now,
    })
  }

  return { syncToken: result.nextSyncToken, requiresFullSync: false }
}

// ─── Push: Myway → Google ───────────────────────────────────────────────────

/**
 * Push local task changes to Google Calendar.
 * Only pushes shared fields (title, description, start time, location).
 * Skips tasks where only Myway-owned fields changed (status, priority).
 */
export async function pushChanges(
  db: Database,
  connectionId: string,
  tokens: ConnectionTokens,
): Promise<void> {
  const dirtyPairs = getDirtySyncPairs(db, connectionId)
  const now = Math.floor(Date.now() / 1000)

  for (const { task, ...pair } of dirtyPairs) {
    const snapshot = snapshotToSharedFields(pair)
    const local = taskToSharedFields(task)

    // Check if any shared fields actually changed
    const changedFields: Record<string, unknown> = {}
    const newSnapshot: SharedFields = { ...snapshot }

    if (snapshot.title !== local.title) {
      changedFields.title = local.title
      newSnapshot.title = local.title
    }
    if (snapshot.description !== local.description) {
      changedFields.description = local.description
      newSnapshot.description = local.description
    }
    if (snapshot.dueAt !== local.dueAt) {
      if (local.dueAt) {
        changedFields.start = epochToISODateTime(local.dueAt)
        // Set end to 1 hour after start (Google requires both)
        changedFields.end = epochToISODateTime(local.dueAt + 3600)
      }
      newSnapshot.dueAt = local.dueAt
    }
    if (snapshot.location !== local.location) {
      changedFields.location = local.location
      newSnapshot.location = local.location
    }

    if (Object.keys(changedFields).length === 0) {
      // Only Myway-owned fields changed — update snapshot timestamp, skip push
      upsertSyncPair(db, {
        ...pair,
        taskUpdatedAt: task.updatedAt,
      })
      continue
    }

    try {
      const googleUpdated = await patchCalendarEvent(
        tokens,
        pair.calendarEventId,
        changedFields as { title?: string; start?: string; end?: string; description?: string; location?: string },
      )

      upsertSyncPair(db, {
        ...pair,
        lastTitle: newSnapshot.title,
        lastDescription: newSnapshot.description,
        lastDueAt: newSnapshot.dueAt,
        lastLocation: newSnapshot.location,
        lastPushedAt: now,
        googleUpdated,
        taskUpdatedAt: task.updatedAt,
      })
    } catch (e: unknown) {
      // 403 = not event organizer — log and skip
      if (e && typeof e === 'object' && 'code' in e && (e as { code: number }).code === 403) {
        console.warn(`[calendar-sync] Cannot update event ${pair.calendarEventId}: not organizer`)
        // Still update task_updated_at to prevent re-trying
        upsertSyncPair(db, {
          ...pair,
          taskUpdatedAt: task.updatedAt,
        })
        continue
      }
      throw e
    }
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Full bidirectional calendar sync cycle:
 *   1. Pull phase (Google → Myway)
 *   2. If full resync needed: clear stale pairs, re-pull, skip push
 *   3. Save new syncToken
 *   4. Push phase (Myway → Google)
 */
export async function syncCalendarBidirectional(
  db: Database,
  connectionId: string,
  tokens: ConnectionTokens,
): Promise<void> {
  const conn = getConnection(db, connectionId)
  if (!conn) return

  // ── Pull phase ──────────────────────────────────────────────────────
  let pullResult = await pullChanges(db, connectionId, tokens)

  if (pullResult.requiresFullSync) {
    // SyncToken expired (410 Gone) — clear stale sync pairs and re-pull
    console.log('[calendar-sync] Full resync required — clearing stale sync pairs')
    db.prepare('DELETE FROM sync_pairs WHERE connection_id = ?').run(connectionId)

    // Re-pull without syncToken (initial full sync)
    pullResult = await pullChanges(db, connectionId, tokens)

    if (pullResult.syncToken) {
      const newCursor = buildSyncCursor(conn.syncCursor, pullResult.syncToken)
      updateSyncCursor(db, connectionId, newCursor)
    }

    // Skip push after full resync to avoid stale data going out
    return
  }

  // ── Save syncToken ──────────────────────────────────────────────────
  if (pullResult.syncToken) {
    const newCursor = buildSyncCursor(conn.syncCursor, pullResult.syncToken)
    updateSyncCursor(db, connectionId, newCursor)
  }

  // ── Push phase ──────────────────────────────────────────────────────
  await pushChanges(db, connectionId, tokens)
}
