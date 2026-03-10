/**
 * GET /api/store/history?appId=somni&limit=5
 *
 * Returns recent conversations with their last assistant message.
 * Reusable across apps — each app transforms the result into domain-specific cards.
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { listConversations } from '@/lib/store/conversations'

interface HistoryRow {
  id: string
  conversation_id: string
  content: string
  metadata: string
  created_at: number
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const appId = sp.get('appId')
  if (!appId) {
    return Response.json({ error: 'appId is required' }, { status: 400 })
  }

  const limit = Math.min(Number(sp.get('limit') ?? 5), 20)

  try {
    const db = getDb(getTenantId(req))
    const convs = listConversations(db, appId, limit)

    // For each conversation, fetch the last assistant message
    const stmt = db.prepare(`
      SELECT id, conversation_id, content, metadata, created_at
      FROM messages
      WHERE conversation_id = ? AND role = 'assistant' AND is_deleted = 0
      ORDER BY created_at DESC
      LIMIT 1
    `)

    const items = convs
      .map((conv) => {
        const row = stmt.get(conv.id) as HistoryRow | undefined
        if (!row) return null
        return {
          conversationId: conv.id,
          title: conv.title,
          messageCount: conv.messageCount,
          lastContent: row.content,
          lastMetadata: JSON.parse(row.metadata ?? '{}'),
          lastMessageAt: row.created_at,
        }
      })
      .filter(Boolean)

    return Response.json(items)
  } catch (err) {
    console.error('[GET /api/store/history]', err)
    return Response.json({ error: 'Failed to fetch history' }, { status: 500 })
  }
}
