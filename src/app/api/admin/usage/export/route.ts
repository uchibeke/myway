/**
 * GET /api/admin/usage/export?since=<epoch>
 *
 * Returns usage data for AppRoom to consume.
 * Auth: MYWAY_API_TOKEN (via Bearer header) or admin session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdmin, isSelfHosted } from '@/lib/admin-auth'
import { logAuthEvent } from '@/lib/auth-audit'
import { getDiscoveredTenantIds } from '@/lib/tenant-discovery'
import type { Database } from 'better-sqlite3'

type UsageRecord = {
  tenantId: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number
  createdAt: number
}

function queryUsageSince(db: Database, sinceEpoch: number): Omit<UsageRecord, 'tenantId'>[] {
  try {
    return db.prepare(`
      SELECT
        COALESCE(model, 'unknown') AS model,
        prompt_tokens AS promptTokens,
        completion_tokens AS completionTokens,
        total_tokens AS totalTokens,
        estimated_cost_usd AS estimatedCostUsd,
        created_at AS createdAt
      FROM token_usage
      WHERE created_at >= ?
      ORDER BY created_at ASC
    `).all(sinceEpoch) as Omit<UsageRecord, 'tenantId'>[]
  } catch { return [] }
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  try {
    logAuthEvent({
      event: 'admin_access',
      userId: req.headers.get('x-myway-user-id') ?? undefined,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      detail: 'admin/usage/export',
    })
    const sinceParam = req.nextUrl.searchParams.get('since')
    const sinceEpoch = sinceParam ? parseInt(sinceParam, 10) : 0

    const records: UsageRecord[] = []
    const selfHosted = isSelfHosted(req)
    const tenantIds: (string | undefined)[] = selfHosted
      ? [undefined]
      : [undefined, ...getDiscoveredTenantIds()]

    for (const tenantId of tenantIds) {
      try {
        const db = getDb(tenantId)
        const rows = queryUsageSince(db, sinceEpoch)
        for (const row of rows) {
          records.push({ tenantId: tenantId ?? 'default', ...row })
        }
      } catch { /* skip failed tenant */ }
    }

    return NextResponse.json({
      since: sinceEpoch,
      exportedAt: Math.floor(Date.now() / 1000),
      recordCount: records.length,
      records,
    })
  } catch (err) {
    console.error('[GET /api/admin/usage/export]', err)
    return NextResponse.json(
      { error: 'Failed to export usage' },
      { status: 500 },
    )
  }
}
