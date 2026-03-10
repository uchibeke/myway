/**
 * POST /api/cron/[id]/run — trigger a cron job immediately.
 *
 * Dual-mode: OpenClaw CLI (with polling) or built-in engine.
 */

import type { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { execOpenClaw } from '@/lib/openclaw-cli'
import { useBuiltInCron, pollUntil } from '@/lib/cron-utils'
import { triggerJob, getJobRuns } from '@/lib/cron-engine'

type RouteContext = { params: Promise<{ id: string }> }

const TIMEOUT_RESULT = {
  ok: true, status: 'timeout', summary: null,
  error: 'Job is still running. Check back in a minute.',
  durationMs: null, delivered: false,
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params

  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (!useBuiltInCron()) {
    try {
      return Response.json(await runViaOpenClaw(id))
    } catch (e) {
      console.warn('[cron] OpenClaw run failed, trying built-in:', e instanceof Error ? e.message : e)
    }
  }

  // Built-in mode
  const db = getDb(getTenantId(req))
  const runId = await triggerJob(db, id)
  if (runId === null) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  const result = await pollUntil(() => {
    const runs = getJobRuns(db, id, 1)
    if (runs.length > 0 && runs[0].finished_at) {
      return {
        ok: true,
        status: runs[0].status,
        summary: runs[0].summary ?? null,
        error: runs[0].error ?? null,
        durationMs: runs[0].duration_ms ?? null,
        delivered: false,
      }
    }
    return null
  })

  return Response.json(result ?? TIMEOUT_RESULT)
}

// ─── OpenClaw trigger + poll ─────────────────────────────────────────────────

async function runViaOpenClaw(id: string) {
  // Read delivery config
  let hasDelivery = false
  try {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const { homedir } = await import('os')
    const raw = readFileSync(join(homedir(), '.openclaw', 'cron', 'jobs.json'), 'utf-8')
    const data = JSON.parse(raw)
    const job = (data.jobs ?? []).find((j: { id: string }) => j.id === id)
    hasDelivery = !!(job?.delivery?.channel && job?.delivery?.to)
  } catch { /* no delivery config */ }

  // Snapshot pre-trigger timestamp
  let beforeTs = 0
  try {
    const data = await execOpenClaw(['cron', 'runs', '--id', id]) as {
      entries?: { ts: number; action: string }[]
      runs?: { ts: number; action: string }[]
    }
    const runs = (data.entries ?? data.runs ?? []).filter(r => r.action === 'finished')
    if (runs.length > 0) beforeTs = runs[runs.length - 1].ts
  } catch { /* no previous runs */ }

  // Trigger
  await execOpenClaw(['cron', 'run', id, '--timeout', '90000'], 100_000)

  // Poll for new finished run
  const result = await pollUntil(async () => {
    try {
      const data = await execOpenClaw(['cron', 'runs', '--id', id]) as {
        entries?: { ts: number; action: string; status?: string; summary?: string; error?: string; durationMs?: number }[]
        runs?: { ts: number; action: string; status?: string; summary?: string; error?: string; durationMs?: number }[]
      }
      const finished = (data.entries ?? data.runs ?? []).filter(
        r => r.action === 'finished' && r.ts > beforeTs
      )
      if (finished.length === 0) return null
      const latest = finished[finished.length - 1]
      return {
        ok: true,
        status: latest.status ?? 'unknown',
        summary: latest.summary ?? null,
        error: latest.error ?? null,
        durationMs: latest.durationMs ?? null,
        delivered: hasDelivery,
      }
    } catch { return null }
  })

  return result ?? TIMEOUT_RESULT
}
