/**
 * GET /api/context/summary
 *
 * Lightweight endpoint returning the context palette for client-side
 * dynamic opener presets. Module-level cache with 2-minute TTL to avoid
 * DB thrashing from frequent opener renders.
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { buildContextPalette } from '@/lib/context-palette'
import type { ContextPalette } from '@/lib/context-palette'

let cached: { palette: ContextPalette; ts: number } | null = null
const TTL_MS = 2 * 60 * 1000 // 2 minutes

export async function GET(req: NextRequest) {
  const now = Date.now()

  if (cached && now - cached.ts < TTL_MS) {
    return Response.json(cached.palette)
  }

  try {
    const tenantId = getTenantId(req)
    const db = getDb(tenantId)
    const palette = buildContextPalette(db, tenantId)
    cached = { palette, ts: now }
    return Response.json(palette)
  } catch (err) {
    console.error('[context/summary] Error building palette:', err)
    // Return empty palette on error — graceful degradation
    const empty: ContextPalette = { sources: [], totalItems: 0 }
    return Response.json(empty)
  }
}
