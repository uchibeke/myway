/**
 * Myway background scheduler — server-only singleton.
 *
 * Runs a periodic sync of all connected services so the agent always has
 * fresh context. Started once at server startup via src/instrumentation.ts.
 *
 * Interval: 5 minutes (configurable via MYWAY_SYNC_INTERVAL_MS)
 *
 * What each sync does (via syncConnection):
 *   - Refreshes OAuth tokens if expiring
 *   - Pulls new emails from Gmail (incremental, uses pageToken cursor)
 *   - Pulls calendar changes (incremental, uses syncToken cursor)
 *   - Writes TASKS.md / CALENDAR.md / CONNECTIONS.md workspace snapshots
 *   - Fires OpenClaw webhook wake if new significant events found
 *
 * SERVER ONLY — never import from client components.
 */

import { getDb } from '@/lib/db'
import { listConnections } from '@/lib/connections/store'
import { syncConnection } from '@/lib/connections/manager'

const INTERVAL_MS = parseInt(process.env.MYWAY_SYNC_INTERVAL_MS ?? '', 10) || 5 * 60 * 1000

let _started = false
let _timer: ReturnType<typeof setInterval> | null = null

async function runSync(): Promise<void> {
  let db
  try {
    db = getDb()
  } catch (e) {
    console.warn('[scheduler] DB not ready yet, skipping sync:', e)
    return
  }

  let connections: ReturnType<typeof listConnections>
  try {
    connections = listConnections(db)
  } catch (e) {
    console.warn('[scheduler] Could not list connections, skipping:', e)
    return
  }

  const active = connections.filter(c => c.status === 'connected')
  if (active.length === 0) return

  for (const conn of active) {
    try {
      await syncConnection(db, conn.id)
      console.log(`[scheduler] Synced ${conn.id}`)
    } catch (e) {
      // Non-fatal — log and continue with other connections
      console.error(`[scheduler] Sync failed for ${conn.id}:`, e instanceof Error ? e.message : e)
    }
  }
}

/**
 * Start the background scheduler.
 * Safe to call multiple times — only starts once per process.
 */
export function startScheduler(): void {
  if (_started) return
  _started = true

  console.log(`[scheduler] Starting — sync interval ${INTERVAL_MS / 1000}s`)

  // Run immediately on startup (catches up after restarts)
  runSync().catch(e => console.error('[scheduler] Initial sync error:', e))

  // Then run on interval
  _timer = setInterval(() => {
    runSync().catch(e => console.error('[scheduler] Interval sync error:', e))
  }, INTERVAL_MS)

  // Allow process to exit cleanly (don't hold event loop open)
  if (_timer.unref) _timer.unref()
}

/** Stop the scheduler (for graceful shutdown / testing). */
export function stopScheduler(): void {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
  _started = false
}
