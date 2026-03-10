/**
 * GET  /api/tasks  — list tasks (shim → /api/store/tasks)
 * POST /api/tasks  — create a task (shim → /api/store/tasks)
 *
 * Kept for backward compatibility — cron agent and heartbeat call this URL.
 * All logic lives in RESOURCE_REGISTRY.tasks (resource-tasks.ts).
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { RESOURCE_REGISTRY } from '@/lib/store/registry'

const handler = RESOURCE_REGISTRY.tasks

export async function GET(req: NextRequest) {
  try {
    const db = getDb(getTenantId(req))
    const sp = req.nextUrl.searchParams
    const result = handler.list(db, {
      limit: Number(sp.get('limit') ?? '20'),
      today: sp.get('today') === '1',
    }) as { items: unknown[]; summary: unknown }
    // Legacy callers expect { tasks: [...], summary: {...} }
    return Response.json({ tasks: result.items, summary: result.summary })
  } catch (err) {
    console.error('[GET /api/tasks]', err)
    return Response.json({ tasks: [], summary: null })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const db = getDb(getTenantId(req))
    const result = handler.create(db, body)
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create task'
    console.error('[POST /api/tasks]', err)
    const status = msg.includes('required') ? 400 : 500
    return Response.json({ error: msg }, { status })
  }
}
