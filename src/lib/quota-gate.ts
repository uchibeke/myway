/**
 * Quota gating — pre-chat quota check for paid apps + free-tier spend limit.
 *
 * Two independent gates:
 *
 * 1. App Quota (checkAppQuota) — per-app outcome quotas via AppRoom.
 *    For self-hosted (no AppRoom): always allowed (no gating).
 *    For hosted: AppRoom is ALWAYS authoritative for the allow/deny decision.
 *
 * 2. Free Spend Limit (checkFreeSpendLimit) — monthly USD cap from
 *    MYWAY_MAX_FREE_SPEND env var. Queries local token_usage table.
 *    Applies in hosted mode only. Self-hosted: no spend limit.
 *
 * The local app_quota_cache table is used for DISPLAY ONLY (home screen
 * quota badges, low-quota notifications). It is NEVER used for gating.
 * Each LLM call costs real money — the gate must hit the source of truth.
 *
 * SERVER ONLY.
 */

import type { Database } from 'better-sqlite3'
import type { MywayApp } from './apps'
import { checkQuota, isConfigured, sendNotificationEmail } from './approom/client'
import { addNotification } from './store/notifications'
import { isHostedMode } from './hosted-storage'

export type QuotaCheckResult = {
  allowed: boolean
  remaining?: number
  addonOptions?: { quantity: number; priceUsd: number }[]
  outcomeId?: string
  /** AppRoom base URL for purchase links — only set when quota exceeded. */
  appRoomUrl?: string
}

// ── Display-only quota cache ──────────────────────────────────────────────────
// Written after every AppRoom response. Read by home/context for quota badges
// and by this module for low-quota notifications. NEVER gates access.

/**
 * Update the local quota cache after an AppRoom response.
 * Display-only — used for home screen badges and low-quota notifications.
 */
export function updateQuotaCache(
  db: Database,
  appId: string,
  outcomeId: string,
  remaining: number,
): void {
  try {
    db.prepare(`
      INSERT INTO app_quota_cache (app_id, outcome_id, quota, used, additional, synced_at)
      VALUES (?, ?, ?, 0, 0, unixepoch())
      ON CONFLICT(app_id, outcome_id) DO UPDATE SET
        quota = ?,
        used = 0,
        additional = 0,
        synced_at = unixepoch()
    `).run(appId, outcomeId, remaining, remaining)
  } catch { /* table may not exist yet — non-critical */ }
}

// ── Low-quota notification via ambient infra ──────────────────────────────────

function maybeNotifyLowQuota(
  db: Database,
  appName: string,
  appId: string,
  remaining: number,
): void {
  if (remaining > 5 || remaining <= 0) return

  try {
    // Deduplicate: don't create if one already exists for this app this month
    const existing = db.prepare(
      `SELECT id FROM notifications
       WHERE app_id = ? AND type = 'alert'
         AND body LIKE '%actions remaining%'
         AND status IN ('pending', 'shown')
       LIMIT 1`
    ).get(appId)
    if (existing) return

    addNotification(db, {
      appId,
      title: `${appName} — running low`,
      body: `${remaining} ${appName} action${remaining === 1 ? '' : 's'} remaining this month.`,
      type: 'alert',
      priority: 2,
      actionUrl: `/apps/${appId}`,
      expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400, // 7 days
    })

    // Fire-and-forget: send quota warning email via AppRoom
    // userId is extracted from the notification dedup key check above
    const userId = db.prepare('SELECT value FROM user_profile WHERE key = ?').get('approom_user_id') as { value: string } | undefined
    if (userId?.value) {
      sendNotificationEmail(userId.value, 'quota_warning', {
        appName,
        remaining,
        total: remaining + 5, // approximate total (we know remaining <= 5)
      }).catch((err) => {
        console.warn('[quota-gate] Failed to send quota warning email:', err)
      })
    }
  } catch { /* notifications table may not exist — non-critical */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check if the user has quota to use this app.
 * Returns { allowed: true } for free apps or when AppRoom is not configured.
 *
 * For subscription apps with AppRoom configured: ALWAYS hits AppRoom.
 * AppRoom is the source of truth — we never cache the allow/deny decision.
 * If AppRoom is unreachable, we FAIL CLOSED (deny) to prevent billing leaks.
 */
export async function checkAppQuota(
  db: Database,
  app: MywayApp,
  userId: string | undefined,
): Promise<QuotaCheckResult> {
  // Free apps or no pricing — always allowed
  if (!app.pricing || app.pricing.model === 'free') {
    return { allowed: true }
  }

  // Self-hosted with no AppRoom — always allowed
  if (!isConfigured()) {
    return { allowed: true }
  }

  // No user ID (self-hosted anonymous) — allow
  if (!userId) {
    return { allowed: true }
  }

  // Subscription app — check quota via AppRoom (always, no cache bypass)
  const outcomeId = app.pricing.outcomeTypes?.[0]
  if (!outcomeId) {
    // No outcomes defined — can't gate, allow
    console.warn(`[quota-gate] App ${app.id} has pricing but no outcomeTypes — gating disabled`)
    return { allowed: true }
  }

  const result = await checkQuota(userId, app.id, outcomeId)

  // Update display cache + fire notification if running low
  if (result.remaining !== undefined) {
    updateQuotaCache(db, app.id, outcomeId, result.remaining)
    maybeNotifyLowQuota(db, app.name, app.id, result.remaining)
  }

  const appRoomUrl = result.allowed
    ? undefined
    : (process.env.NEXT_PUBLIC_APPROOM_URL?.trim() || process.env.MYWAY_APPROOM_URL?.trim() || undefined)

  return {
    allowed: result.allowed,
    remaining: result.remaining,
    addonOptions: result.addonOptions,
    outcomeId,
    appRoomUrl,
  }
}

/**
 * Build a JSON body for a 402 quota-exceeded response.
 * The client checks res.status === 402 and renders the QuotaExceeded component.
 */
export function buildQuotaExceededBody(result: QuotaCheckResult, appName: string, appId: string): {
  quotaExceeded: true
  appName: string
  appId: string
  outcomeId?: string
  addonOptions: { quantity: number; priceUsd: number }[]
  message: string
  appRoomUrl?: string
} {
  return {
    quotaExceeded: true,
    appName,
    appId,
    outcomeId: result.outcomeId,
    addonOptions: result.addonOptions || [],
    message: `You've used all your included ${appName} actions this month.`,
    appRoomUrl: result.appRoomUrl,
  }
}

// ── Spend limit (plan-aware) ────────────────────────────────────────────────
// Caps total USD/month per user in hosted mode.
//   Free users:     MYWAY_MAX_FREE_SPEND (e.g. $2)
//   Personal users: MYWAY_MAX_PAID_SPEND (e.g. $19)
// Queries the local token_usage table for the current calendar month.
// Self-hosted: no limit (env vars are ignored).

export type SpendLimitResult = {
  allowed: boolean
  /** Total spend (USD) for the current calendar month. */
  currentSpendUsd: number
  /** Configured monthly limit (USD), or undefined if no limit. */
  limitUsd?: number
  /** User's plan used for the check. */
  plan?: 'free' | 'personal'
}

/**
 * Get the start-of-month Unix epoch for the current calendar month (UTC).
 */
function monthStartEpoch(): number {
  const now = new Date()
  return Math.floor(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime() / 1000)
}

/**
 * Query total estimated_cost_usd from token_usage for the current month.
 */
function getMonthlySpend(db: Database): number {
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total
      FROM token_usage
      WHERE created_at >= ?
    `).get(monthStartEpoch()) as { total: number } | undefined
    return row?.total ?? 0
  } catch {
    // Table may not exist yet — treat as zero spend
    return 0
  }
}

// ── Plan cache ──────────────────────────────────────────────────────────────
// Cache the user's plan locally to avoid hitting AppRoom on every request.
// Written to user_profile as key='plan', checked with 10-minute TTL.

const PLAN_CACHE_TTL = 600_000 // 10 minutes

type CachedPlan = { plan: 'free' | 'personal'; checkedAt: number }

function getCachedPlan(db: Database): CachedPlan | null {
  try {
    const row = db.prepare(
      `SELECT value, updated_at FROM user_profile WHERE key = 'plan'`
    ).get() as { value: string; updated_at: number } | undefined
    if (!row) return null

    const age = Date.now() - row.updated_at * 1000
    if (age > PLAN_CACHE_TTL) return null

    const plan = row.value === 'personal' ? 'personal' as const : 'free' as const
    return { plan, checkedAt: row.updated_at * 1000 }
  } catch {
    return null
  }
}

function setCachedPlan(db: Database, plan: 'free' | 'personal'): void {
  try {
    db.prepare(`
      INSERT INTO user_profile (key, value, updated_at, updated_by)
      VALUES ('plan', ?, unixepoch(), 'system')
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = unixepoch(), updated_by = 'system'
    `).run(plan, plan)
  } catch { /* table may not exist — non-critical */ }
}

/**
 * Resolve the user's plan. Checks local cache first (10-min TTL),
 * then queries AppRoom. Returns 'free' if anything fails.
 */
async function resolveUserPlan(db: Database): Promise<'free' | 'personal'> {
  const cached = getCachedPlan(db)
  if (cached) return cached.plan

  const { checkUserPlan } = await import('./approom/client')
  // getUserId from profile — needed for the AppRoom call
  let userId: string | undefined
  try {
    const row = db.prepare(
      `SELECT value FROM user_profile WHERE key = 'approom_user_id'`
    ).get() as { value: string } | undefined
    userId = row?.value
  } catch { /* */ }

  if (!userId) return 'free'

  const result = await checkUserPlan(userId)
  const plan = result.isActive ? result.plan : 'free'
  setCachedPlan(db, plan)
  return plan
}

/**
 * Check if the user has exceeded their monthly spend limit.
 *
 * Plan-aware: picks MYWAY_MAX_PAID_SPEND for personal plan users,
 * MYWAY_MAX_FREE_SPEND for free users. Both are optional — if the
 * relevant env var is not set, no limit applies for that tier.
 *
 * Only applies in hosted mode. Self-hosted users are never limited.
 */
export async function checkSpendLimit(db: Database): Promise<SpendLimitResult> {
  // Self-hosted: no spend limit
  if (!isHostedMode()) {
    return { allowed: true, currentSpendUsd: 0 }
  }

  const freeLimit = process.env.MYWAY_MAX_FREE_SPEND?.trim()
  const paidLimit = process.env.MYWAY_MAX_PAID_SPEND?.trim()

  // No limits configured at all — allow
  if (!freeLimit && !paidLimit) {
    return { allowed: true, currentSpendUsd: 0 }
  }

  const plan = await resolveUserPlan(db)
  const raw = plan === 'personal' ? paidLimit : freeLimit

  if (!raw) {
    // No limit for this tier — allow
    return { allowed: true, currentSpendUsd: 0, plan }
  }

  const limitUsd = parseFloat(raw)
  if (isNaN(limitUsd) || limitUsd <= 0) {
    return { allowed: true, currentSpendUsd: 0, plan }
  }

  const currentSpendUsd = getMonthlySpend(db)
  return {
    allowed: currentSpendUsd < limitUsd,
    currentSpendUsd: Math.round(currentSpendUsd * 10000) / 10000,
    limitUsd,
    plan,
  }
}

/** @deprecated Use checkSpendLimit instead. Alias kept for backward compatibility. */
export const checkFreeSpendLimit = checkSpendLimit

/**
 * Build a JSON body for a 402 spend-limit-exceeded response.
 * Reuses the same shape as quota-exceeded so the client's QuotaExceeded
 * component can display it without changes.
 */
export function buildSpendLimitExceededBody(result: SpendLimitResult): {
  quotaExceeded: true
  appName: string
  appId: string
  addonOptions: { quantity: number; priceUsd: number }[]
  message: string
  spendLimit: { currentSpendUsd: number; limitUsd: number }
  appRoomUrl?: string
} {
  const isPaid = result.plan === 'personal'
  const message = isPaid
    ? `You've reached your monthly usage limit of $${result.limitUsd?.toFixed(2)}. Contact support to increase your limit.`
    : `You've reached your monthly free usage limit of $${result.limitUsd?.toFixed(2)}. Upgrade to Personal for more.`

  return {
    quotaExceeded: true,
    appName: 'Myway',
    appId: '',
    addonOptions: [],
    message,
    spendLimit: {
      currentSpendUsd: result.currentSpendUsd,
      limitUsd: result.limitUsd!,
    },
    appRoomUrl: process.env.NEXT_PUBLIC_APPROOM_URL?.trim() || process.env.MYWAY_APPROOM_URL?.trim() || undefined,
  }
}
