/**
 * GET /api/admin/tenants
 *
 * Lists all tenants with usage stats.
 * Self-hosted mode: returns only the default tenant (you).
 * Hosted mode: scans tenant directories for all users.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '@/lib/db/config'
import { getDb } from '@/lib/db'
import { requireAdmin, isSelfHosted } from '@/lib/admin-auth'

type TenantStats = {
  tenantId: string
  totalMessages: number
  totalTokens: number
  totalCostUsd: number
  lastActiveAt: number | null
}

function getTenantStats(tenantId?: string): TenantStats {
  const id = tenantId ?? 'default'
  try {
    const db = getDb(tenantId)

    let totalMessages = 0
    try {
      const row = db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }
      totalMessages = row.c
    } catch { /* table may not exist */ }

    let totalTokens = 0
    let totalCostUsd = 0
    try {
      const row = db.prepare(
        'SELECT COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(estimated_cost_usd), 0) AS cost FROM token_usage'
      ).get() as { tokens: number; cost: number }
      totalTokens = row.tokens
      totalCostUsd = Math.round(row.cost * 10000) / 10000
    } catch { /* table may not exist */ }

    let lastActiveAt: number | null = null
    try {
      const row = db.prepare(
        'SELECT MAX(created_at) AS last FROM messages'
      ).get() as { last: number | null }
      lastActiveAt = row.last
    } catch { /* table may not exist */ }

    return { tenantId: id, totalMessages, totalTokens, totalCostUsd, lastActiveAt }
  } catch {
    return { tenantId: id, totalMessages: 0, totalTokens: 0, totalCostUsd: 0, lastActiveAt: null }
  }
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  try {
    const tenants: TenantStats[] = []
    const selfHosted = isSelfHosted(req)

    // Default (self-hosted) tenant — always included
    tenants.push(getTenantStats(undefined))

    // Only discover additional tenants in hosted mode
    if (!selfHosted) {
      const tenantsDir = join(DATA_DIR, 'tenants')
      if (existsSync(tenantsDir)) {
        try {
          for (const entry of readdirSync(tenantsDir, { withFileTypes: true })) {
            if (entry.isDirectory() && /^[a-zA-Z0-9_-]{1,64}$/.test(entry.name)) {
              tenants.push(getTenantStats(entry.name))
            }
          }
        } catch { /* directory read failed */ }
      }
    }

    // Sort by cost DESC
    tenants.sort((a, b) => b.totalCostUsd - a.totalCostUsd)

    return NextResponse.json({ tenants, isSelfHosted: selfHosted })
  } catch (err) {
    console.error('[GET /api/admin/tenants]', err)
    return NextResponse.json(
      { error: 'Failed to list tenants' },
      { status: 500 },
    )
  }
}
