/**
 * Notifications store — app-to-user structured messages with lifecycle tracking.
 *
 * Status lifecycle:
 *   pending → shown (when displayed on home screen)
 *          → dismissed (user explicitly dismissed)
 *          → expired (past expires_at; swept by queries)
 *
 * Design: notifications are append-only. Updates only change status fields.
 */

import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { startOfDayInTz, getUserTimezone } from '@/lib/timezone'

export type NotificationType = 'info' | 'success' | 'alert' | 'brief'
export type NotificationStatus = 'pending' | 'shown' | 'dismissed' | 'expired'

export type Notification = {
  id: string
  appId: string
  title: string
  body: string
  type: NotificationType
  status: NotificationStatus
  priority: number
  actionUrl: string | null
  expiresAt: number | null
  createdAt: number
  shownAt: number | null
  dismissedAt: number | null
}

export type AddNotificationOpts = {
  appId: string
  title: string
  body: string
  type?: NotificationType
  priority?: number
  actionUrl?: string
  /** Unix epoch seconds. null = never expires. */
  expiresAt?: number | null
}

function rowToNotification(row: Record<string, unknown>): Notification {
  return {
    id: row.id as string,
    appId: row.app_id as string,
    title: row.title as string,
    body: row.body as string,
    type: row.type as NotificationType,
    status: row.status as NotificationStatus,
    priority: row.priority as number,
    actionUrl: row.action_url as string | null,
    expiresAt: row.expires_at as number | null,
    createdAt: row.created_at as number,
    shownAt: row.shown_at as number | null,
    dismissedAt: row.dismissed_at as number | null,
  }
}

/**
 * Get all pending notifications that have not expired.
 * Returns ordered by priority ASC, then created_at DESC (newest first within priority).
 */
export function getPendingNotifications(db: Database, limit = 10): Notification[] {
  const now = Math.floor(Date.now() / 1000)
  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE status = 'pending'
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY priority ASC, created_at DESC
    LIMIT ?
  `).all(now, limit) as Record<string, unknown>[]
  return rows.map(rowToNotification)
}

/**
 * Get all active notifications (pending + shown but not dismissed/expired).
 * Used for home screen badge counts.
 */
export function getActiveNotifications(db: Database): Notification[] {
  const now = Math.floor(Date.now() / 1000)
  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE status IN ('pending', 'shown')
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY priority ASC, created_at DESC
  `).all(now) as Record<string, unknown>[]
  return rows.map(rowToNotification)
}

/** Get a single notification by ID. */
export function getNotification(db: Database, id: string): Notification | null {
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToNotification(row) : null
}

/** Create a new notification. Returns the new ID. */
export function addNotification(db: Database, opts: AddNotificationOpts): string {
  const id = randomUUID()
  db.prepare(`
    INSERT INTO notifications (id, app_id, title, body, type, priority, action_url, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.appId,
    opts.title,
    opts.body,
    opts.type ?? 'info',
    opts.priority ?? 5,
    opts.actionUrl ?? null,
    opts.expiresAt ?? null,
  )
  return id
}

/** Mark a notification as shown (displayed on home screen). */
export function markShown(db: Database, id: string): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE notifications SET status = 'shown', shown_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(now, id)
}

/** Mark multiple notifications as shown in a single transaction. */
export function markAllShown(db: Database, ids: string[]): void {
  if (ids.length === 0) return
  const now = Math.floor(Date.now() / 1000)
  const markOne = db.prepare(`
    UPDATE notifications SET status = 'shown', shown_at = ?
    WHERE id = ? AND status = 'pending'
  `)
  db.transaction(() => {
    for (const id of ids) markOne.run(now, id)
  })()
}

/** Mark a notification as dismissed by the user. */
export function dismissNotification(db: Database, id: string): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE notifications SET status = 'dismissed', dismissed_at = ?
    WHERE id = ? AND status IN ('pending', 'shown')
  `).run(now, id)
}

/** Sweep expired notifications — marks them expired. Safe to call on every load. */
export function sweepExpired(db: Database): number {
  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(`
    UPDATE notifications
    SET status = 'expired'
    WHERE expires_at IS NOT NULL
      AND expires_at <= ?
      AND status IN ('pending', 'shown')
  `).run(now)
  return result.changes
}

/**
 * Check if a brief notification already exists for today (prevents duplicate briefs).
 * Returns true if a brief notification was created today and is not expired/dismissed.
 */
export function hasTodaysBrief(db: Database): boolean {
  const tz = getUserTimezone(db)
  const startOfDay = startOfDayInTz(tz)
  const row = db.prepare(`
    SELECT id FROM notifications
    WHERE app_id = 'brief'
      AND type = 'brief'
      AND created_at >= ?
      AND status NOT IN ('expired', 'dismissed')
    LIMIT 1
  `).get(startOfDay)
  return row != null
}
