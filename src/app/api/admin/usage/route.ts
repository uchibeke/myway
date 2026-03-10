/**
 * GET /api/admin/usage?days=30
 *
 * Cross-tenant usage aggregation.
 * Self-hosted: queries default DB only.
 * Hosted: aggregates across all tenant DBs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdmin, isSelfHosted } from '@/lib/admin-auth'
import { logAuthEvent } from '@/lib/auth-audit'
import { getDiscoveredTenantIds } from '@/lib/tenant-discovery'
import type { Database } from 'better-sqlite3'

type ModelUsage = {
  model: string
  totalTokens: number
  totalCostUsd: number
  requestCount: number
}

type DayUsage = {
  date: string
  totalTokens: number
  totalCostUsd: number
}

type TenantUsage = {
  tenantId: string
  totalTokens: number
  totalCostUsd: number
  requestCount: number
}

function queryUsageByModel(db: Database, sinceEpoch: number): ModelUsage[] {
  try {
    return db.prepare(`
      SELECT
        COALESCE(model, 'unknown') AS model,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS totalCostUsd,
        COUNT(*) AS requestCount
      FROM token_usage
      WHERE created_at >= ?
      GROUP BY model
    `).all(sinceEpoch) as ModelUsage[]
  } catch { return [] }
}

function queryUsageByDay(db: Database, sinceEpoch: number): DayUsage[] {
  try {
    return db.prepare(`
      SELECT
        date(created_at, 'unixepoch') AS date,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS totalCostUsd
      FROM token_usage
      WHERE created_at >= ?
      GROUP BY date(created_at, 'unixepoch')
      ORDER BY date ASC
    `).all(sinceEpoch) as DayUsage[]
  } catch { return [] }
}

function queryTenantTotals(db: Database, sinceEpoch: number): { totalTokens: number; totalCostUsd: number; requestCount: number } {
  try {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS totalCostUsd,
        COUNT(*) AS requestCount
      FROM token_usage
      WHERE created_at >= ?
    `).get(sinceEpoch) as { totalTokens: number; totalCostUsd: number; requestCount: number }
    return row
  } catch {
    return { totalTokens: 0, totalCostUsd: 0, requestCount: 0 }
  }
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
      detail: 'admin/usage',
    })
    const rawDays = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10)
    const days = Math.max(1, Math.min(isNaN(rawDays) ? 30 : rawDays, 365))
    const sinceEpoch = Math.floor(Date.now() / 1000) - days * 86400

    const byModel = new Map<string, ModelUsage>()
    const byDay = new Map<string, DayUsage>()
    const perUser: TenantUsage[] = []

    // Self-hosted: only default DB. Hosted: all tenant DBs.
    const tenantIds: (string | undefined)[] = selfHosted
      ? [undefined]
      : [undefined, ...getDiscoveredTenantIds()]

    for (const tenantId of tenantIds) {
      try {
        const db = getDb(tenantId)

        // Per-model
        for (const m of queryUsageByModel(db, sinceEpoch)) {
          const existing = byModel.get(m.model)
          if (existing) {
            existing.totalTokens += m.totalTokens
            existing.totalCostUsd += m.totalCostUsd
            existing.requestCount += m.requestCount
          } else {
            byModel.set(m.model, { ...m })
          }
        }

        // Per-day
        for (const d of queryUsageByDay(db, sinceEpoch)) {
          const existing = byDay.get(d.date)
          if (existing) {
            existing.totalTokens += d.totalTokens
            existing.totalCostUsd += d.totalCostUsd
          } else {
            byDay.set(d.date, { ...d })
          }
        }

        // Per-user totals (skip in self-hosted — there's only one user)
        if (!selfHosted) {
          const totals = queryTenantTotals(db, sinceEpoch)
          if (totals.requestCount > 0) {
            perUser.push({
              tenantId: tenantId ?? 'default',
              ...totals,
            })
          }
        }
      } catch { /* skip failed tenant */ }
    }

    // Sort per-user by cost DESC
    perUser.sort((a, b) => b.totalCostUsd - a.totalCostUsd)

    // Compute grand totals
    let totalTokens = 0
    let totalCostUsd = 0
    if (perUser.length > 0) {
      totalTokens = perUser.reduce((sum, u) => sum + u.totalTokens, 0)
      totalCostUsd = perUser.reduce((sum, u) => sum + u.totalCostUsd, 0)
    } else {
      // Self-hosted: totals from byModel
      for (const m of byModel.values()) {
        totalTokens += m.totalTokens
        totalCostUsd += m.totalCostUsd
      }
    }
    totalCostUsd = Math.round(totalCostUsd * 10000) / 10000

    return NextResponse.json({
      days,
      totalTokens,
      totalCostUsd,
      byModel: Array.from(byModel.values()).sort((a, b) => b.totalCostUsd - a.totalCostUsd),
      byDay: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
      perUser,
      isSelfHosted: selfHosted,
    })
  } catch (err) {
    console.error('[GET /api/admin/usage]', err)
    return NextResponse.json(
      { error: 'Failed to aggregate usage' },
      { status: 500 },
    )
  }
}
