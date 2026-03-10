/**
 * GET  /api/notifications  — list pending notifications (shim → /api/store/notifications)
 * POST /api/notifications  — create a notification   (shim → /api/store/notifications)
 *
 * Kept for backward compatibility — cron agent and heartbeat call this URL.
 * All logic lives in RESOURCE_REGISTRY.notifications (resource-notifications.ts).
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { RESOURCE_REGISTRY } from '@/lib/store/registry'

const handler = RESOURCE_REGISTRY.notifications

export async function GET(req: NextRequest) {
  try {
    const db = getDb(getTenantId(req))
    const result = handler.list(db, { limit: 10 }) as { items: { id: string }[] }
    // Home screen page.tsx expects { notifications: [...] } shape
    return Response.json({ notifications: result.items })
  } catch (err) {
    console.error('[GET /api/notifications]', err)
    return Response.json({ notifications: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const db = getDb(getTenantId(req))
    const result = handler.create(db, body)
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create notification'
    console.error('[POST /api/notifications]', err)
    const status = msg.includes('required') ? 400 : 500
    return Response.json({ error: msg }, { status })
  }
}
