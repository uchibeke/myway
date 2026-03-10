/**
 * GET /api/settings/system — Rich system data for the Settings System tab.
 *
 * Extends the health check with top apps (resolved names), full cron job list,
 * CPU details, system memory, disk filesystem stats, and OS info.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { getApp } from '@/lib/apps'
import { isHostedMode } from '@/lib/hosted-storage'
import {
  getProcessInfo,
  getCpuInfo,
  getSystemMemory,
  getOsInfo,
  getPm2Info,
  getDiskInfo,
  getDbStats,
  getTopApps,
  checkOpenClaw,
  getCronStatus,
  getHealthThresholds,
  determineStatus,
} from '@/lib/system-health'

export async function GET(req: NextRequest) {
  try {
    const hosted = isHostedMode()
    const proc = getProcessInfo()
    const cpu = getCpuInfo()
    const memory = getSystemMemory()
    const os = getOsInfo()
    const pm2 = getPm2Info()
    const disk = getDiskInfo()
    const thresholds = getHealthThresholds()

    const db = getDb(getTenantId(req))
    const dbStats = getDbStats(db)
    const topAppsRaw = getTopApps(db, 5)
    const openclaw = await checkOpenClaw()
    const cron = getCronStatus(db)

    const status = determineStatus(proc, pm2, openclaw, disk, thresholds)

    const topApps = topAppsRaw.map((a) => {
      const app = getApp(a.appId)
      return {
        appId: a.appId,
        name: app?.name ?? a.appId,
        icon: app?.icon ?? '',
        messageCount: a.messageCount,
      }
    })

    // In hosted mode, strip server internals — regular users should not see
    // hostname, kernel, mount points, PIDs, or disk paths. Only expose
    // user-relevant stats (top apps, db counts, AI backend status).
    if (hosted) {
      return NextResponse.json({
        status,
        timestamp: Date.now(),
        db: { messages: dbStats.messages, conversations: dbStats.conversations },
        topApps,
        aiBackend: { mode: openclaw.reachable ? 'openclaw' : 'byok' },
        cron,
      })
    }

    return NextResponse.json({
      status,
      timestamp: Date.now(),
      process: {
        uptimeSeconds: proc.uptimeSeconds,
        memoryMb: proc.memoryMb,
        heapUsedMb: proc.heapUsedMb,
        pid: proc.pid,
      },
      cpu,
      memory,
      os,
      pm2: {
        available: pm2.available,
        processes: pm2.processes,
      },
      disk,
      db: dbStats,
      topApps,
      openclaw,
      cron,
      thresholds,
    })
  } catch (err) {
    console.error('[GET /api/settings/system]', err)
    return NextResponse.json(
      { error: 'Failed to load system info' },
      { status: 500 },
    )
  }
}
