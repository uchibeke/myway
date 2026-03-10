/**
 * POST   /api/notifications/[id]  — dismiss notification (shim → registry)
 * DELETE /api/notifications/[id]  — alias for dismiss
 *
 * Kept for backward compatibility. Logic lives in resource-notifications.ts.
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { RESOURCE_REGISTRY } from '@/lib/store/registry'

const handler = RESOURCE_REGISTRY.notifications

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const db = getDb(getTenantId(req))
    const result = handler.action!(db, 'dismiss', id, {})
    return Response.json(result)
  } catch (err) {
    console.error('[POST /api/notifications/[id]]', err)
    return Response.json({ error: 'Failed to dismiss' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return POST(req, { params })
}
