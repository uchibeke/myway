/**
 * POST /api/aport/sync
 *
 * Manual full-backfill: reads the entire audit log and upserts all entries
 * into the guardrail_events DB table. Idempotent — safe to call multiple times.
 *
 * Under normal operation this is unnecessary — the AuditTailer singleton
 * backfills the log on startup and keeps the DB current via tail polling.
 *
 * Useful for:
 *   - First-time setup (before the server has restarted with the tailer)
 *   - Recovery after a crash where the tailer missed writes
 *   - Manual "force sync" from the UI sync button
 *
 * Returns: { synced: number, skipped: number, total: number }
 */

import { NextRequest } from 'next/server'
import { getAportConfig } from '@/lib/aport/config'
import { readAuditLog } from '@/lib/aport/audit-parser'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { RESOURCE_REGISTRY } from '@/lib/store/registry'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Logged-in user: audit events are written to tenant DB by verifyAction().
  // No local audit.log to sync from.
  if (getTenantId(req)) {
    return Response.json({ synced: 0, total: 0, skipped: 0, message: 'Audit events are recorded inline for logged-in users' })
  }

  try {
    const config = getAportConfig()
    const events = await readAuditLog(config.auditLog, { limit: 50_000 })

    if (events.length === 0) {
      return Response.json({ synced: 0, total: 0, skipped: 0, message: 'Audit log empty or not found' })
    }

    const db      = getDb(getTenantId(req))
    const handler = RESOURCE_REGISTRY['guardrail-events']
    let synced  = 0
    let skipped = 0

    for (const ev of events) {
      try {
        handler.create(db, {
          id:        ev.id,
          timestamp: ev.timestamp,
          tool:      ev.tool,
          allowed:   ev.allowed,
          policy:    ev.policy,
          code:      ev.code,
          context:   ev.context,
        })
        synced++
      } catch {
        // ON CONFLICT DO UPDATE means real errors here are rare; log and continue
        skipped++
      }
    }

    return Response.json({ synced, skipped, total: events.length })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return Response.json({ error: message }, { status: 500 })
  }
}
