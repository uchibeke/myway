/**
 * GET  /api/aport/passport — returns passport status + DB-stored passports
 * POST /api/aport/passport — save or delete a DB-backed passport
 *
 * GET returns:
 *   { current: PassportStatus, passports: UserPassport[], verify: { agentId, url } | null }
 *
 * POST body:
 *   { action: 'save', appId, agentId, apiKey, label? }
 *   { action: 'delete', appId }
 *
 * Never exposes raw API keys — only agent IDs and metadata.
 */

import { NextRequest } from 'next/server'
import { getAportConfig } from '@/lib/aport/config'
import { readPassportForTenant, type PassportStatus } from '@/lib/aport/passport-reader'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { listPassports, savePassport, deletePassport } from '@/lib/aport/passport-store'
import type { UserPassport } from '@/lib/aport/passport-store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const config = getAportConfig()
    const tenantId = getTenantId(req)
    const db = getDb(tenantId)

    // Tenant-aware resolution: logged-in → DB only; anonymous → DB → file → env
    const current = await readPassportForTenant(db, config, 'default', !!tenantId)

    // Enrich with live APort API data if we have a passport ID
    let enriched: PassportStatus = current
    if (current.configured && current.passportId) {
      try {
        const verifyUrl = `${config.apiUrl ?? 'https://api.aport.io'}/api/verify/${current.passportId}`
        const res = await fetch(verifyUrl, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(5_000),
        })
        if (res.ok) {
          const data = await res.json()
          enriched = {
            ...current,
            passportId: data.passport_id ?? current.passportId,
            ownerId: data.owner_id,
            status: data.status ?? 'active',
            assuranceLevel: data.assurance_level ?? 'L0',
            capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
            specVersion: data.spec_version,
            kind: data.kind,
          }
        }
      } catch {
        // Non-critical — show what we have from DB/config
      }
    }

    // List DB-stored passports (never includes API keys)
    let passports: UserPassport[] = []
    try {
      passports = listPassports(db)
    } catch {
      // Table might not exist yet
    }

    return Response.json({
      current: enriched,
      passports,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return Response.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb(getTenantId(req))
    const body = await req.json() as {
      action: 'save' | 'delete'
      appId?: string
      agentId?: string
      apiKey?: string
      label?: string
    }

    if (body.action === 'delete') {
      if (!body.appId) {
        return Response.json({ error: 'appId is required' }, { status: 400 })
      }
      const deleted = deletePassport(db, body.appId)
      return Response.json({ deleted })
    }

    if (body.action === 'save') {
      if (!body.appId || !body.agentId) {
        return Response.json({ error: 'appId and agentId are required' }, { status: 400 })
      }

      // Validate agent ID format
      if (!body.agentId.startsWith('ap_')) {
        return Response.json({ error: 'Agent ID must start with ap_' }, { status: 400 })
      }

      const passport = savePassport(db, {
        appId: body.appId,
        agentId: body.agentId,
        apiKey: body.apiKey,
        label: body.label,
      })

      return Response.json({ passport })
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return Response.json({ error: message }, { status: 500 })
  }
}
