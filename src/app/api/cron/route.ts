/**
 * GET  /api/cron  — list all cron jobs
 * POST /api/cron  — create a cron job
 *
 * Dual-mode: OpenClaw CLI or built-in DB engine.
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { execOpenClaw } from '@/lib/openclaw-cli'
import { useBuiltInCron, formatJobForUI, readOpenClawJobsFile } from '@/lib/cron-utils'
import { listJobs, getLastRuns, createJob, computeNextRun, syncOpenClawJobsToDb } from '@/lib/cron-engine'

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const db = getDb(getTenantId(req))

  // In OpenClaw mode, sync file → DB first (same pattern as profile-sync for USER.md)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (!useBuiltInCron()) {
    syncOpenClawJobsToDb(db, readOpenClawJobsFile())
  }

  // DB is authoritative — always return from DB
  const dbJobs = listJobs(db)
  const lastRuns = getLastRuns(db)
  const formattedDb = dbJobs.map(j => formatJobForUI(j, lastRuns.get(j.id)))
  return Response.json({ jobs: formattedDb })
}

// ─── POST ────────────────────────────────────────────────────────────────────

type CreateBody = {
  name: string
  description?: string
  message: string
  cron?: string
  every?: string
  at?: string
  tz?: string
  disabled?: boolean
  channel?: string
  to?: string
}

export async function POST(req: NextRequest) {
  let body: CreateBody
  try { body = await req.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.name?.trim() || !body.message?.trim()) {
    return Response.json({ error: 'name and message are required' }, { status: 400 })
  }
  if (!body.cron && !body.every && !body.at) {
    return Response.json({ error: 'One of cron, every, or at is required' }, { status: 400 })
  }

  // ── OpenClaw mode ────────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (!useBuiltInCron()) {
    try {
      const args = buildOpenClawCreateArgs(body)
      return Response.json(await execOpenClaw(args, 60_000), { status: 201 })
    } catch (e) {
      console.warn('[cron] OpenClaw create failed, using built-in:', e instanceof Error ? e.message : e)
    }
  }

  // ── Built-in mode ────────────────────────────────────────────────────────
  const scheduleType = body.cron ? 'cron' : body.every ? 'every' : 'at'
  const scheduleValue = (body.cron ?? body.every ?? body.at)!
  const tz = body.tz ?? 'UTC'

  if (computeNextRun(scheduleType, scheduleValue, tz) === null) {
    const detail = scheduleType === 'at' ? 'must be a future date' : 'invalid expression'
    return Response.json({ error: `Invalid schedule "${scheduleValue}": ${detail}` }, { status: 400 })
  }

  const db = getDb(getTenantId(req))
  const job = createJob(db, {
    name: body.name.trim(),
    description: body.description?.trim(),
    message: body.message.trim(),
    schedule_type: scheduleType,
    schedule_value: scheduleValue,
    tz,
    enabled: !body.disabled,
    channel: body.channel,
    delivery_to: body.to,
  })

  return Response.json({ job: formatJobForUI(job) }, { status: 201 })
}

// ─── OpenClaw arg builder ────────────────────────────────────────────────────

function buildOpenClawCreateArgs(body: CreateBody): string[] {
  const args = ['cron', 'add', '--json', '--session', 'isolated']
  args.push('--name', body.name.trim())

  let message = body.message.trim()
  if (body.channel && body.to?.trim()) {
    message += `\n\nIMPORTANT: After generating your response, you MUST deliver it to the user. Use the message send tool with channel "${body.channel}" and target "${body.to.trim()}". Send your complete response as the message body. After sending, do NOT output any confirmation, summary, or additional text. Your task is complete once the message is sent.`
  }
  args.push('--message', message)

  if (body.description?.trim()) args.push('--description', body.description.trim())
  if (body.cron) args.push('--cron', body.cron)
  if (body.every) args.push('--every', body.every)
  if (body.at) args.push('--at', body.at)
  if (body.tz) args.push('--tz', body.tz)
  if (body.disabled) args.push('--disabled')

  if (body.channel && body.to) {
    args.push('--announce', '--channel', body.channel, '--to', body.to, '--best-effort-deliver')
  }
  args.push('--timeout', '90000')

  return args
}
