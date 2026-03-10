/**
 * Notifications resource handler — wraps the notifications store for the unified CRUD API.
 * Implements ResourceHandler from registry.ts.
 *
 * Design notes:
 *   - Notifications are append-only (update() throws — they are immutable once created)
 *   - delete() = dismiss (sets status to 'dismissed')
 *   - list() sweeps expired notifications and marks returned ones as shown
 *   - action 'dismiss' = same as delete (alias for ergonomic POST body)
 */

import type { Database } from 'better-sqlite3'
import type { ResourceHandler, ListQuery } from './registry'
import {
  getPendingNotifications,
  getNotification,
  addNotification,
  dismissNotification,
  sweepExpired,
  markAllShown,
} from './notifications'

export const notificationsResource: ResourceHandler = {
  list(db: Database, query: ListQuery) {
    sweepExpired(db)
    const limit = Number(query.limit) || 10
    const notifications = getPendingNotifications(db, limit)
    if (notifications.length > 0) {
      markAllShown(db, notifications.map((n) => n.id))
    }
    return { items: notifications }
  },

  get(db: Database, id: string) {
    return getNotification(db, id) ?? null
  },

  create(db: Database, body: Record<string, unknown>) {
    const { appId, title, body: notifBody } = body
    if (!appId || !title || !notifBody) {
      throw new Error('appId, title, and body are required')
    }
    const id = addNotification(db, body as Parameters<typeof addNotification>[1])
    return { id }
  },

  update(_db: Database, _id: string, _body: Record<string, unknown>): { ok: true } {
    // Notifications are immutable once created
    throw new Error('Notifications cannot be updated. Create a new notification instead.')
  },

  delete(db: Database, id: string) {
    dismissNotification(db, id)
    return { ok: true as const }
  },

  action(db: Database, actionName: string, id: string) {
    switch (actionName) {
      case 'dismiss':
        dismissNotification(db, id)
        return { ok: true }
      default:
        throw new Error(`Unknown notification action: ${actionName}`)
    }
  },
}
