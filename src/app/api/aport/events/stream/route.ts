/**
 * GET /api/aport/events/stream
 *
 * Server-Sent Events endpoint for real-time audit log monitoring.
 *
 * Two modes:
 *   Self-hosted (file mode): subscribes to the process-scoped AuditTailer
 *     that tails the local audit.log file. Zero per-connection file I/O.
 *   Hosted (DB mode): polls the tenant's guardrail_events table every 2s.
 *     Fully tenant-isolated — no cross-user event leaking.
 *
 * Events emitted to the client:
 *   data: { type: "event",     event: GuardrailEvent }  — new audit entry
 *   data: { type: "heartbeat"                         }  — keep-alive every 5s
 *
 * Load sequence (frontend):
 *   1. GET /api/aport/events        — initial page of events from DB (fast, paginated)
 *   2. EventSource /api/aport/events/stream — new events pushed live from here
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEARTBEAT_INTERVAL_MS = 5000
const DB_POLL_INTERVAL_MS = 2000
const SSE_HEADERS = {
  'Content-Type':      'text/event-stream',
  'Cache-Control':     'no-cache, no-transform',
  'Connection':        'keep-alive',
  'X-Accel-Buffering': 'no',   // disable nginx/proxy response buffering
} as const

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder()
  let closed = false

  const tenantId = getTenantId(req)
  const isTenant = !!tenantId

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: object) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {
          closed = true
        }
      }

      // ── Periodic keep-alive ──────────────────────────────────────────────
      const heartbeat = setInterval(() => send({ type: 'heartbeat' }), HEARTBEAT_INTERVAL_MS)
      send({ type: 'heartbeat' })

      // ── Cleanup on client disconnect ─────────────────────────────────────
      const cleanups: (() => void)[] = [() => clearInterval(heartbeat)]

      req.signal.addEventListener('abort', () => {
        closed = true
        for (const fn of cleanups) fn()
        try { controller.close() } catch { /* already closed */ }
      })

      if (isTenant) {
        // ── DB mode: poll tenant DB for new events ─────────────────────────
        let lastSyncedAt = Math.floor(Date.now() / 1000)

        const poll = setInterval(() => {
          if (closed) return
          try {
            const db = getDb(tenantId)
            const rows = db.prepare(
              `SELECT id, timestamp, tool, allowed, policy, code, context
               FROM guardrail_events
               WHERE synced_at > ?
               ORDER BY synced_at ASC
               LIMIT 50`,
            ).all(lastSyncedAt) as {
              id: string; timestamp: number; tool: string; allowed: number
              policy: string; code: string; context: string
            }[]

            for (const row of rows) {
              send({
                type: 'event',
                event: { ...row, allowed: row.allowed === 1 },
              })
            }

            if (rows.length > 0) {
              lastSyncedAt = Math.floor(Date.now() / 1000)
            }
          } catch { /* DB read failed — skip this tick */ }
        }, DB_POLL_INTERVAL_MS)

        cleanups.push(() => clearInterval(poll))
      } else {
        // ── File mode: subscribe to the singleton tailer ───────────────────
        try {
          const { auditTailer } = require('@/lib/aport/audit-tailer') as typeof import('@/lib/aport/audit-tailer')
          const onEvent = (ev: unknown) => send({ type: 'event', event: ev })
          auditTailer.on('event', onEvent)
          cleanups.push(() => auditTailer.off('event', onEvent))
        } catch { /* tailer not available */ }
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
