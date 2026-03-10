/**
 * GET /api/aport/events
 *
 * Returns paginated APort guardrail events from the DB cache.
 * Run POST /api/aport/sync first to populate the cache from the audit log.
 *
 * Query params:
 *   limit   — items per page (default 50, max 500)
 *   offset  — pagination offset (default 0)
 *   allowed — filter: "0" = blocked only, "1" = allowed only, absent = all
 *   tool    — filter by tool name e.g. "system.command.execute"
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { RESOURCE_REGISTRY } from '@/lib/store/registry'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const handler = RESOURCE_REGISTRY['guardrail-events']

  try {
    const db = getDb(getTenantId(req))
    const result = await handler.list(db, {
      limit:   Number(searchParams.get('limit')  ?? 50),
      offset:  Number(searchParams.get('offset') ?? 0),
      allowed: searchParams.get('allowed') ?? undefined,
      tool:    searchParams.get('tool')    ?? undefined,
    })
    return Response.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return Response.json({ error: message }, { status: 500 })
  }
}
