/**
 * GET  /api/connections — list all connections + status
 * POST /api/connections — initiate new connection (body: {definitionId})
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { listConnections } from '@/lib/connections/store'
import { getLiveDefinitions, getConnectionDefinition } from '@/lib/connections/registry'

export async function GET(req: NextRequest) {
  try {
    const db = getDb(getTenantId(req))
    const connections = listConnections(db)
    const definitions = getLiveDefinitions()

    return Response.json({
      connections,
      definitions: definitions.map((d) => ({
        id: d.id,
        name: d.name,
        icon: d.icon,
        color: d.color,
        description: d.description,
        dataTypes: d.dataTypes,
        authType: d.authType,
        live: d.live,
      })),
    })
  } catch (e) {
    console.error('[GET /api/connections]', e)
    return Response.json({ error: 'Failed to list connections' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { definitionId } = await req.json()
    if (!definitionId) {
      return Response.json({ error: 'definitionId is required' }, { status: 400 })
    }

    const def = getConnectionDefinition(definitionId)
    if (!def) {
      return Response.json({ error: `Unknown connection: ${definitionId}` }, { status: 404 })
    }

    return Response.json({
      definition: {
        id: def.id,
        name: def.name,
        authType: def.authType,
        description: def.description,
      },
      message: `Use POST /api/connections/auth/start to begin the ${def.authType} flow`,
    })
  } catch (e) {
    console.error('[POST /api/connections]', e)
    return Response.json({ error: 'Failed to create connection' }, { status: 500 })
  }
}
