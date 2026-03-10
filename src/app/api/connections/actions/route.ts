/**
 * GET /api/connections/actions — list pending connection actions.
 *
 * Query params:
 *   conversationId — filter by conversation (required)
 *   status         — filter by status (default: 'pending')
 *
 * Used by AppShell after streaming completes to check if the AI
 * proposed any write actions (email drafts, calendar events).
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import type { ConnectionAction, ActionStatus } from '@/lib/connections/types'

type ActionRow = Record<string, unknown>

function rowToAction(row: ActionRow): ConnectionAction {
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

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get('conversationId')
  const status = req.nextUrl.searchParams.get('status') ?? 'pending'

  if (!conversationId) {
    return Response.json({ error: 'conversationId is required' }, { status: 400 })
  }

  try {
    const db = getDb(getTenantId(req))
    const rows = db.prepare(`
      SELECT * FROM connection_actions
      WHERE conversation_id = ? AND status = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(conversationId, status) as ActionRow[]

    return Response.json(rows.map(rowToAction))
  } catch {
    // Table might not exist yet — return empty
    return Response.json([])
  }
}
