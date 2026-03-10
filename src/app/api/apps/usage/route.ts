/**
 * GET /api/apps/usage?appId=<id>&period=month|week|day
 *
 * Returns token usage stats for a specific app.
 * For paid apps, also returns quota info from AppRoom.
 *
 * Used by the in-app usage info popover.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { getApp } from '@/lib/apps'
import { checkQuota, isConfigured as isAppRoomConfigured } from '@/lib/approom/client'

type UsageRow = {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  estimatedCostUsd: number
  requestCount: number
}

export async function GET(req: NextRequest) {
  const appId = req.nextUrl.searchParams.get('appId')
  if (!appId) {
    return NextResponse.json({ error: 'appId is required' }, { status: 400 })
  }

  const period = req.nextUrl.searchParams.get('period') ?? 'month'
  const db = getDb(getTenantId(req))
  const app = getApp(appId, db)

  if (!app) {
    return NextResponse.json({ error: 'App not found' }, { status: 404 })
  }

  // Calculate period start
  const now = new Date()
  let sinceEpoch: number
  if (period === 'day') {
    sinceEpoch = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
  } else if (period === 'week') {
    const weekAgo = new Date(now)
    weekAgo.setDate(weekAgo.getDate() - 7)
    sinceEpoch = Math.floor(weekAgo.getTime() / 1000)
  } else {
    // month — first of current month
    sinceEpoch = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000)
  }

  // Local usage stats
  let usage: UsageRow = { totalTokens: 0, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0, requestCount: 0 }
  try {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
        COALESCE(SUM(completion_tokens), 0) AS completionTokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimatedCostUsd,
        COUNT(*) AS requestCount
      FROM token_usage
      WHERE app_id = ? AND created_at >= ?
    `).get(appId, sinceEpoch) as UsageRow | undefined
    if (row) usage = row
  } catch { /* token_usage table may not exist */ }

  // Quota info for paid apps
  let quota: { remaining: number; total: number; outcomeId: string } | null = null
  if (app.pricing?.model === 'subscription' && isAppRoomConfigured()) {
    const userId = req.headers.get('x-myway-user-id') ?? undefined
    const outcomeId = app.pricing.outcomeTypes?.[0]
    if (userId && outcomeId) {
      try {
        const result = await checkQuota(userId, appId, outcomeId)
        quota = {
          remaining: result.remaining ?? 0,
          total: (result.remaining ?? 0) + usage.requestCount, // approximate
          outcomeId,
        }
      } catch { /* non-critical */ }
    }
  }

  return NextResponse.json({
    appId,
    appName: app.name,
    period,
    isPaid: app.pricing?.model === 'subscription',
    usage: {
      totalTokens: usage.totalTokens,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      estimatedCostUsd: Math.round(usage.estimatedCostUsd * 10000) / 10000,
      requestCount: usage.requestCount,
    },
    quota,
    pricing: app.pricing ?? null,
  })
}
