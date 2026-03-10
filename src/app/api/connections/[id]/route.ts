/**
 * GET    /api/connections/[id] — single connection status + recent data
 * DELETE /api/connections/[id] — disconnect + clean up
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { getConnection, getConnectionData } from '@/lib/connections/store'
import { getConnectionDefinition, isBuiltIn, getBuiltInData } from '@/lib/connections/registry'
import { disconnectConnection } from '@/lib/connections/manager'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const db = getDb(getTenantId(req))

    // Built-in connections don't have DB rows — serve data directly from the provider
    if (isBuiltIn(id)) {
      const def = getConnectionDefinition(id)
      if (!def) return Response.json({ error: `Unknown connection: ${id}` }, { status: 404 })

      const queryParams: Record<string, string> = {}
      req.nextUrl.searchParams.forEach((v, k) => { queryParams[k] = v })
      const data = getBuiltInData(db, id, queryParams)

      return Response.json({
        connection: { id, provider: def.provider, status: 'connected', connectedAt: null, lastSyncAt: null, error: null },
        data,
      })
    }

    const connection = getConnection(db, id)
    if (!connection) {
      return Response.json({ error: `Connection not found: ${id}` }, { status: 404 })
    }

    const recentData = getConnectionData(db, { connectionId: id, limit: 20 })

    return Response.json({ connection, recentData })
  } catch (e) {
    console.error('[GET /api/connections/[id]]', e)
    return Response.json({ error: 'Failed to fetch connection' }, { status: 500 })
  }
}

export async function DELETE(
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

    disconnectConnection(db, id)
    return Response.json({ success: true, message: `Disconnected ${id}` })
  } catch (e) {
    console.error('[DELETE /api/connections/[id]]', e)
    return Response.json({ error: 'Failed to disconnect' }, { status: 500 })
  }
}
