/**
 * APort passport reader.
 *
 * Two modes:
 *   LOCAL:  Reads passport.json from the configured file path.
 *   HOSTED: Fetches passport status from the APort API using agent_id + api_key.
 *
 * Graceful degradation in both modes:
 *   - Not configured → { configured: false }
 *   - Error          → { configured: true, error: "..." }
 *   - Valid          → full PassportStatus
 *
 * Never throws. SERVER ONLY.
 */

import { existsSync, readFileSync } from 'fs'
import type { Database } from 'better-sqlite3'
import type { AportConfig } from './config'

export type AssuranceLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4KYC' | 'L4FIN'

export type PassportCapability = {
  id: string
  [key: string]: unknown
}

export type PassportStatus = {
  /** Whether a passport is available (local file exists or hosted agent is configured) */
  configured: boolean
  passportId?: string
  /** The passport owner (may be placeholder "user@example.com") */
  ownerId?: string
  status?: 'active' | 'suspended' | 'revoked'
  assuranceLevel?: AssuranceLevel
  capabilities?: PassportCapability[]
  specVersion?: string
  kind?: 'template' | 'instance'
  /** "local" or "hosted" — indicates which mode is in use */
  mode?: 'local' | 'api' | 'hosted'
  /** Human-readable error if file exists but is malformed or invalid */
  error?: string
  /** The file path that was read (local mode) or API URL (hosted mode) */
  filePath?: string
}

/**
 * Sync passport read — always reads from local file. Use readPassportAsync for API/hosted.
 */
export function readPassport(config: AportConfig): PassportStatus {
  return readLocalPassport(config.passportFile)
}

/**
 * Async passport read — used by API routes. Dispatches based on config:
 *   - local:  reads passport.json from disk
 *   - api (no agentId): reads local passport (API evaluation happens at guardrail level)
 *   - api + agentId (hosted): fetches passport from APort API
 */
export async function readPassportAsync(config: AportConfig): Promise<PassportStatus> {
  if (config.hosted && config.agentId && config.apiKey) {
    return readHostedPassport(config)
  }
  // Local or API-with-local-passport — read from file
  const local = readLocalPassport(config.passportFile)
  if (config.mode === 'api') local.mode = 'api'
  return local
}

/**
 * Read and parse the local APort passport file.
 * Returns a PassportStatus regardless of file state — never throws.
 */
export function readLocalPassport(filePath: string): PassportStatus {
  if (!existsSync(filePath)) {
    return { configured: false, filePath, mode: 'local' }
  }

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (err: unknown) {
    return {
      configured: true,
      error: `Could not read passport file: ${err instanceof Error ? err.message : String(err)}`,
      filePath,
      mode: 'local',
    }
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw)
  } catch {
    return {
      configured: true,
      error: 'Passport file contains invalid JSON',
      filePath,
      mode: 'local',
    }
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      configured: true,
      error: 'Passport file must be a JSON object, not an array or primitive',
      filePath,
      mode: 'local',
    }
  }

  return parsePassportData(data, filePath, 'local')
}

/**
 * Fetch passport from the APort hosted API.
 */
async function readHostedPassport(config: AportConfig): Promise<PassportStatus> {
  const { apiUrl, apiKey, agentId } = config
  const url = `${apiUrl}/v1/agents/${agentId}/passport`

  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      if (res.status === 404) {
        return {
          configured: false,
          mode: 'hosted',
          filePath: url,
          error: `Agent ${agentId} not found on APort`,
        }
      }
      return {
        configured: true,
        mode: 'hosted',
        filePath: url,
        error: `APort API returned HTTP ${res.status}`,
      }
    }

    const data = await res.json()
    return parsePassportData(data, url, 'hosted')
  } catch (err: unknown) {
    return {
      configured: true,
      mode: 'hosted',
      filePath: url,
      error: `Failed to reach APort API: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Tenant-aware passport read.
 *
 * Resolution chain:
 *   1. DB passport (user_passports table, per-app → default)
 *   2. If logged-in user (isTenant=true): stop here — DB only, no fallback
 *   3. If anonymous/self-hosted: local file (passport.json) → env vars
 *   4. Not configured
 *
 * @param isTenant - true when request has a tenant ID (logged-in user).
 *                   Prevents fallback to local file / env var passports.
 */
export async function readPassportForTenant(
  db: Database,
  config: AportConfig,
  appId: string = 'default',
  isTenant: boolean = false,
): Promise<PassportStatus> {
  // 1. Check DB passports
  try {
    const { getPassportForApp } = require('./passport-store') as typeof import('./passport-store')
    const dbPassport = getPassportForApp(db, appId)
    if (dbPassport) {
      return {
        configured: true,
        passportId: dbPassport.agentId,
        status: 'active', // Actual status fetched by API route when displaying
        mode: 'hosted',
        filePath: `db:user_passports:${dbPassport.appId}`,
      }
    }
  } catch {
    // Table might not exist yet — fall through
  }

  // Logged-in user: DB passport is the only source. No local file / env leak.
  if (isTenant) {
    return { configured: false }
  }

  // Anonymous / self-hosted: fall back to local file → env vars
  return readPassportAsync(config)
}

/** Shared parser for both local and hosted passport data. */
function parsePassportData(
  data: Record<string, unknown>,
  source: string,
  mode: 'local' | 'hosted',
): PassportStatus {
  const passportId  = typeof data['passport_id']     === 'string' ? data['passport_id']     : undefined
  const ownerId     = typeof data['owner_id']         === 'string' ? data['owner_id']         : undefined
  const status      = typeof data['status']           === 'string' ? data['status']           : undefined
  const level       = typeof data['assurance_level']  === 'string' ? data['assurance_level']  : undefined
  const specVersion = typeof data['spec_version']     === 'string' ? data['spec_version']     : undefined
  const kind        = typeof data['kind']             === 'string' ? data['kind']             : undefined

  const rawCaps = data['capabilities']
  const capabilities: PassportCapability[] = Array.isArray(rawCaps)
    ? rawCaps.filter((c): c is PassportCapability => typeof c === 'object' && c !== null && 'id' in c)
    : []

  return {
    configured:     true,
    passportId,
    ownerId,
    status:         (status as PassportStatus['status']) ?? 'active',
    assuranceLevel: (level as AssuranceLevel) ?? 'L0',
    capabilities,
    specVersion,
    kind:           (kind as PassportStatus['kind']) ?? 'template',
    mode,
    filePath: source,
  }
}
