/**
 * Usage Sync — push aggregated token usage to AppRoom.
 *
 * Callable manually or via a cron job. Not auto-registered.
 *
 * Flow:
 *   1. List all tenant DBs
 *   2. For each, aggregate token_usage since last sync
 *   3. POST to AppRoom via approom/client.reportUsage()
 *
 * SERVER ONLY — never import from client components.
 */

import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '@/lib/db/config'
import { getDb } from '@/lib/db'
import { isConfigured, reportUsage } from '@/lib/approom/client'
import type { Database } from 'better-sqlite3'

// ─── Tenant discovery ────────────────────────────────────────────────────────

function discoverTenantIds(): string[] {
  const ids: string[] = []
  const tenantsDir = join(DATA_DIR, 'tenants')
  if (!existsSync(tenantsDir)) return ids

  try {
    for (const entry of readdirSync(tenantsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /^[a-zA-Z0-9_-]{1,64}$/.test(entry.name)) {
        ids.push(entry.name)
      }
    }
  } catch { /* directory read failed */ }

  return ids
}

// ─── Usage aggregation ───────────────────────────────────────────────────────

type UsageAggregate = {
  tenantId: string
  model: string
  totalTokens: number
  promptTokens: number
  completionTokens: number
  estimatedCostUsd: number
  periodStart: number
  periodEnd: number
  requestCount: number
}

/**
 * Get the most recent created_at from token_usage for a tenant.
 * Used as the "last sync" marker — we aggregate everything after this point next time.
 */
function getLastSyncEpoch(db: Database): number {
  try {
    // Use a settings-like approach: check for a stored last_usage_sync_at
    const row = db.prepare(
      "SELECT value FROM user_profile WHERE key = 'last_usage_sync_at'"
    ).get() as { value: string } | undefined
    return row ? parseInt(row.value, 10) : 0
  } catch {
    return 0
  }
}

function setLastSyncEpoch(db: Database, epoch: number): void {
  try {
    db.prepare(
      "INSERT OR REPLACE INTO user_profile (key, value, updated_at, updated_by) VALUES ('last_usage_sync_at', ?, unixepoch(), 'system')"
    ).run(String(epoch))
  } catch { /* table may not exist */ }
}

function aggregateUsageSince(db: Database, sinceEpoch: number): Omit<UsageAggregate, 'tenantId'>[] {
  try {
    return db.prepare(`
      SELECT
        COALESCE(model, 'unknown') AS model,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
        COALESCE(SUM(completion_tokens), 0) AS completionTokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimatedCostUsd,
        MIN(created_at) AS periodStart,
        MAX(created_at) AS periodEnd,
        COUNT(*) AS requestCount
      FROM token_usage
      WHERE created_at > ?
      GROUP BY model
    `).all(sinceEpoch) as Omit<UsageAggregate, 'tenantId'>[]
  } catch { return [] }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sync usage data to AppRoom.
 *
 * Returns a summary of what was synced, or null if sync was skipped.
 */
export async function syncUsageToAppRoom(): Promise<{
  tenantsSynced: number
  totalRecords: number
  totalTokens: number
  error?: string
} | null> {
  if (!isConfigured()) {
    return null
  }

  const tenantIds: (string | undefined)[] = [undefined, ...discoverTenantIds()]
  const allAggregates: UsageAggregate[] = []
  let tenantsSynced = 0

  for (const tenantId of tenantIds) {
    try {
      const db = getDb(tenantId)
      const sinceEpoch = getLastSyncEpoch(db)
      const aggregates = aggregateUsageSince(db, sinceEpoch)

      if (aggregates.length === 0) continue

      const maxPeriodEnd = Math.max(...aggregates.map(a => a.periodEnd))

      for (const agg of aggregates) {
        allAggregates.push({
          tenantId: tenantId ?? 'default',
          ...agg,
        })
      }

      // Update last sync marker after successful collection
      setLastSyncEpoch(db, maxPeriodEnd)
      tenantsSynced++
    } catch (err) {
      console.error(`[usage-sync] Failed to collect usage for tenant ${tenantId ?? 'default'}:`, err)
    }
  }

  if (allAggregates.length === 0) {
    return { tenantsSynced: 0, totalRecords: 0, totalTokens: 0 }
  }

  // Group by tenant and build entries for approom/client.reportUsage()
  const byTenant = new Map<string, typeof allAggregates>()
  for (const agg of allAggregates) {
    const existing = byTenant.get(agg.tenantId)
    if (existing) existing.push(agg)
    else byTenant.set(agg.tenantId, [agg])
  }

  const entries = Array.from(byTenant.entries()).map(([tenantId, aggs]) => ({
    userId: tenantId,
    promptTokens: aggs.reduce((s, a) => s + a.promptTokens, 0),
    completionTokens: aggs.reduce((s, a) => s + a.completionTokens, 0),
    estimatedCostUsd: aggs.reduce((s, a) => s + a.estimatedCostUsd, 0),
    models: [...new Set(aggs.map(a => a.model))],
    periodStart: new Date(Math.min(...aggs.map(a => a.periodStart)) * 1000).toISOString(),
    periodEnd: new Date(Math.max(...aggs.map(a => a.periodEnd)) * 1000).toISOString(),
  }))

  const totalTokens = allAggregates.reduce((sum, a) => sum + a.totalTokens, 0)
  const result = await reportUsage(entries)

  if (!result.success) {
    return {
      tenantsSynced,
      totalRecords: allAggregates.length,
      totalTokens,
      error: result.error,
    }
  }

  return { tenantsSynced, totalRecords: allAggregates.length, totalTokens }
}
