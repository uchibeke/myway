/**
 * Cron shared utilities — formatting, mode detection, file reading, polling.
 *
 * Extracted from route handlers to keep routes thin and DRY.
 */

import { getAIConfig } from '@/lib/ai-config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { CronJob, CronRun } from '@/lib/cron-engine'

// ─── Mode detection ──────────────────────────────────────────────────────────

/** True when the built-in cron engine should be used (BYOK mode). */
export function useBuiltInCron(): boolean {
  return getAIConfig().mode === 'byok'
}

// ─── OpenClaw file reader ────────────────────────────────────────────────

/**
 * Read OpenClaw cron jobs directly from ~/.openclaw/cron/jobs.json.
 * Returns raw job objects for UI consumption — fast (no subprocess).
 * Returns empty array if file doesn't exist or can't be read.
 */
export function readOpenClawJobsFile(): Record<string, unknown>[] {
  try {
    const cronPath = join(homedir(), '.openclaw/cron/jobs.json')
    const raw = readFileSync(cronPath, 'utf-8')
    const parsed = JSON.parse(raw)
    const jobList = Array.isArray(parsed) ? parsed : (parsed.jobs ?? [])
    return jobList as Record<string, unknown>[]
  } catch {
    return []
  }
}

// ─── OpenClaw job parser (shared by sync + UI normalization) ─────────────────

/** DB-ready fields extracted from a raw OpenClaw job object. */
export type ParsedOpenClawJob = {
  id: string
  name: string
  description: string | null
  message: string
  schedule_type: string
  schedule_value: string
  tz: string
  enabled: boolean
  nextRunEpoch: number | null
  channel: string | null
  delivery_to: string | null
}

/**
 * Parse a raw OpenClaw job object into DB-ready fields.
 * Handles both OpenClaw format (kind/expr) and normalized format (type/value).
 * Used by sync (file → DB) and UI normalization.
 */
export function parseOpenClawJob(raw: Record<string, unknown>): ParsedOpenClawJob | null {
  const id = raw.id as string
  if (!id) return null

  const sched = raw.schedule as Record<string, unknown> | undefined
  let schedType = 'cron'
  let schedValue = ''
  let tz = 'UTC'

  if (sched) {
    if (sched.kind) {
      // OpenClaw format: { kind, expr/duration/at, tz }
      schedType = sched.kind as string
      schedValue = (sched.expr ?? sched.duration ?? sched.at ?? '') as string
      tz = (sched.tz as string) || 'UTC'
    } else if (sched.type) {
      // Already normalized format
      schedType = sched.type as string
      schedValue = (sched.value ?? sched[schedType] ?? '') as string
      tz = (raw.tz ?? sched.tz ?? 'UTC') as string
    }
  }

  const message = (raw.message as string)
    ?? ((raw.payload as Record<string, unknown>)?.message as string)
    ?? ''

  const state = raw.state as Record<string, unknown> | undefined
  const nextRunMs = state?.nextRunAtMs as number | undefined
  const nextRunEpoch = nextRunMs ? Math.floor(nextRunMs / 1000) : null

  return {
    id,
    name: (raw.name as string) || 'Unnamed',
    description: (raw.description as string) || null,
    message,
    schedule_type: schedType,
    schedule_value: schedValue,
    tz,
    enabled: raw.enabled !== false,
    nextRunEpoch,
    channel: (raw.channel as string) || null,
    delivery_to: (raw.deliveryTo as string) || null,
  }
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatJobForUI(job: CronJob, lastRun?: { status: string; error: string | null } | null) {
  return {
    id: job.id,
    name: job.name,
    description: job.description,
    message: job.message,
    schedule: {
      type: job.schedule_type,
      value: job.schedule_value,
      ...(job.schedule_type === 'cron' ? { cron: job.schedule_value } : {}),
      ...(job.schedule_type === 'every' ? { every: job.schedule_value } : {}),
      ...(job.schedule_type === 'at' ? { at: job.schedule_value } : {}),
    },
    tz: job.tz,
    enabled: Boolean(job.enabled),
    nextRunAt: job.next_run_at ? new Date(job.next_run_at * 1000).toISOString() : null,
    lastRunAt: job.last_run_at ? new Date(job.last_run_at * 1000).toISOString() : null,
    lastStatus: lastRun?.status ?? null,
    lastError: lastRun?.error ?? null,
    isSystem: Boolean(job.is_system),
    delivery: job.channel ? { channel: job.channel, to: job.delivery_to } : null,
    createdAt: new Date(job.created_at * 1000).toISOString(),
  }
}

export function formatRunForUI(run: CronRun) {
  return {
    id: run.id,
    status: run.status,
    summary: run.summary,
    error: run.error,
    durationMs: run.duration_ms,
    startedAt: new Date(run.started_at * 1000).toISOString(),
    finishedAt: run.finished_at ? new Date(run.finished_at * 1000).toISOString() : null,
  }
}

// ─── Polling ─────────────────────────────────────────────────────────────────

/**
 * Poll a check function until it returns a non-null result or timeout.
 * Returns null on timeout.
 */
export async function pollUntil<T>(
  checkFn: () => T | Promise<T | null> | null,
  timeoutMs = 90_000,
  intervalMs = 3_000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs))
    const result = await checkFn()
    if (result !== null) return result
  }
  return null
}
