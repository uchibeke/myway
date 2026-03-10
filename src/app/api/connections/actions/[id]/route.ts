/**
 * POST /api/connections/actions/[id] — approve or reject an action
 *
 * Body: { decision: 'approve' | 'reject' }
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { getAction, updateActionStatus } from '@/lib/connections/store'
import { executeAction } from '@/lib/connections/manager'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const { decision } = await req.json()
    if (!decision || !['approve', 'reject'].includes(decision)) {
      return Response.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 })
    }

    const db = getDb(getTenantId(req))
    const action = getAction(db, id)
    if (!action) {
      return Response.json({ error: `Action not found: ${id}` }, { status: 404 })
    }

    if (action.status !== 'pending') {
      return Response.json({ error: `Action ${id} is not pending (status: ${action.status})` }, { status: 400 })
    }

    if (decision === 'reject') {
      updateActionStatus(db, id, 'rejected')
      return Response.json({ success: true, message: 'Action rejected' })
    }

    // Approve and execute
    updateActionStatus(db, id, 'approved')
    await executeAction(db, id)

    return Response.json({ success: true, message: 'Action approved and executed' })
  } catch (e) {
    console.error('[POST /api/connections/actions]', e)
    return Response.json({ error: 'Action execution failed' }, { status: 500 })
  }
}
