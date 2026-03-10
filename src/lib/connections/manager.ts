/**
 * Connection Manager — orchestrates the full connection lifecycle.
 *
 * Called by API routes. Handles OAuth flows, sync, token refresh,
 * action execution, and disconnect. Publishes bus events and signals
 * after syncing.
 */

import type { Database } from 'better-sqlite3'
import { randomBytes, createHmac } from 'crypto'
import { getConnectionDefinition, getProvider } from './registry'
import {
  getConnection,
  upsertConnection,
  updateConnectionStatus,
  updateSyncCursor,
  getTokens,
  saveTokens,
  deleteTokens,
  upsertConnectionData,
  deleteConnectionData,
  getAction,
  updateActionStatus,
  getUnreadEmails,
  getUpcomingEvents,
} from './store'
import { syncCalendarBidirectional } from './calendar-sync'
import { writeAllWorkspaceContext } from '@/lib/workspace-writer'
import { notifyOpenClawBackground } from '@/lib/openclaw-webhook'

// ─── Retry Helper ─────────────────────────────────────────────────────────

async function retry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 1000 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === attempts - 1) throw e
      const delay = baseDelayMs * Math.pow(2, i) + Math.random() * 200
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error('retry: unreachable')
}

// ─── OAuth Flow ─────────────────────────────────────────────────────────────

/**
 * Build an HMAC-signed OAuth state parameter: connectionId.nonce.signature
 * This prevents CSRF — the callback verifies the signature before processing.
 */
function getRequiredSecret(): string {
  const secret = process.env.MYWAY_SECRET
  if (!secret) throw new Error('MYWAY_SECRET is required for OAuth flows. Set it in .env.local.')
  return secret
}

function buildOAuthState(connectionId: string): string {
  const nonce = randomBytes(16).toString('hex')
  const secret = getRequiredSecret()
  const payload = `${connectionId}.${nonce}`
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${sig}`
}

/**
 * Verify and extract connectionId from a signed OAuth state parameter.
 * Returns null if the signature is invalid.
 */
export function verifyOAuthState(state: string): string | null {
  const parts = state.split('.')
  if (parts.length !== 3) return null
  const [connectionId, nonce, sig] = parts
  const secret = process.env.MYWAY_SECRET
  if (!secret) return null
  const expected = createHmac('sha256', secret).update(`${connectionId}.${nonce}`).digest('hex')
  // Timing-safe comparison
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length) return null
  const { timingSafeEqual } = require('crypto') as typeof import('crypto')
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null
  return connectionId
}

/**
 * Start OAuth flow: create connection row, return redirect URL.
 */
export function startOAuth(
  db: Database,
  definitionId: string,
  redirectUri: string,
): { url: string; connectionId: string } {
  const def = getConnectionDefinition(definitionId)
  if (!def) throw new Error(`Unknown connection: ${definitionId}`)
  if (def.authType !== 'oauth2') throw new Error(`Connection ${definitionId} does not use OAuth2`)

  const provider = getProvider(definitionId)
  if (!provider) throw new Error(`No provider for: ${definitionId}`)

  // Create or update connection row
  upsertConnection(db, def.id, def.provider, 'disconnected')

  const state = buildOAuthState(def.id)
  const url = provider.getAuthUrl(def.authConfig, redirectUri, state)
  return { url, connectionId: def.id }
}

/**
 * Handle OAuth callback: exchange code, store tokens, trigger initial sync.
 */
export async function handleOAuthCallback(
  db: Database,
  connectionId: string,
  code: string,
  redirectUri: string,
): Promise<void> {
  const def = getConnectionDefinition(connectionId)
  if (!def) throw new Error(`Unknown connection: ${connectionId}`)

  const provider = getProvider(connectionId)
  if (!provider) throw new Error(`No provider for: ${connectionId}`)

  // Exchange code for tokens
  const tokens = await provider.exchangeCode(def.authConfig, code, redirectUri)

  // Store encrypted tokens
  saveTokens(db, connectionId, tokens)
  updateConnectionStatus(db, connectionId, 'connected')

  // Trigger initial sync (non-blocking)
  syncConnection(db, connectionId).catch((e) => {
    console.error(`[connections] Initial sync failed for ${connectionId}:`, e)
    updateConnectionStatus(db, connectionId, 'error', e instanceof Error ? e.message : String(e))
  })
}

// ─── Sync ───────────────────────────────────────────────────────────────────

/**
 * Sync a connection: refresh tokens if needed, pull data, upsert, publish events.
 */
export async function syncConnection(db: Database, connectionId: string): Promise<void> {
  const conn = getConnection(db, connectionId)
  if (!conn) throw new Error(`Connection not found: ${connectionId}`)
  if (conn.status === 'disconnected') throw new Error(`Connection ${connectionId} is disconnected`)

  const def = getConnectionDefinition(connectionId)
  if (!def) throw new Error(`Unknown connection definition: ${connectionId}`)

  const provider = getProvider(connectionId)
  if (!provider) throw new Error(`No provider for: ${connectionId}`)

  let tokens = getTokens(db, connectionId)
  if (!tokens) throw new Error(`No tokens for connection: ${connectionId}`)

  // Check token expiry and refresh if needed (with retry + exponential backoff)
  if (tokens.expiresAt && tokens.expiresAt < Math.floor(Date.now() / 1000) + 60) {
    if (!tokens.refreshToken) {
      updateConnectionStatus(db, connectionId, 'error', 'Access token expired — no refresh token available. Reconnect the service.')
      throw new Error('Access token expired and no refresh token available')
    }
    try {
      const refreshed = await retry(
        () => provider.refreshTokens(def.authConfig, tokens!.refreshToken!),
        { attempts: 3, baseDelayMs: 1000 },
      )
      saveTokens(db, connectionId, refreshed)
      tokens = getTokens(db, connectionId)!
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // If refresh token is revoked/invalid, mark as disconnected so UI prompts reconnect
      const isAuthError = msg.includes('invalid_grant') || msg.includes('Token has been revoked') || msg.includes('401')
      const status = isAuthError ? 'disconnected' as const : 'error' as const
      const errorMsg = isAuthError
        ? 'Session expired — please reconnect Google Workspace'
        : `Token refresh failed after 3 attempts: ${msg}`
      updateConnectionStatus(db, connectionId, status, errorMsg)
      throw e
    }
  }

  // Set status to syncing
  updateConnectionStatus(db, connectionId, 'syncing')

  try {
    const result = await provider.sync(db, connectionId, tokens, conn.syncCursor)

    // Upsert synced data
    if (result.items.length > 0) {
      upsertConnectionData(db, result.items as Parameters<typeof upsertConnectionData>[1])
    }

    // Update sync cursor
    if (result.cursor) {
      updateSyncCursor(db, connectionId, result.cursor)
    } else {
      updateSyncCursor(db, connectionId, null)
    }

    // Set status back to connected
    updateConnectionStatus(db, connectionId, 'connected')

    // ── Phase 3: Bus events, signals, notifications ─────────────────────
    try {
      publishSyncEvents(db, connectionId, result)
    } catch (e) {
      console.error('[connections] Failed to publish sync events:', e)
    }

    // ── Bidirectional calendar sync (replaces one-way autoCreateCalendarTasks) ──
    try {
      await syncCalendarBidirectional(db, connectionId, tokens)
    } catch (e) {
      console.error('[connections] Bidirectional calendar sync failed:', e)
    }

    // ── Write workspace context files (CALENDAR.md, TASKS.md, etc.) ──
    // Non-critical — these are read-only snapshots for OpenClaw's heartbeat/memory.
    try {
      const { getUserTimezone } = require('@/lib/timezone') as typeof import('@/lib/timezone')
      const tz = getUserTimezone(db)
      writeAllWorkspaceContext(db, tz)
    } catch (e) {
      console.warn('[connections] Workspace context write failed:', e)
    }

    if (result.errors?.length) {
      console.warn(`[connections] Sync completed with ${result.errors.length} errors:`, result.errors)
    }
  } catch (e) {
    updateConnectionStatus(db, connectionId, 'error', e instanceof Error ? e.message : String(e))
    throw e
  }
}

// ─── Action Execution ───────────────────────────────────────────────────────

/**
 * Execute an approved action (send email, create event, etc.).
 */
export async function executeAction(db: Database, actionId: string): Promise<void> {
  const action = getAction(db, actionId)
  if (!action) throw new Error(`Action not found: ${actionId}`)
  if (action.status !== 'approved' && action.status !== 'pending') {
    throw new Error(`Action ${actionId} is not pending/approved (status: ${action.status})`)
  }

  const tokens = getTokens(db, action.connectionId)
  if (!tokens) throw new Error(`No tokens for connection: ${action.connectionId}`)

  const provider = getProvider(action.connectionId)
  if (!provider) throw new Error(`No provider for: ${action.connectionId}`)

  try {
    const result = await provider.execute(tokens, action)
    if (result.success) {
      updateActionStatus(db, actionId, 'executed')
    } else {
      updateActionStatus(db, actionId, 'failed', result.error)
    }
  } catch (e) {
    updateActionStatus(db, actionId, 'failed', e instanceof Error ? e.message : String(e))
    throw e
  }
}

// ─── Disconnect ─────────────────────────────────────────────────────────────

/**
 * Disconnect a connection: delete tokens, data, set status.
 */
export function disconnectConnection(db: Database, connectionId: string): void {
  deleteTokens(db, connectionId)
  deleteConnectionData(db, connectionId)
  updateConnectionStatus(db, connectionId, 'disconnected')
}

// ─── Phase 3: Bus Events + Signals + Notifications ──────────────────────────

function publishSyncEvents(
  db: Database,
  connectionId: string,
  result: { items: Array<{ dataType: string; id: string; title?: string | null }> },
): void {
  // Lazy-import to avoid circular deps
  const { publish } = require('@/lib/store/bus') as typeof import('@/lib/store/bus')
  const { setSignals } = require('@/lib/store/personality') as typeof import('@/lib/store/personality')
  const { addNotification } = require('@/lib/store/notifications') as typeof import('@/lib/store/notifications')

  const newEmails = result.items.filter((i) => i.dataType === 'email')
  const newEvents = result.items.filter((i) => i.dataType === 'calendar_event')

  // Bus events
  for (const email of newEmails) {
    publish(db, {
      fromApp: 'connections',
      subject: 'connection.email.received',
      payload: { connectionId, emailId: email.id, title: email.title },
    })
  }

  for (const event of newEvents) {
    publish(db, {
      fromApp: 'connections',
      subject: 'connection.calendar.event_new',
      payload: { connectionId, eventId: event.id, title: event.title },
    })
  }

  publish(db, {
    fromApp: 'connections',
    subject: 'connection.sync_complete',
    payload: { connectionId, emailCount: newEmails.length, eventCount: newEvents.length },
  })

  // Personality signals
  const unreadEmails = getUnreadEmails(db, 100)
  const upcomingEvents = getUpcomingEvents(db, 1)

  const signals: { key: string; value: string; confidence?: number }[] = [
    { key: 'connection.email.unread_count', value: String(unreadEmails.length) },
    { key: 'connection.calendar.events_today', value: String(upcomingEvents.length) },
  ]

  if (upcomingEvents.length > 0) {
    const next = upcomingEvents[0]
    signals.push({ key: 'connection.calendar.next_event', value: `${next.title} at ${new Date((next.occurredAt ?? 0) * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}` })
  }

  setSignals(db, signals, 'connections')

  // ── OpenClaw webhook: new unknown email contacts ─────────────────────────
  // Fires an immediate heartbeat wake for emails from previously-unseen senders.
  // APort opportunity: this is an agent action that could require passport approval
  // before surfacing contact data — a real-world OAP use case.
  if (newEmails.length > 0) {
    try {
      const knownEmails = new Set(
        (db.prepare(`SELECT DISTINCT json_extract(metadata, '$.from') AS sender FROM connection_data WHERE data_type = 'email' AND json_extract(metadata, '$.from') IS NOT NULL`).all() as { sender: string }[])
          .map(r => r.sender?.toLowerCase())
          .filter(Boolean)
      )
      const seenThisSync = new Set<string>()
      for (const email of newEmails) {
        const meta = email as { metadata?: Record<string, unknown>; id: string; title?: string | null }
        const from = (meta as unknown as Record<string, unknown>).from as string | undefined
        if (!from || seenThisSync.has(from.toLowerCase())) continue
        seenThisSync.add(from.toLowerCase())
        // If this sender has only appeared in THIS sync batch (not in historical DB), it's new
        if (!knownEmails.has(from.toLowerCase())) {
          const subject = email.title ?? 'No subject'
          notifyOpenClawBackground(`New contact email: ${from} — "${subject}"`, 'now')
          break // one notification per sync cycle max
        }
      }
    } catch { /* non-critical */ }
  }

  // Notifications for upcoming events (within 15 minutes)
  const fifteenMinFromNow = Math.floor(Date.now() / 1000) + 15 * 60
  const imminentEvents = upcomingEvents.filter((e) => e.occurredAt && e.occurredAt <= fifteenMinFromNow)
  for (const evt of imminentEvents) {
    const meta = evt.metadata as Record<string, unknown>
    const link = (meta.hangoutLink as string) ?? (meta.conferenceLink as string) ?? evt.externalUrl
    addNotification(db, {
      appId: 'connections',
      title: `Event in 15 min: ${evt.title}`,
      body: meta.location ? `Location: ${meta.location}` : 'Check your calendar for details',
      type: 'info',
      priority: 2,
      actionUrl: link ?? undefined,
      expiresAt: (evt.occurredAt ?? 0) + 3600, // expire 1h after event start
    })
  }
}

