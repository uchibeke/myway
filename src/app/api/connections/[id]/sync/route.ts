/**
 * POST /api/connections/[id]/sync — trigger manual sync
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { getConnection } from '@/lib/connections/store'
import { syncConnection } from '@/lib/connections/manager'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const db = getDb(getTenantId(req))
    const connection = getConnection(db, id)
    if (!connection) {
      return Response.json({ error: `Connection not found: ${id}` }, { status: 404 })
    }
    if (connection.status === 'disconnected') {
      return Response.json({ error: `Connection ${id} is not connected` }, { status: 400 })
    }

    await syncConnection(db, id)
    return Response.json({ success: true, message: `Sync completed for ${id}` })
  } catch (e) {
    console.error('[POST /api/connections/sync]', e)
    return Response.json({ error: 'Sync failed' }, { status: 500 })
  }
}
