/**
 * AppRoom API client — quota checks, outcome tracking, usage reporting.
 *
 * Authenticates requests to AppRoom using HMAC-SHA256 signed bodies
 * with the same partner secret used for SSO token exchange.
 *
 * Env vars:
 *   MYWAY_APPROOM_URL          — AppRoom base URL (e.g. https://approom.ai)
 *   MYWAY_PARTNER_APPROOM_SECRET — shared HMAC secret
 *
 * All methods are fire-and-forget safe (catch errors internally when needed).
 * SERVER ONLY.
 */

import { createHmac } from 'crypto'

// ── Types ─────────────────────────────────────────────────────────────────────

export type QuotaResult = {
  allowed: boolean
  remaining: number
  addonOptions?: { quantity: number; priceUsd: number }[]
}

export type TrackOutcomeParams = {
  userId: string
  appId: string
  installationId?: string
  outcomeId: string
  tokenUsage: {
    input: number
    output: number
    total: number
    cost: number
  }
  durationMs?: number
  status: 'completed' | 'failed' | 'partial'
}

export type TrackOutcomeResult = {
  success: boolean
  remaining?: number
  error?: string
}

export type UsageReportEntry = {
  userId: string
  promptTokens: number
  completionTokens: number
  estimatedCostUsd: number
  models: string[]
  periodStart: string
  periodEnd: string
}

export type UsageReportResult = {
  success: boolean
  accepted: number
  error?: string
}

// ── Config ────────────────────────────────────────────────────────────────────

function getConfig(): { baseUrl: string; secret: string } | null {
  const baseUrl = process.env.MYWAY_APPROOM_URL?.trim()
  const secret = process.env.MYWAY_PARTNER_APPROOM_SECRET?.trim()

  if (!baseUrl || !secret) return null
  return { baseUrl, secret }
}

function signBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

async function appRoomFetch(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<Response> {
  const config = getConfig()
  if (!config) {
    throw new Error('AppRoom integration not configured (MYWAY_APPROOM_URL / MYWAY_PARTNER_APPROOM_SECRET)')
  }

  const bodyStr = JSON.stringify(body)
  const signature = signBody(bodyStr, config.secret)

  const res = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Myway-Signature': signature,
      'X-Myway-Instance': process.env.MYWAY_INSTANCE_ID || 'default',
    },
    body: bodyStr,
    signal: AbortSignal.timeout(timeoutMs),
  })

  return res
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check if a user has quota remaining for an outcome.
 * Returns { allowed: true } if no AppRoom integration configured (self-hosted).
 *
 * SECURITY: When AppRoom IS configured but returns an error or is unreachable,
 * we FAIL CLOSED (deny). Each allowed request triggers a real LLM call that
 * costs money. Failing open on errors would create a billing leak — any
 * AppRoom outage would give users unlimited free access.
 */
export async function checkQuota(
  userId: string,
  appId: string,
  outcomeId: string,
): Promise<QuotaResult> {
  if (!getConfig()) {
    return { allowed: true, remaining: Infinity }
  }

  try {
    const res = await appRoomFetch('/api/outcomes/check-quota', {
      userId,
      appId,
      outcomeId,
    })

    if (!res.ok) {
      console.error(`[approom-client] checkQuota failed: ${res.status}`)
      // Fail CLOSED — AppRoom is configured so this is a paid app.
      // Allowing on error = free LLM calls on every AppRoom hiccup.
      return { allowed: false, remaining: 0 }
    }

    const data = await res.json() as {
      allowed: boolean
      remaining: number
      addon_options?: { quantity: number; price_usd: number }[]
    }

    return {
      allowed: data.allowed,
      remaining: data.remaining,
      addonOptions: data.addon_options?.map(o => ({
        quantity: o.quantity,
        priceUsd: o.price_usd,
      })),
    }
  } catch (err) {
    console.error('[approom-client] checkQuota error:', err instanceof Error ? err.message : err)
    // Fail CLOSED — network error doesn't mean the user has quota.
    return { allowed: false, remaining: 0 }
  }
}

/**
 * Track an outcome completion in AppRoom.
 * Fire-and-forget safe — errors are logged but not thrown.
 */
export async function trackOutcome(params: TrackOutcomeParams): Promise<TrackOutcomeResult> {
  if (!getConfig()) {
    return { success: true }
  }

  try {
    const res = await appRoomFetch('/api/outcomes/track', {
      userId: params.userId,
      appId: params.appId,
      installationId: params.installationId || params.appId,
      outcomeId: params.outcomeId,
      tokenUsage: {
        input: params.tokenUsage.input,
        output: params.tokenUsage.output,
        total: params.tokenUsage.total,
        cost: params.tokenUsage.cost,
      },
      durationMs: params.durationMs,
      status: params.status,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[approom-client] trackOutcome failed: ${res.status} ${text.slice(0, 200)}`)
      return { success: false, error: `AppRoom returned ${res.status}` }
    }

    const data = await res.json() as { remaining?: number }
    return { success: true, remaining: data.remaining }
  } catch (err) {
    console.error('[approom-client] trackOutcome error:', err instanceof Error ? err.message : err)
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Report aggregated usage data to AppRoom for billing/dashboard.
 * Typically called by a cron job (hourly).
 */
export async function reportUsage(
  entries: UsageReportEntry[],
): Promise<UsageReportResult> {
  if (!getConfig()) {
    return { success: true, accepted: 0 }
  }

  if (entries.length === 0) {
    return { success: true, accepted: 0 }
  }

  try {
    const res = await appRoomFetch('/api/usage/report', {
      instanceId: process.env.MYWAY_INSTANCE_ID || 'default',
      users: entries.map(e => ({
        userId: e.userId,
        prompt_tokens: e.promptTokens,
        completion_tokens: e.completionTokens,
        estimated_cost_usd: e.estimatedCostUsd,
        models: e.models,
        period_start: e.periodStart,
        period_end: e.periodEnd,
      })),
    }, 30_000) // longer timeout for batch reports

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[approom-client] reportUsage failed: ${res.status} ${text.slice(0, 200)}`)
      return { success: false, accepted: 0, error: `AppRoom returned ${res.status}` }
    }

    const data = await res.json() as { accepted?: number }
    return { success: true, accepted: data.accepted ?? entries.length }
  } catch (err) {
    console.error('[approom-client] reportUsage error:', err instanceof Error ? err.message : err)
    return { success: false, accepted: 0, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Send a notification email via AppRoom's email infrastructure.
 * Fire-and-forget safe — errors are logged but not thrown.
 *
 * Templates: quota_warning, quota_reset, addon_receipt, budget_exceeded
 */
export async function sendNotificationEmail(
  userId: string,
  template: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  if (!getConfig()) return false

  try {
    const res = await appRoomFetch('/api/notifications/email', {
      userId,
      template,
      params,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[approom-client] sendNotificationEmail failed: ${res.status} ${text.slice(0, 200)}`)
      return false
    }

    return true
  } catch (err) {
    console.error('[approom-client] sendNotificationEmail error:', err instanceof Error ? err.message : err)
    return false
  }
}

// ── User plan ────────────────────────────────────────────────────────────────

export type UserPlan = 'free' | 'personal'

export type UserPlanResult = {
  plan: UserPlan
  isActive: boolean
}

/**
 * Check a user's platform plan via AppRoom.
 * Returns { plan: 'free', isActive: true } if AppRoom is not configured or on error.
 * Unlike quota checks, this FAILS OPEN — a plan check failure shouldn't block
 * usage entirely, the spend limit still applies as a backstop.
 */
export async function checkUserPlan(userId: string): Promise<UserPlanResult> {
  if (!getConfig()) {
    return { plan: 'free', isActive: true }
  }

  try {
    const res = await appRoomFetch('/api/user/plan', { userId })

    if (!res.ok) {
      console.error(`[approom-client] checkUserPlan failed: ${res.status}`)
      return { plan: 'free', isActive: true }
    }

    const data = await res.json() as { plan?: string; isActive?: boolean }
    const plan: UserPlan = data.plan === 'personal' ? 'personal' : 'free'
    return { plan, isActive: data.isActive !== false }
  } catch (err) {
    console.error('[approom-client] checkUserPlan error:', err instanceof Error ? err.message : err)
    return { plan: 'free', isActive: true }
  }
}

/**
 * Check if AppRoom integration is configured.
 */
export function isConfigured(): boolean {
  return getConfig() !== null
}
