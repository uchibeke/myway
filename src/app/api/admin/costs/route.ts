/**
 * GET /api/admin/costs?days=30
 *
 * Financial analytics for hosted Myway.
 * Shows aggregate costs, per-user budget utilization, cost trends,
 * top spenders, and projected monthly spend.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdmin, isSelfHosted } from '@/lib/admin-auth'
import { logAuthEvent } from '@/lib/auth-audit'
import { getDiscoveredTenantIds } from '@/lib/tenant-discovery'
import type { Database } from 'better-sqlite3'

type UserCostSummary = {
  tenantId: string
  totalCostUsd: number
  totalTokens: number
  requestCount: number
  avgCostPerRequest: number
}

type DayCost = {
  date: string
  totalCostUsd: number
}

type ModelCost = {
  model: string
  totalCostUsd: number
  percentage: number
}

function queryTenantCosts(db: Database, sinceEpoch: number): {
  totalCostUsd: number
  totalTokens: number
  requestCount: number
} {
  try {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(estimated_cost_usd), 0) AS totalCostUsd,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COUNT(*) AS requestCount
      FROM token_usage
      WHERE created_at >= ?
    `).get(sinceEpoch) as { totalCostUsd: number; totalTokens: number; requestCount: number }
    return row
  } catch {
    return { totalCostUsd: 0, totalTokens: 0, requestCount: 0 }
  }
}

function queryDailyCosts(db: Database, sinceEpoch: number): DayCost[] {
  try {
    return db.prepare(`
      SELECT
        date(created_at, 'unixepoch') AS date,
        COALESCE(SUM(estimated_cost_usd), 0) AS totalCostUsd
      FROM token_usage
      WHERE created_at >= ?
      GROUP BY date(created_at, 'unixepoch')
      ORDER BY date ASC
    `).all(sinceEpoch) as DayCost[]
  } catch { return [] }
}

function queryModelCosts(db: Database, sinceEpoch: number): { model: string; totalCostUsd: number }[] {
  try {
    return db.prepare(`
      SELECT
        COALESCE(model, 'unknown') AS model,
        COALESCE(SUM(estimated_cost_usd), 0) AS totalCostUsd
      FROM token_usage
      WHERE created_at >= ?
      GROUP BY model
      ORDER BY totalCostUsd DESC
    `).all(sinceEpoch) as { model: string; totalCostUsd: number }[]
  } catch { return [] }
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  try {
    const selfHosted = isSelfHosted(req)
    logAuthEvent({
      event: 'admin_access',
      userId: req.headers.get('x-myway-user-id') ?? undefined,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      detail: 'admin/costs',
    })
    const rawDays = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10)
    const days = Math.max(1, Math.min(isNaN(rawDays) ? 30 : rawDays, 365))
    const sinceEpoch = Math.floor(Date.now() / 1000) - days * 86400

    // Previous period for comparison
    const prevSinceEpoch = sinceEpoch - days * 86400

    const tenantIds: (string | undefined)[] = selfHosted
      ? [undefined]
      : [undefined, ...getDiscoveredTenantIds()]

    const perUser: UserCostSummary[] = []
    const dailyCosts = new Map<string, number>()
    const modelCosts = new Map<string, number>()
    let grandTotalCost = 0
    let grandTotalTokens = 0
    let grandTotalRequests = 0
    let prevPeriodCost = 0

    for (const tenantId of tenantIds) {
      try {
        const db = getDb(tenantId)

        // Current period
        const totals = queryTenantCosts(db, sinceEpoch)
        grandTotalCost += totals.totalCostUsd
        grandTotalTokens += totals.totalTokens
        grandTotalRequests += totals.requestCount

        // Previous period total for comparison
        try {
          const prev = db.prepare(`
            SELECT COALESCE(SUM(estimated_cost_usd), 0) AS totalCostUsd
            FROM token_usage
            WHERE created_at >= ? AND created_at < ?
          `).get(prevSinceEpoch, sinceEpoch) as { totalCostUsd: number }
          prevPeriodCost += prev.totalCostUsd
        } catch { /* table may not exist */ }

        // Per user costs
        if (!selfHosted && totals.requestCount > 0) {
          perUser.push({
            tenantId: tenantId ?? 'default',
            totalCostUsd: totals.totalCostUsd,
            totalTokens: totals.totalTokens,
            requestCount: totals.requestCount,
            avgCostPerRequest: totals.requestCount > 0
              ? Math.round((totals.totalCostUsd / totals.requestCount) * 10000) / 10000
              : 0,
          })
        }

        // Daily costs
        for (const d of queryDailyCosts(db, sinceEpoch)) {
          dailyCosts.set(d.date, (dailyCosts.get(d.date) ?? 0) + d.totalCostUsd)
        }

        // Model costs
        for (const m of queryModelCosts(db, sinceEpoch)) {
          modelCosts.set(m.model, (modelCosts.get(m.model) ?? 0) + m.totalCostUsd)
        }
      } catch { /* skip failed tenant */ }
    }

    // Sort per-user by cost DESC (top spenders first)
    perUser.sort((a, b) => b.totalCostUsd - a.totalCostUsd)

    // Round totals
    grandTotalCost = Math.round(grandTotalCost * 10000) / 10000
    prevPeriodCost = Math.round(prevPeriodCost * 10000) / 10000

    // Cost change percentage
    const costChangePercent = prevPeriodCost > 0
      ? Math.round(((grandTotalCost - prevPeriodCost) / prevPeriodCost) * 100)
      : null

    // Average cost per user
    const activeUsers = perUser.filter(u => u.requestCount > 0).length
    const avgCostPerUser = activeUsers > 0
      ? Math.round((grandTotalCost / activeUsers) * 100) / 100
      : 0

    // Projected monthly cost (extrapolate from daily average)
    const dailyAvg = days > 0 ? grandTotalCost / days : 0
    const projectedMonthlyCost = Math.round(dailyAvg * 30 * 100) / 100

    // Model breakdown with percentages
    const modelBreakdown: ModelCost[] = Array.from(modelCosts.entries())
      .map(([model, cost]) => ({
        model,
        totalCostUsd: Math.round(cost * 10000) / 10000,
        percentage: grandTotalCost > 0 ? Math.round((cost / grandTotalCost) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd)

    // Daily cost trend
    const dailyTrend: DayCost[] = Array.from(dailyCosts.entries())
      .map(([date, totalCostUsd]) => ({
        date,
        totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json({
      days,
      totalCostUsd: grandTotalCost,
      totalTokens: grandTotalTokens,
      totalRequests: grandTotalRequests,
      prevPeriodCostUsd: prevPeriodCost,
      costChangePercent,
      avgCostPerUser,
      projectedMonthlyCost,
      activeUsers,
      byModel: modelBreakdown,
      dailyTrend,
      topSpenders: perUser.slice(0, 20),
      isSelfHosted: selfHosted,
    })
  } catch (err) {
    console.error('[GET /api/admin/costs]', err)
    return NextResponse.json(
      { error: 'Failed to aggregate costs' },
      { status: 500 },
    )
  }
}
