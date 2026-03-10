/**
 * System Health Utilities
 *
 * Shared functions used by both /api/health (lightweight heartbeat endpoint)
 * and /api/settings/system (rich UI endpoint).
 */

import { execSync } from 'child_process'
import { statSync } from 'fs'
import { cpus, loadavg, totalmem, freemem, hostname, platform, release } from 'os'
import { DB_PATH, ARTIFACTS_DIR } from '@/lib/db/config'
import { getAIConfig } from '@/lib/ai-config'
import { useBuiltInCron, readOpenClawJobsFile } from '@/lib/cron-utils'
import { syncOpenClawJobsToDb } from '@/lib/cron-engine'
import type { Database } from 'better-sqlite3'

// ─── Process Info ────────────────────────────────────────────────────────────

export type ProcessInfo = {
  uptimeSeconds: number
  memoryMb: number
  heapUsedMb: number
  pid: number
}

export function getProcessInfo(): ProcessInfo {
  const mem = process.memoryUsage()
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMb: Math.round(mem.rss / 1024 / 1024),
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    pid: process.pid,
  }
}

// ─── CPU Info ────────────────────────────────────────────────────────────────

export type CpuInfo = {
  cores: number
  model: string
  loadAvg1m: number
  loadAvg5m: number
  loadAvg15m: number
  /** Load as percentage of available cores (1m avg) */
  loadPercent: number
}

export function getCpuInfo(): CpuInfo {
  const cores = cpus().length
  const [l1, l5, l15] = loadavg()
  return {
    cores,
    model: cpus()[0]?.model ?? 'unknown',
    loadAvg1m: Math.round(l1 * 100) / 100,
    loadAvg5m: Math.round(l5 * 100) / 100,
    loadAvg15m: Math.round(l15 * 100) / 100,
    loadPercent: Math.round((l1 / cores) * 100),
  }
}

// ─── Memory Info (system-level) ──────────────────────────────────────────────

export type SystemMemory = {
  totalMb: number
  freeMb: number
  usedMb: number
  usedPercent: number
}

export function getSystemMemory(): SystemMemory {
  const total = totalmem()
  const free = freemem()
  const used = total - free
  return {
    totalMb: Math.round(total / 1024 / 1024),
    freeMb: Math.round(free / 1024 / 1024),
    usedMb: Math.round(used / 1024 / 1024),
    usedPercent: Math.round((used / total) * 100),
  }
}

// ─── OS Info ─────────────────────────────────────────────────────────────────

export type OsInfo = {
  hostname: string
  platform: string
  kernel: string
  nodeVersion: string
}

export function getOsInfo(): OsInfo {
  return {
    hostname: hostname(),
    platform: platform(),
    kernel: release(),
    nodeVersion: process.version,
  }
}

// ─── PM2 Info ────────────────────────────────────────────────────────────────

export type Pm2Process = {
  name: string
  status: string
  memoryMb: number
  cpu: number
  restarts: number
  uptimeMs: number
}

export type Pm2Info = {
  available: boolean
  processes: Pm2Process[]
}

export function getPm2Info(): Pm2Info {
  try {
    const raw = execSync('pm2 jlist', { timeout: 5000, encoding: 'utf-8' })
    const list = JSON.parse(raw)
    const processes: Pm2Process[] = list.map((p: Record<string, unknown>) => {
      const env = p.pm2_env as Record<string, unknown> | undefined
      const monit = p.monit as Record<string, number> | undefined
      return {
        name: p.name as string,
        status: env?.status as string ?? 'unknown',
        memoryMb: Math.round((monit?.memory ?? 0) / 1024 / 1024),
        cpu: monit?.cpu ?? 0,
        restarts: (env?.restart_time as number) ?? 0,
        uptimeMs: env?.pm_uptime ? Date.now() - (env.pm_uptime as number) : 0,
      }
    })
    return { available: true, processes }
  } catch {
    return { available: false, processes: [] }
  }
}

// ─── Disk Info ───────────────────────────────────────────────────────────────

export type DiskInfo = {
  dbSizeMb: number
  walSizeMb: number
  artifactsSizeMb: number
  /** Filesystem-level disk stats from `df` */
  fs: {
    totalGb: number
    usedGb: number
    freeGb: number
    usedPercent: number
    mount: string
  } | null
}

function safeSizeMb(path: string): number {
  try {
    return Math.round(statSync(path).size / 1024 / 1024 * 100) / 100
  } catch {
    return 0
  }
}

function dirSizeMb(dirPath: string): number {
  try {
    const output = execSync(`du -sm "${dirPath}" 2>/dev/null`, { timeout: 5000, encoding: 'utf-8' })
    return parseFloat(output.split('\t')[0]) || 0
  } catch {
    return 0
  }
}

function getDfStats(): DiskInfo['fs'] {
  try {
    // Get disk usage for the data directory's mount point
    const output = execSync(`df -BG "${DB_PATH}" 2>/dev/null | tail -1`, { timeout: 3000, encoding: 'utf-8' })
    const parts = output.trim().split(/\s+/)
    // filesystem  1G-blocks  Used  Available  Use%  Mounted
    if (parts.length >= 6) {
      const totalGb = parseFloat(parts[1]) || 0
      const usedGb = parseFloat(parts[2]) || 0
      const freeGb = parseFloat(parts[3]) || 0
      const usedPercent = parseInt(parts[4]) || 0
      return { totalGb, usedGb, freeGb, usedPercent, mount: parts[5] }
    }
    return null
  } catch {
    return null
  }
}

export function getDiskInfo(): DiskInfo {
  return {
    dbSizeMb: safeSizeMb(DB_PATH),
    walSizeMb: safeSizeMb(DB_PATH + '-wal'),
    artifactsSizeMb: dirSizeMb(ARTIFACTS_DIR),
    fs: getDfStats(),
  }
}

// ─── DB Stats ────────────────────────────────────────────────────────────────

export type DbStats = {
  messages: number
  conversations: number
  memories: number
  tasks: number
}

function safeCount(db: Database, table: string): number {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
    return row.c
  } catch {
    return 0
  }
}

export function getDbStats(db: Database): DbStats {
  return {
    messages: safeCount(db, 'messages'),
    conversations: safeCount(db, 'conversations'),
    memories: safeCount(db, 'memories'),
    tasks: safeCount(db, 'tasks'),
  }
}

// ─── Top Apps ────────────────────────────────────────────────────────────────

export type TopApp = {
  appId: string
  messageCount: number
}

export function getTopApps(db: Database, limit = 5): TopApp[] {
  try {
    const rows = db.prepare(`
      SELECT app_id AS appId, COUNT(*) AS messageCount
      FROM messages
      WHERE app_id IS NOT NULL
      GROUP BY app_id
      ORDER BY COUNT(*) DESC
      LIMIT ?
    `).all(limit) as TopApp[]
    return rows
  } catch {
    return []
  }
}

// ─── OpenClaw Check ──────────────────────────────────────────────────────────

export type OpenClawStatus = {
  reachable: boolean
  latencyMs?: number
  /** True when the check was skipped (BYOK mode — OpenClaw not expected). */
  skipped?: boolean
}

/**
 * Check if OpenClaw gateway is reachable.
 *
 * In BYOK mode the user doesn't run OpenClaw, so we skip the ping
 * entirely and return a synthetic "ok" to avoid false degraded status.
 *
 * OpenClaw serves an SPA catch-all — /v1/models returns HTML, not JSON.
 * We check reachability by hitting the base URL and confirming a 200 response.
 */
export async function checkOpenClaw(): Promise<OpenClawStatus> {
  // Skip in BYOK mode — OpenClaw isn't expected to be running
  const { mode } = getAIConfig()
  if (mode === 'byok') {
    return { reachable: true, skipped: true }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const baseUrl = process.env.OPENCLAW_BASE_URL ?? 'http://localhost:18789'
    const start = Date.now()
    const res = await fetch(baseUrl, { signal: controller.signal })
    const latencyMs = Date.now() - start
    clearTimeout(timeout)
    return { reachable: res.ok, latencyMs }
  } catch {
    return { reachable: false }
  }
}

// ─── Cron Status ─────────────────────────────────────────────────────────────

export type CronJob = {
  name: string
  enabled: boolean
  schedule: string
  lastError: string | null
}

export type CronStatus = {
  available: boolean
  jobs: CronJob[]
}

export function getCronStatus(db?: Database): CronStatus {
  if (!db) return { available: false, jobs: [] }

  // Sync OpenClaw jobs → DB (same pattern as profile-sync)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (!useBuiltInCron()) {
    syncOpenClawJobsToDb(db, readOpenClawJobsFile())
  }

  // DB is authoritative — single source of truth
  const jobs: CronJob[] = []
  try {
    const dbJobs = db.prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC').all() as
      { id: string; name: string; enabled: number; schedule_type: string; schedule_value: string }[]
    let lastRunMap: Map<string, { status: string; error: string | null }> | undefined
    try {
      const rows = db.prepare(`
        SELECT r.job_id, r.status, r.error
        FROM cron_runs r
        INNER JOIN (SELECT job_id, MAX(started_at) as max_started FROM cron_runs GROUP BY job_id) latest
          ON r.job_id = latest.job_id AND r.started_at = latest.max_started
      `).all() as { job_id: string; status: string; error: string | null }[]
      lastRunMap = new Map(rows.map(r => [r.job_id, { status: r.status, error: r.error }]))
    } catch { /* cron_runs table may not exist */ }

    for (const j of dbJobs) {
      const schedStr = j.schedule_type === 'cron' ? j.schedule_value
        : j.schedule_type === 'every' ? `every ${j.schedule_value}`
        : j.schedule_value
      const run = lastRunMap?.get(j.id)
      jobs.push({
        name: j.name,
        enabled: Boolean(j.enabled),
        schedule: schedStr,
        lastError: run?.status === 'error' || run?.status === 'timeout' ? (run.error ?? run.status) : null,
      })
    }
  } catch { /* cron tables may not exist */ }

  return { available: jobs.length > 0, jobs }
}

// ─── Health Thresholds ───────────────────────────────────────────────────────

export type HealthThresholds = {
  memoryMb: number
  diskPercent: number
  fileWriteThreshold: number
  autoRecoveryEnabled: boolean
  autoRecoveryMaxRestarts: number
}

export function getHealthThresholds(): HealthThresholds {
  // Dynamic memory threshold: 20% of system RAM, floored at 512 MB, capped at 2048 MB.
  // Explicit env var overrides.
  const envMemory = process.env.MYWAY_MEMORY_THRESHOLD_MB
  const autoMemoryMb = Math.min(2048, Math.max(512, Math.round(totalmem() / 1024 / 1024 * 0.2)))
  return {
    memoryMb: envMemory ? parseInt(envMemory, 10) : autoMemoryMb,
    diskPercent: parseInt(process.env.MYWAY_DISK_THRESHOLD_PERCENT ?? '90', 10),
    fileWriteThreshold: parseInt(process.env.MYWAY_FILE_WRITE_THRESHOLD ?? '100', 10),
    autoRecoveryEnabled: process.env.MYWAY_AUTO_RECOVERY_ENABLED !== 'false',
    autoRecoveryMaxRestarts: parseInt(process.env.MYWAY_AUTO_RECOVERY_MAX_RESTARTS ?? '3', 10),
  }
}

// ─── Aggregate Health Status ─────────────────────────────────────────────────

export function determineStatus(
  proc: ProcessInfo,
  pm2: Pm2Info,
  openclaw: OpenClawStatus,
  disk: DiskInfo,
  thresholds: HealthThresholds,
): 'ok' | 'degraded' | 'critical' {
  // Critical: memory over threshold or any PM2 process stopped/errored
  if (proc.memoryMb > thresholds.memoryMb) return 'critical'
  if (pm2.available && pm2.processes.some(p => p.status === 'stopped' || p.status === 'errored')) {
    return 'critical'
  }
  // Critical: disk usage over threshold
  if (disk.fs && disk.fs.usedPercent > thresholds.diskPercent) return 'critical'

  // Degraded: OpenClaw unreachable, restarts exceed max, or WAL > 50MB
  if (!openclaw.reachable) return 'degraded'
  if (pm2.available && pm2.processes.some(p => p.restarts > thresholds.autoRecoveryMaxRestarts)) {
    return 'degraded'
  }
  if (disk.walSizeMb > 50) return 'degraded'

  return 'ok'
}
