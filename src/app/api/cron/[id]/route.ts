/**
 * GET    /api/cron/[id]  — single job with recent runs
 * PATCH  /api/cron/[id]  — edit a cron job
 * DELETE /api/cron/[id]  — remove a cron job
 *
 * Dual-mode: OpenClaw CLI or built-in DB engine.
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { execOpenClaw } from '@/lib/openclaw-cli'
import { useBuiltInCron, formatJobForUI, formatRunForUI, readOpenClawJobsFile } from '@/lib/cron-utils'
import { getJob, updateJob, deleteJob, getJobRuns, syncOpenClawJobsToDb } from '@/lib/cron-engine'

type RouteContext = { params: Promise<{ id: string }> }

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const db = getDb(getTenantId(req))

  // Ensure OpenClaw jobs are in DB
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (!useBuiltInCron()) {
    syncOpenClawJobsToDb(db, readOpenClawJobsFile())
  }

  const job = getJob(db, id)
  if (!job) return Response.json({ error: 'Job not found' }, { status: 404 })

  const runs = getJobRuns(db, id, 10).map(formatRunForUI)
  const lastRun = runs.length > 0 ? { status: runs[0].status, error: runs[0].error } : null
  return Response.json({
    job: formatJobForUI(job, lastRun),
    runs,
  })
}

// ─── PATCH ───────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getDb(getTenantId(req))

  // Ensure OpenClaw jobs are in DB (same pattern as profile-sync)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (!useBuiltInCron()) {
    syncOpenClawJobsToDb(db, readOpenClawJobsFile())
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string') updates.name = body.name
  if (typeof body.description === 'string') updates.description = body.description
  if (typeof body.message === 'string') updates.message = body.message
  if (typeof body.tz === 'string') updates.tz = body.tz
  if (typeof body.enabled === 'boolean') updates.enabled = body.enabled
  if (typeof body.cron === 'string') { updates.schedule_type = 'cron'; updates.schedule_value = body.cron }
  else if (typeof body.every === 'string') { updates.schedule_type = 'every'; updates.schedule_value = body.every }
  else if (typeof body.at === 'string') { updates.schedule_type = 'at'; updates.schedule_value = body.at }

  // DB is authoritative — update there
  const updated = updateJob(db, id, updates)
  if (!updated) return Response.json({ error: 'Job not found' }, { status: 404 })

  // Sync back to OpenClaw CLI (non-critical, like profile-sync's syncToFile)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (!useBuiltInCron()) {
    try {
      const args: string[] = []
      if (typeof body.name === 'string') args.push('--name', body.name)
      if (typeof body.description === 'string') args.push('--description', body.description)
      if (typeof body.message === 'string') args.push('--message', body.message)
      if (typeof body.cron === 'string') args.push('--cron', body.cron)
      if (typeof body.every === 'string') args.push('--every', body.every)
      if (typeof body.at === 'string') args.push('--at', body.at)
      if (typeof body.tz === 'string') args.push('--tz', body.tz)
      if (body.enabled === true) args.push('--enable')
      if (body.enabled === false) args.push('--disable')
      if (args.length > 0) {
        execOpenClaw(['cron', 'edit', id, '--json', ...args]).catch(e =>
          console.warn('[cron] OpenClaw sync-back failed:', e instanceof Error ? e.message : e)
        )
      }
    } catch (e) {
      console.warn('[cron] OpenClaw sync-back failed:', e instanceof Error ? e.message : e)
    }
  }

  return Response.json({ job: formatJobForUI(updated) })
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const db = getDb(getTenantId(req))

  // Ensure OpenClaw jobs are in DB
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (!useBuiltInCron()) {
    syncOpenClawJobsToDb(db, readOpenClawJobsFile())
  }

  if (!deleteJob(db, id)) {
    return Response.json({ error: 'Job not found or is a system job' }, { status: 404 })
  }

  // Sync back to OpenClaw CLI (non-critical)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (!useBuiltInCron()) {
    execOpenClaw(['cron', 'rm', id, '--json']).catch(e =>
      console.warn('[cron] OpenClaw sync-back failed:', e instanceof Error ? e.message : e)
    )
  }

  return Response.json({ ok: true })
}
