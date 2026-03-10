/**
 * GET  /api/aport/kill-switch  — returns current KillSwitchState
 * POST /api/aport/kill-switch  — activate or deactivate
 *
 * Resolution chain for kill switch target:
 *   1. DB passport (user_passports table) — per-user agent_id → APort API
 *   2. Hosted env (APORT_AGENT_ID + APORT_API_KEY) → APort API
 *   3. Local passport file → read/write status field directly
 *
 * POST body: { "action": "activate" | "deactivate" }
 */

import { NextRequest } from 'next/server'
import { getAportConfig } from '@/lib/aport/config'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import {
  readKillSwitch,
  activateKillSwitch,
  deactivateKillSwitch,
  readKillSwitchHosted,
  toggleKillSwitchHosted,
} from '@/lib/aport/kill-switch'
import type { AportConfig } from '@/lib/aport/config'

export const dynamic = 'force-dynamic'

/**
 * Resolve an effective AportConfig that includes DB passport credentials.
 * If a DB passport exists with an agent_id, overlay it onto the config
 * so the kill switch operates on the tenant's passport.
 */
function resolveConfigWithDb(req: NextRequest, baseConfig: AportConfig): AportConfig {
  const tenantId = getTenantId(req)

  try {
    const db = getDb(tenantId)
    const { getPassportApiKey } = require('@/lib/aport/passport-store') as typeof import('@/lib/aport/passport-store')
    const creds = getPassportApiKey(db, 'default')
    if (creds) {
      const apiKey = creds.apiKey ?? baseConfig.apiKey
      if (creds.agentId && apiKey) {
        return {
          ...baseConfig,
          mode: 'api',
          hosted: true,
          agentId: creds.agentId,
          apiKey,
          apiUrl: baseConfig.apiUrl ?? 'https://api.aport.io',
        }
      }
    }
  } catch {
    // Table might not exist — fall through
  }

  // Logged-in user with no DB passport: not configured. No env fallback.
  if (tenantId) {
    return { ...baseConfig, hosted: false, agentId: undefined, apiKey: undefined }
  }

  // Anonymous / self-hosted: use base config (env vars)
  return baseConfig
}

export async function GET(req: NextRequest) {
  try {
    const config = resolveConfigWithDb(req, getAportConfig())

    if (config.hosted && config.agentId && config.apiKey) {
      const state = await readKillSwitchHosted(config)
      return Response.json(state)
    }

    const state = readKillSwitch(config.passportFile)
    return Response.json(state)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return Response.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body['action']
  if (action !== 'activate' && action !== 'deactivate') {
    return Response.json(
      { error: 'action must be "activate" or "deactivate"' },
      { status: 400 },
    )
  }

  try {
    const config = resolveConfigWithDb(req, getAportConfig())

    if (config.hosted && config.agentId && config.apiKey) {
      const state = await toggleKillSwitchHosted(config, action)
      return Response.json(state)
    }

    const state = action === 'activate'
      ? activateKillSwitch(config.passportFile)
      : deactivateKillSwitch(config.passportFile)
    return Response.json(state)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return Response.json({ error: message }, { status: 500 })
  }
}
