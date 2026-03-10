/**
 * GET /api/cron/delivery — delivery channel config for the schedule UI.
 *
 * Dual-mode:
 *   - OpenClaw: reads from openclaw.json + existing jobs
 *   - Built-in: derives channels from user profile (Telegram, Email, etc.)
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { useBuiltInCron } from '@/lib/cron-utils'
import { getProfile } from '@/lib/profile-sync'

type DeliveryConfig = {
  defaultChannel: string | null
  channels: { id: string; enabled: boolean }[]
  targets: Record<string, string>
  displayNames: Record<string, string>
}

const EMPTY: DeliveryConfig = { defaultChannel: null, channels: [], targets: {}, displayNames: {} }

export async function GET(req: NextRequest) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (!useBuiltInCron()) {
    try { return Response.json(await readOpenClawDelivery(req)) } catch { /* fall through */ }
  }

  // Built-in mode — derive from user profile
  const db = getDb(getTenantId(req))
  const profile = getProfile(db, 'user')

  const channels: { id: string; enabled: boolean }[] = []
  const targets: Record<string, string> = {}
  const displayNames: Record<string, string> = {}

  const telegram = profile.get('telegram')
  if (telegram) {
    channels.push({ id: 'telegram', enabled: true })
    const chatIdMatch = telegram.match(/Chat ID:\s*(\d+)/)
    if (chatIdMatch) targets.telegram = chatIdMatch[1]
    const handleMatch = telegram.match(/@\S+/)
    if (handleMatch) displayNames.telegram = handleMatch[0]
  }

  const email = profile.get('email')
  if (email) {
    channels.push({ id: 'email', enabled: true })
    targets.email = email
    displayNames.email = email
  }

  return Response.json({
    defaultChannel: channels.length > 0 ? channels[0].id : null,
    channels, targets, displayNames,
  } satisfies DeliveryConfig)
}

// ─── OpenClaw delivery config reader ─────────────────────────────────────────

async function readOpenClawDelivery(req: NextRequest): Promise<DeliveryConfig> {
  const { readFileSync } = await import('fs')
  const { join } = await import('path')
  const { homedir } = await import('os')

  const raw = readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf-8')
  const config = JSON.parse(raw)

  const heartbeatTarget = config?.agents?.defaults?.heartbeat?.target ?? null
  const channelsConfig = config?.channels ?? {}
  const pluginsConfig = config?.plugins?.entries ?? {}

  const channels: { id: string; enabled: boolean }[] = []
  const targets: Record<string, string> = {}

  for (const [id, cfg] of Object.entries(channelsConfig) as [string, Record<string, unknown>][]) {
    channels.push({ id, enabled: Boolean(cfg.enabled) })
  }
  for (const [id, cfg] of Object.entries(pluginsConfig) as [string, Record<string, unknown>][]) {
    if (['telegram', 'whatsapp', 'discord', 'slack'].includes(id) && !channels.find(c => c.id === id)) {
      channels.push({ id, enabled: Boolean(cfg.enabled) })
    }
  }

  try {
    const jobsRaw = readFileSync(join(homedir(), '.openclaw', 'cron', 'jobs.json'), 'utf-8')
    for (const job of (JSON.parse(jobsRaw).jobs ?? [])) {
      if (job.delivery?.channel && job.delivery?.to) targets[job.delivery.channel] = job.delivery.to
    }
  } catch { /* no jobs */ }

  // Display names from profile (uses the unified sync layer)
  const displayNames: Record<string, string> = {}
  try {
    const db = getDb(getTenantId(req))
    const profile = getProfile(db, 'user')
    const telegram = profile.get('telegram')
    if (telegram) {
      const match = telegram.match(/@\S+/)
      if (match) displayNames.telegram = match[0]
    }
  } catch { /* no profile */ }

  return { defaultChannel: heartbeatTarget, channels, targets, displayNames }
}
