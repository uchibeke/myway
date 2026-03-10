/**
 * Connections store — CRUD operations for connections, tokens, data, and actions.
 *
 * Mirrors store/tasks.ts: all reads/writes go through typed functions,
 * row-to-object helpers handle DB ↔ TypeScript conversion.
 */

import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { encryptToken, decryptToken } from './crypto'
import type {
  Connection,
  ConnectionTokens,
  ConnectionData,
  ConnectionAction,
  ConnectionStatus,
  ActionStatus,
  DataType,
  TokenResponse,
} from './types'

// ─── SyncPair type ──────────────────────────────────────────────────────────

export type SyncPair = {
  id: string
  taskId: string
  calendarEventId: string
  connectionId: string
  lastTitle: string | null
  lastDescription: string | null
  lastDueAt: number | null
  lastLocation: string | null
  lastPushedAt: number | null
  lastPulledAt: number | null
  googleUpdated: string | null
  taskUpdatedAt: number | null
  createdAt: number
  updatedAt: number
}

// ─── Row converters ─────────────────────────────────────────────────────────

function rowToConnection(row: Record<string, unknown>): Connection {
  let config: Record<string, unknown> = {}
  try { config = JSON.parse(row.config as string) } catch { /* empty */ }
  return {
    id: row.id as string,
    provider: row.provider as string,
    status: row.status as ConnectionStatus,
    connectedAt: row.connected_at as number | null,
    lastSyncAt: row.last_sync_at as number | null,
    syncCursor: row.sync_cursor as string | null,
    error: row.error as string | null,
    config,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

function rowToTokens(row: Record<string, unknown>): ConnectionTokens {
  return {
    connectionId: row.connection_id as string,
    accessToken: decryptToken(row.access_token as string),
    refreshToken: row.refresh_token ? decryptToken(row.refresh_token as string) : null,
    tokenType: row.token_type as string,
    expiresAt: row.expires_at as number | null,
    scopes: row.scopes as string | null,
    raw: row.raw ? decryptToken(row.raw as string) : null,
    updatedAt: row.updated_at as number,
  }
}

function rowToData(row: Record<string, unknown>): ConnectionData {
  let metadata: Record<string, unknown> = {}
  try { metadata = JSON.parse(row.metadata as string) } catch { /* empty */ }
  return {
    id: row.id as string,
    connectionId: row.connection_id as string,
    dataType: row.data_type as DataType,
    title: row.title as string | null,
    summary: row.summary as string | null,
    content: row.content as string | null,
    metadata,
    externalUrl: row.external_url as string | null,
    occurredAt: row.occurred_at as number | null,
    syncedAt: row.synced_at as number,
    isRead: (row.is_read as number) === 1,
    isActionable: (row.is_actionable as number) === 1,
    actionStatus: row.action_status as string,
  }
}

function rowToAction(row: Record<string, unknown>): ConnectionAction {
  let payload: Record<string, unknown> = {}
  try { payload = JSON.parse(row.payload as string) } catch { /* empty */ }
  return {
    id: row.id as string,
    connectionId: row.connection_id as string,
    actionType: row.action_type as string,
    status: row.status as ActionStatus,
    payload,
    sourceDataId: row.source_data_id as string | null,
    sourceAppId: row.source_app_id as string | null,
    conversationId: row.conversation_id as string | null,
    createdAt: row.created_at as number,
    executedAt: row.executed_at as number | null,
    error: row.error as string | null,
  }
}

// ─── Connections CRUD ───────────────────────────────────────────────────────

export function getConnection(db: Database, id: string): Connection | null {
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToConnection(row) : null
}

export function listConnections(db: Database): Connection[] {
  const rows = db.prepare('SELECT * FROM connections ORDER BY created_at DESC').all() as Record<string, unknown>[]
  return rows.map(rowToConnection)
}

export function upsertConnection(db: Database, id: string, provider: string, status?: ConnectionStatus): void {
  db.prepare(`
    INSERT INTO connections (id, provider, status)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      updated_at = unixepoch()
  `).run(id, provider, status ?? 'disconnected')
}

export function updateConnectionStatus(db: Database, id: string, status: ConnectionStatus, error?: string | null): void {
  const now = Math.floor(Date.now() / 1000)
  if (status === 'connected') {
    db.prepare(`
      UPDATE connections SET status = ?, error = ?, connected_at = ?, updated_at = ?
      WHERE id = ?
    `).run(status, error ?? null, now, now, id)
  } else {
    db.prepare(`
      UPDATE connections SET status = ?, error = ?, updated_at = ?
      WHERE id = ?
    `).run(status, error ?? null, now, id)
  }
}

export function updateSyncCursor(db: Database, id: string, cursor: string | null): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE connections SET sync_cursor = ?, last_sync_at = ?, updated_at = ? WHERE id = ?
  `).run(cursor, now, now, id)
}

export function deleteConnection(db: Database, id: string): void {
  db.prepare('DELETE FROM connections WHERE id = ?').run(id)
}

// ─── Tokens ─────────────────────────────────────────────────────────────────

export function getTokens(db: Database, connectionId: string): ConnectionTokens | null {
  const row = db.prepare('SELECT * FROM connection_tokens WHERE connection_id = ?').get(connectionId) as Record<string, unknown> | undefined
  if (!row) return null
  try {
    return rowToTokens(row)
  } catch {
    return null
  }
}

export function saveTokens(db: Database, connectionId: string, tokens: TokenResponse): void {
  db.prepare(`
    INSERT INTO connection_tokens (connection_id, access_token, refresh_token, token_type, expires_at, scopes, raw, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(connection_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, connection_tokens.refresh_token),
      token_type = excluded.token_type,
      expires_at = excluded.expires_at,
      scopes = excluded.scopes,
      raw = excluded.raw,
      updated_at = unixepoch()
  `).run(
    connectionId,
    encryptToken(tokens.accessToken),
    tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
    tokens.tokenType ?? 'Bearer',
    tokens.expiresAt ?? null,
    tokens.scopes ?? null,
    tokens.raw ? encryptToken(tokens.raw) : null,
  )
}

export function deleteTokens(db: Database, connectionId: string): void {
  db.prepare('DELETE FROM connection_tokens WHERE connection_id = ?').run(connectionId)
}

// ─── Connection Data ────────────────────────────────────────────────────────

export function upsertConnectionData(db: Database, items: Omit<ConnectionData, 'syncedAt'>[]): void {
  if (items.length === 0) return
  const stmt = db.prepare(`
    INSERT INTO connection_data (id, connection_id, data_type, title, summary, content, metadata, external_url, occurred_at, is_read, is_actionable, action_status)
    VALUES (@id, @connectionId, @dataType, @title, @summary, @content, @metadata, @externalUrl, @occurredAt, @isRead, @isActionable, @actionStatus)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      content = excluded.content,
      metadata = excluded.metadata,
      external_url = excluded.external_url,
      occurred_at = excluded.occurred_at,
      is_read = excluded.is_read,
      is_actionable = excluded.is_actionable,
      synced_at = unixepoch()
  `)

  db.transaction(() => {
    for (const item of items) {
      stmt.run({
        id: item.id,
        connectionId: item.connectionId,
        dataType: item.dataType,
        title: item.title ?? null,
        summary: item.summary ?? null,
        content: item.content ?? null,
        metadata: JSON.stringify(item.metadata ?? {}),
        externalUrl: item.externalUrl ?? null,
        occurredAt: item.occurredAt ?? null,
        isRead: item.isRead ? 1 : 0,
        isActionable: item.isActionable ? 1 : 0,
        actionStatus: item.actionStatus ?? 'pending',
      })
    }
  })()
}

export type ConnectionDataFilters = {
  dataType?: DataType
  connectionId?: string
  isRead?: boolean
  isActionable?: boolean
  limit?: number
}

export function getConnectionData(db: Database, filters: ConnectionDataFilters = {}): ConnectionData[] {
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters.dataType) { conditions.push('data_type = ?'); params.push(filters.dataType) }
  if (filters.connectionId) { conditions.push('connection_id = ?'); params.push(filters.connectionId) }
  if (filters.isRead !== undefined) { conditions.push('is_read = ?'); params.push(filters.isRead ? 1 : 0) }
  if (filters.isActionable !== undefined) { conditions.push('is_actionable = ?'); params.push(filters.isActionable ? 1 : 0) }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filters.limit ?? 50

  const rows = db.prepare(`
    SELECT * FROM connection_data ${where}
    ORDER BY occurred_at DESC
    LIMIT ?
  `).all(...params, limit) as Record<string, unknown>[]

  return rows.map(rowToData)
}

export function getUnreadEmails(db: Database, limit = 10): ConnectionData[] {
  const rows = db.prepare(`
    SELECT * FROM connection_data
    WHERE data_type = 'email' AND is_read = 0
    ORDER BY occurred_at DESC
    LIMIT ?
  `).all(limit) as Record<string, unknown>[]
  return rows.map(rowToData)
}

export function getUpcomingEvents(db: Database, daysAhead = 1, tz = 'UTC'): ConnectionData[] {
  const now = Math.floor(Date.now() / 1000)
  const until = now + daysAhead * 86400
  const rows = db.prepare(`
    SELECT * FROM connection_data
    WHERE data_type = 'calendar_event'
      AND occurred_at >= ?
      AND occurred_at <= ?
    ORDER BY occurred_at ASC
    LIMIT 50
  `).all(now, until) as Record<string, unknown>[]
  return rows.map(rowToData)
}

export function deleteConnectionData(db: Database, connectionId: string): void {
  db.prepare('DELETE FROM connection_data WHERE connection_id = ?').run(connectionId)
}

// ─── Actions ────────────────────────────────────────────────────────────────

export function createAction(
  db: Database,
  opts: {
    connectionId: string
    actionType: string
    payload: Record<string, unknown>
    sourceDataId?: string
    sourceAppId?: string
    conversationId?: string
  },
): string {
  const id = randomUUID().slice(0, 16)
  db.prepare(`
    INSERT INTO connection_actions (id, connection_id, action_type, payload, source_data_id, source_app_id, conversation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.connectionId,
    opts.actionType,
    JSON.stringify(opts.payload),
    opts.sourceDataId ?? null,
    opts.sourceAppId ?? null,
    opts.conversationId ?? null,
  )
  return id
}

export function getAction(db: Database, id: string): ConnectionAction | null {
  const row = db.prepare('SELECT * FROM connection_actions WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToAction(row) : null
}

export function getPendingActions(db: Database, connectionId?: string): ConnectionAction[] {
  const rows = connectionId
    ? db.prepare(`SELECT * FROM connection_actions WHERE connection_id = ? AND status = 'pending' ORDER BY created_at DESC`).all(connectionId) as Record<string, unknown>[]
    : db.prepare(`SELECT * FROM connection_actions WHERE status = 'pending' ORDER BY created_at DESC`).all() as Record<string, unknown>[]
  return rows.map(rowToAction)
}

export function updateActionStatus(db: Database, id: string, status: ActionStatus, error?: string | null): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE connection_actions SET status = ?, error = ?, executed_at = ?
    WHERE id = ?
  `).run(status, error ?? null, status === 'executed' || status === 'failed' ? now : null, id)
}

// ─── Sync Pairs ──────────────────────────────────────────────────────────────

function rowToSyncPair(row: Record<string, unknown>): SyncPair {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    calendarEventId: row.calendar_event_id as string,
    connectionId: row.connection_id as string,
    lastTitle: row.last_title as string | null,
    lastDescription: row.last_description as string | null,
    lastDueAt: row.last_due_at as number | null,
    lastLocation: row.last_location as string | null,
    lastPushedAt: row.last_pushed_at as number | null,
    lastPulledAt: row.last_pulled_at as number | null,
    googleUpdated: row.google_updated as string | null,
    taskUpdatedAt: row.task_updated_at as number | null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function getSyncPairByEventId(db: Database, eventId: string): SyncPair | null {
  const row = db.prepare('SELECT * FROM sync_pairs WHERE calendar_event_id = ?').get(eventId) as Record<string, unknown> | undefined
  return row ? rowToSyncPair(row) : null
}

export function getSyncPairByTaskId(db: Database, taskId: string): SyncPair | null {
  const row = db.prepare('SELECT * FROM sync_pairs WHERE task_id = ?').get(taskId) as Record<string, unknown> | undefined
  return row ? rowToSyncPair(row) : null
}

export function upsertSyncPair(db: Database, pair: Omit<SyncPair, 'createdAt' | 'updatedAt'>): void {
  db.prepare(`
    INSERT INTO sync_pairs (
      id, task_id, calendar_event_id, connection_id,
      last_title, last_description, last_due_at, last_location,
      last_pushed_at, last_pulled_at, google_updated, task_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_title = excluded.last_title,
      last_description = excluded.last_description,
      last_due_at = excluded.last_due_at,
      last_location = excluded.last_location,
      last_pushed_at = excluded.last_pushed_at,
      last_pulled_at = excluded.last_pulled_at,
      google_updated = excluded.google_updated,
      task_updated_at = excluded.task_updated_at,
      updated_at = unixepoch()
  `).run(
    pair.id,
    pair.taskId,
    pair.calendarEventId,
    pair.connectionId,
    pair.lastTitle ?? null,
    pair.lastDescription ?? null,
    pair.lastDueAt ?? null,
    pair.lastLocation ?? null,
    pair.lastPushedAt ?? null,
    pair.lastPulledAt ?? null,
    pair.googleUpdated ?? null,
    pair.taskUpdatedAt ?? null,
  )
}

export function deleteSyncPair(db: Database, id: string): void {
  db.prepare('DELETE FROM sync_pairs WHERE id = ?').run(id)
}

/**
 * Find sync_pairs where the linked task has been updated since last sync.
 * Used by push phase to detect local changes.
 */
export function getDirtySyncPairs(db: Database, connectionId: string): (SyncPair & { task: { title: string; description: string | null; dueAt: number | null; updatedAt: number; context: string } })[] {
  const rows = db.prepare(`
    SELECT sp.*, t.title as t_title, t.description as t_description,
           t.due_at as t_due_at, t.updated_at as t_updated_at, t.context as t_context
    FROM sync_pairs sp
    JOIN tasks t ON t.id = sp.task_id
    WHERE sp.connection_id = ?
      AND t.updated_at > sp.task_updated_at
      AND t.is_deleted = 0
  `).all(connectionId) as Record<string, unknown>[]

  return rows.map((row) => ({
    ...rowToSyncPair(row),
    task: {
      title: row.t_title as string,
      description: row.t_description as string | null,
      dueAt: row.t_due_at as number | null,
      updatedAt: row.t_updated_at as number,
      context: row.t_context as string,
    },
  }))
}
