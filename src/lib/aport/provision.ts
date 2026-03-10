/**
 * APort passport provisioning — issues org passports for new users.
 *
 * Mirrors AppRoom's aport.ts createBuilderPassport() flow:
 *   POST {APORT_API_URL}/api/orgs/{APORT_ORG_ID}/issue?turnOffNotification=true
 *
 * Triggered once when a user first sets their profile (onboarding moment).
 * The issued passport is saved as the 'default' entry in user_passports.
 *
 * Env vars (all optional — provisioning silently skips if not configured):
 *   APORT_ORG_ID        — Organization ID for issuance
 *   APORT_API_KEY        — API key for APort org API
 *   APORT_API_URL       — defaults to https://api.aport.io
 *
 * SERVER ONLY.
 */

import type { Database } from 'better-sqlite3'
import { savePassport, getPassportForApp } from './passport-store'

type ProvisionResult = {
  provisioned: boolean
  passportId?: string
  error?: string
}

/**
 * Default capabilities for Myway user passports.
 * Matches what AppRoom issues for builders.
 */
const DEFAULT_CAPABILITIES = [
  { id: 'web.fetch' },
  { id: 'data.file.read' },
  { id: 'data.file.write' },
  { id: 'mcp.tool.execute' },
]

/**
 * Provision an APort passport for a user if they don't already have one.
 *
 * Call this after the user sets their profile for the first time.
 * Silently returns { provisioned: false } if:
 *   - APORT_ORG_ID or APORT_API_KEY not set
 *   - User already has a default passport
 *   - APort API is unreachable
 */
export async function provisionPassportIfNeeded(
  db: Database,
  user: { name: string; email?: string },
): Promise<ProvisionResult> {
  const orgId = process.env.APORT_ORG_ID?.trim()
  const apiKey = process.env.APORT_API_KEY?.trim()
  const baseUrl = process.env.APORT_API_URL?.trim() || 'https://api.aport.io'

  // Not configured — skip silently
  if (!orgId || !apiKey) {
    return { provisioned: false }
  }

  // Already has a passport — skip
  try {
    const existing = getPassportForApp(db, 'default')
    if (existing) return { provisioned: false }
  } catch {
    // Table might not exist — will fail on save too, but let's try
  }

  // contact is REQUIRED by the APort API — use email or a noreply fallback.
  // Mirrors AppRoom's createBuilderPassport() which always sends contact: email.
  const contact = user.email || `noreply+${user.name.replace(/[^a-zA-Z0-9_-]/g, '_')}@myway.local`

  try {
    const url = `${baseUrl}/api/orgs/${orgId}/issue?turnOffNotification=true`

    const passportData = {
      name: `${user.name}'s Myway Passport`,
      role: 'agent',
      description: `Myway user passport for ${user.name}`,
      regions: ['US', 'CA', 'EU'],
      contact,
      assurance: {
        type: 'kyc' as const,
        assurance_level: 'L0',
        proof: {
          verification_id: `ver_myway_${Date.now()}`,
          verified_at: new Date().toISOString(),
        },
      },
      capabilities: DEFAULT_CAPABILITIES,
      limits: {},
      status: 'active',
      metadata: {
        provider: 'myway',
        created_at: new Date().toISOString(),
      },
      pending_owner: {
        email: contact,
        display_name: user.name,
      },
      send_claim_email: true,
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(passportData),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ message: res.statusText })) as { message?: string }
      console.error(`[aport-provision] Issue failed ${res.status}:`, errorData.message || res.statusText)
      return { provisioned: false, error: errorData.message || `APort API returned ${res.status}` }
    }

    // Parse response — handle multiple shapes (matches AppRoom's parsing)
    const result = await res.json() as Record<string, unknown>
    const responseData = (result.data ?? result) as Record<string, unknown>
    const passport = (responseData.data ?? responseData) as Record<string, unknown>

    const passportId = String(
      passport.agent_id ||
      responseData.agent_id ||
      passport.id ||
      passport.passport_id ||
      passport.passportId ||
      passport.instance_id ||
      ''
    )

    if (!passportId) {
      console.error('[aport-provision] No passportId in response:', JSON.stringify(result).slice(0, 200))
      return { provisioned: false, error: 'No passport ID returned' }
    }

    // Save as default passport (no API key needed for org-issued passports)
    savePassport(db, {
      appId: 'default',
      agentId: passportId,
      label: `${user.name}'s Passport`,
    })

    console.log(`[aport-provision] Issued passport ${passportId} for ${user.name}`)
    return { provisioned: true, passportId }
  } catch (err) {
    console.error('[aport-provision] Failed:', err instanceof Error ? err.message : err)
    return { provisioned: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
