/**
 * GET /api/health — Lightweight health check for heartbeat agent consumption.
 *
 * Returns structured JSON with process stats, CPU load, system memory, PM2 status,
 * disk info, DB counts, OpenClaw reachability, and configured thresholds.
 * The heartbeat agent reads thresholds from the response to know limits
 * without needing env var access.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import {
  getProcessInfo,
  getCpuInfo,
  getSystemMemory,
  getPm2Info,
  getDiskInfo,
  getDbStats,
  checkOpenClaw,
  getHealthThresholds,
  determineStatus,
} from '@/lib/system-health'
import { getAIConfig } from '@/lib/ai-config'
import { notifyOpenClawBackground } from '@/lib/openclaw-webhook'

// Track last-known status to deduplicate alerts (in-process state, resets on restart)
let _lastStatus: string | null = null

export async function GET(req: NextRequest) {
  try {
    const proc = getProcessInfo()
    const cpu = getCpuInfo()
    const memory = getSystemMemory()
    const pm2 = getPm2Info()
    const disk = getDiskInfo()
    const thresholds = getHealthThresholds()

    const db = getDb(getTenantId(req))
    const dbStats = getDbStats(db)
    const openclaw = await checkOpenClaw()
    const aiConfig = getAIConfig()

    const status = determineStatus(proc, pm2, openclaw, disk, thresholds)

    // Proactive alert: fire OpenClaw webhook on state change to critical/degraded
    if (status !== _lastStatus) {
      if (status === 'critical') {
        notifyOpenClawBackground(`Myway health alert: status=${status}, memory=${proc.memoryMb}MB`, 'now')
      } else if (status === 'degraded' && _lastStatus === 'ok') {
        notifyOpenClawBackground(`Myway health degraded: openclaw.reachable=${openclaw.reachable}`, 'now')
      } else if (status === 'ok' && (_lastStatus === 'critical' || _lastStatus === 'degraded')) {
        notifyOpenClawBackground('Myway health recovered: status=ok', 'next-heartbeat')
      }
      _lastStatus = status
    }

    return NextResponse.json({
      status,
      timestamp: Date.now(),
      process: {
        uptime: proc.uptimeSeconds,
        memoryMb: proc.memoryMb,
        heapUsedMb: proc.heapUsedMb,
      },
      cpu: {
        loadPercent: cpu.loadPercent,
      },
      memory: {
        usedPercent: memory.usedPercent,
      },
      pm2: {
        available: pm2.available,
        processes: pm2.processes,
      },
      disk: {
        dbSizeMb: disk.dbSizeMb,
        walSizeMb: disk.walSizeMb,
        fs: disk.fs ? { usedPercent: disk.fs.usedPercent } : null,
      },
      db: {
        messages: dbStats.messages,
        conversations: dbStats.conversations,
      },
      aiBackend: {
        mode: aiConfig.mode,
      },
      ...(aiConfig.mode === 'openclaw' ? {
        openclaw: {
          reachable: openclaw.reachable,
          latencyMs: openclaw.latencyMs,
        },
      } : {}),
      thresholds,
    })
  } catch (err) {
    console.error('[GET /api/health]', err)
    return NextResponse.json(
      { status: 'critical', error: 'Health check failed', timestamp: Date.now() },
      { status: 500 },
    )
  }
}
