/**
 * App Message Bus — autonomous inter-app communication.
 *
 * This is the core feature that lets Myway apps talk to each other without
 * user input. Examples:
 *
 *   Ember detects "user.shipped" signal
 *   → bus.publish(db, { fromApp: 'ember', subject: 'user.shipped', ... })
 *   → Fans out to all subscribers (compliment-avalanche, morning-brief, etc.)
 *   → Heartbeat calls bus.getPending(db, 'compliment-avalanche')
 *   → Compliment Avalanche fires a congratulatory message autonomously
 *
 *   Mise saves a recipe
 *   → bus.publish(db, { fromApp: 'mise', subject: 'recipe.saved', ... })
 *   → Chat subscribes to 'recipe.*' → gets notified for awareness
 *
 * Subject naming: 'domain.action' — e.g. 'user.shipped', 'recipe.saved',
 *   'user.burnout', 'user.milestone', 'memory.updated', 'system.heartbeat'.
 * Wildcard subscriptions: 'user.*' matches any 'user.' prefix.
 *
 * Delivery is guaranteed: messages persist until markDelivered or expiry.
 * Fan-out happens at publish time: subscribers each get their own row.
 */

import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'

export interface BusMessage {
  id: string
  fromApp: string
  toApp: string
  type: 'event' | 'request' | 'response' | 'notification'
  subject: string
  payload: Record<string, unknown>
  priority: number
  createdAt: number
  expiresAt: number | null
}

export interface PublishOpts {
  fromApp: string
  /** 'broadcast' fans out to all matching subscribers. Specific app id = direct send. */
  toApp?: string
  type?: BusMessage['type']
  subject: string
  payload?: Record<string, unknown>
  priority?: number
  /** Seconds from now. Undelivered messages past this are ignored. */
  ttlSeconds?: number
}

// ─── Subscribe ───────────────────────────────────────────────────────────────

export function subscribe(
  db: Database,
  appId: string,
  patterns: string[],
  handler: 'heartbeat' | 'immediate' | 'next_session' = 'heartbeat',
): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO app_subscriptions (id, app_id, subject_pattern, handler)
    VALUES (@id, @appId, @pattern, @handler)
  `)

  db.transaction(() => {
    for (const pattern of patterns) {
      insert.run({ id: `${appId}:${pattern}`, appId, pattern, handler })
    }
  })()
}

export function unsubscribeAll(db: Database, appId: string): void {
  db.prepare(`DELETE FROM app_subscriptions WHERE app_id = ?`).run(appId)
}

// ─── Publish ─────────────────────────────────────────────────────────────────

/**
 * Publish a message. If toApp = 'broadcast' (default), fans out to all
 * subscribers whose subject_pattern matches. If toApp is a specific app id,
 * sends directly without checking subscriptions.
 */
export function publish(db: Database, opts: PublishOpts): string[] {
  const {
    fromApp,
    toApp = 'broadcast',
    type = 'event',
    subject,
    payload = {},
    priority = 5,
    ttlSeconds,
  } = opts

  const expiresAt = ttlSeconds ? Math.floor(Date.now() / 1000) + ttlSeconds : null
  const payloadStr = JSON.stringify(payload)

  const insert = db.prepare(`
    INSERT INTO app_messages
      (id, from_app, to_app, type, subject, payload, priority, expires_at)
    VALUES
      (@id, @fromApp, @toApp, @type, @subject, @payload, @priority, @expiresAt)
  `)

  const ids: string[] = []

  db.transaction(() => {
    if (toApp !== 'broadcast') {
      // Direct message — no subscription lookup
      const id = randomUUID()
      insert.run({ id, fromApp, toApp, type, subject, payload: payloadStr, priority, expiresAt })
      ids.push(id)
    } else {
      // Fan-out to subscribers
      const subscribers = getSubscribers(db, subject)
      for (const sub of subscribers) {
        if (sub.appId === fromApp) continue // don't send to self
        const id = randomUUID()
        insert.run({
          id, fromApp, toApp: sub.appId, type, subject,
          payload: payloadStr, priority, expiresAt,
        })
        ids.push(id)
      }
    }
  })()

  return ids
}

// ─── Consume ─────────────────────────────────────────────────────────────────

/** Get all pending messages for an app (called by heartbeat per app). */
export function getPending(db: Database, appId: string, limit = 50): BusMessage[] {
  const rows = db.prepare(`
    SELECT id, from_app, to_app, type, subject, payload, priority, created_at, expires_at
    FROM app_messages
    WHERE to_app = ?
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > unixepoch())
    ORDER BY priority ASC, created_at ASC
    LIMIT ?
  `).all(appId, limit) as RawMessage[]

  return rows.map(toMessage)
}

export function markDelivered(db: Database, id: string): void {
  db.prepare(`
    UPDATE app_messages
    SET status = 'delivered', processed_at = unixepoch()
    WHERE id = ?
  `).run(id)
}

export function markFailed(db: Database, id: string): void {
  db.prepare(`
    UPDATE app_messages
    SET status = 'failed', processed_at = unixepoch()
    WHERE id = ?
  `).run(id)
}

/** Mark all pending for an app as delivered (bulk dismiss). */
export function clearPending(db: Database, appId: string): void {
  db.prepare(`
    UPDATE app_messages
    SET status = 'delivered', processed_at = unixepoch()
    WHERE to_app = ? AND status = 'pending'
  `).run(appId)
}

/** Get apps that have pending messages (for heartbeat to know what to drain). */
export function getAppsWithPending(db: Database): { appId: string; count: number }[] {
  const rows = db.prepare(`
    SELECT to_app, COUNT(*) as cnt FROM app_messages
    WHERE status = 'pending'
      AND (expires_at IS NULL OR expires_at > unixepoch())
    GROUP BY to_app
  `).all() as { to_app: string; cnt: number }[]
  return rows.map(r => ({ appId: r.to_app, count: r.cnt }))
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface Subscriber { appId: string; handler: string }

/** Find apps subscribed to a subject (exact match or wildcard prefix). */
function getSubscribers(db: Database, subject: string): Subscriber[] {
  const rows = db.prepare(`
    SELECT DISTINCT app_id, handler
    FROM app_subscriptions
    WHERE subject_pattern = ?
       OR (subject_pattern LIKE '%.*'
           AND ? LIKE REPLACE(subject_pattern, '.*', '.%'))
  `).all(subject, subject) as { app_id: string; handler: string }[]

  return rows.map((r) => ({ appId: r.app_id, handler: r.handler }))
}

interface RawMessage {
  id: string
  from_app: string
  to_app: string
  type: string
  subject: string
  payload: string
  priority: number
  created_at: number
  expires_at: number | null
}

function toMessage(r: RawMessage): BusMessage {
  return {
    id: r.id,
    fromApp: r.from_app,
    toApp: r.to_app,
    type: r.type as BusMessage['type'],
    subject: r.subject,
    payload: JSON.parse(r.payload ?? '{}') as Record<string, unknown>,
    priority: r.priority,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }
}
