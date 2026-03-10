/**
 * Usage Sync Cron — periodic push of token usage to AppRoom.
 *
 * Runs every hour (configurable via MYWAY_USAGE_SYNC_INTERVAL_MS).
 * Uses usage-sync.ts for the actual sync logic.
 *
 * Started at server boot via instrumentation.ts.
 * Silently skips if MYWAY_APPROOM_URL is not configured.
 *
 * SERVER ONLY.
 */

import { syncUsageToAppRoom } from './usage-sync'

const INTERVAL_MS = parseInt(process.env.MYWAY_USAGE_SYNC_INTERVAL_MS ?? '', 10) || 60 * 60 * 1000 // 1 hour

let _started = false
let _timer: ReturnType<typeof setInterval> | null = null

async function tick(): Promise<void> {
  try {
    const result = await syncUsageToAppRoom()
    if (result && result.totalRecords > 0) {
      console.log(`[usage-sync-cron] Synced ${result.totalRecords} records (${result.totalTokens} tokens) from ${result.tenantsSynced} tenant(s)`)
    }
  } catch (err) {
    console.error('[usage-sync-cron] Tick failed:', err instanceof Error ? err.message : err)
  }
}

export function startUsageSyncCron(): void {
  if (_started) return

  // Skip if AppRoom not configured
  if (!process.env.MYWAY_APPROOM_URL?.trim()) {
    return
  }

  _started = true

  // Initial sync after 30s (let server settle)
  setTimeout(() => {
    tick()
    _timer = setInterval(tick, INTERVAL_MS)
  }, 30_000)

  console.log(`[usage-sync-cron] Started (interval: ${Math.round(INTERVAL_MS / 60_000)}min)`)
}

export function stopUsageSyncCron(): void {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
  _started = false
}
