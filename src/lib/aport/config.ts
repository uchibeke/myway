/**
 * APort configuration — resolves mode and paths.
 *
 * Three evaluation modes (matching the OpenClaw plugin):
 *   1. LOCAL  (mode: "local")  — Passport on disk, policies evaluated locally. No network.
 *   2. API    (mode: "api")    — Passport on disk, policies evaluated via APort API.
 *   3. HOSTED (mode: "api" + agentId) — Passport in APort registry, everything via API.
 *
 * Mode detection priority:
 *   1. APORT_MODE env var ("local" | "api")
 *   2. OpenClaw plugin config in openclaw.json → plugins.entries.openclaw-aport.config.mode
 *   3. Default: "local"
 *
 * When mode is "api" and APORT_AGENT_ID is set → hosted passport (fetched from API).
 * When mode is "api" and no agent ID           → local passport sent to API for evaluation.
 *
 * Common env vars (all optional — defaults resolve from ~/.openclaw):
 *   OPENCLAW_DIR           OpenClaw config dir      (default: ~/.openclaw)
 *   APORT_PASSPORT_FILE    Path to passport.json   (default: ~/.openclaw/aport/passport.json)
 *   APORT_AUDIT_LOG        Path to audit.log        (default: ~/.openclaw/aport/audit.log)
 *   APORT_DECISION_FILE    Path to decision.json    (default: ~/.openclaw/aport/decision.json)
 *
 * API / Hosted mode env vars:
 *   APORT_API_URL          APort API base URL       (default: https://api.aport.io)
 *   APORT_API_KEY          API key for authentication
 *   APORT_AGENT_ID         Agent ID (ap_xxxx) — makes it "hosted" mode
 *
 * SERVER ONLY — never import from client components.
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'

export type AportMode = 'local' | 'api'

export type AportConfig = {
  /** "local" = local evaluation, "api" = APort API evaluation (with or without hosted passport) */
  mode: AportMode
  passportFile: string
  auditLog: string
  decisionFile: string
  openclawDir: string
  /** APort API URL — set when mode is "api" */
  apiUrl?: string
  /** APort API key — set when mode is "api" */
  apiKey?: string
  /** Agent ID (ap_xxxx) — when set, passport is fetched from API (hosted). When absent, local passport is sent to API. */
  agentId?: string
  /** Convenience flag: true when mode is "api" and agentId is set */
  hosted: boolean
}

/** Expand leading `~` to the OS home directory. */
function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(1))
  }
  return p
}

/** Resolve an env var path or fall back to a default under openclawDir. */
function resolveEnvPath(envVar: string, fallback: string): string {
  const raw = process.env[envVar]
  if (raw?.trim()) return expandHome(raw.trim())
  return fallback
}

/** Read the openclaw-aport plugin config from openclaw.json. */
function readPluginConfig(openclawDir: string): Record<string, unknown> | null {
  const configPath = join(openclawDir, 'openclaw.json')
  try {
    if (!existsSync(configPath)) return null
    const raw = readFileSync(configPath, 'utf8')
    const data = JSON.parse(raw)
    return data?.plugins?.entries?.['openclaw-aport']?.config ?? null
  } catch {
    return null
  }
}

let _config: AportConfig | null = null
let _configCachedAt = 0
const CONFIG_TTL_MS = 60_000  // re-read openclaw.json at most once per minute

/**
 * Returns the APort configuration.
 *
 * Cached with a 60-second TTL so that runtime changes to openclaw.json
 * (e.g. switching mode local ↔ api) take effect without a full restart.
 *
 * Reads env vars and openclaw.json plugin config to determine mode.
 */
export function getAportConfig(): AportConfig {
  if (_config && Date.now() - _configCachedAt < CONFIG_TTL_MS) return _config

  const openclawDir = resolveEnvPath(
    'OPENCLAW_DIR',
    join(homedir(), '.openclaw'),
  )

  const aportDir = join(openclawDir, 'aport')
  const pluginConfig = readPluginConfig(openclawDir)

  // Determine mode: env var > plugin config > default
  const envMode = process.env['APORT_MODE']?.trim()
  const pluginMode = typeof pluginConfig?.mode === 'string' ? pluginConfig.mode : null
  const resolvedMode: AportMode =
    envMode === 'api' || envMode === 'hosted' ? 'api'
    : envMode === 'local' ? 'local'
    : pluginMode === 'api' || pluginMode === 'hosted' ? 'api'
    : pluginMode === 'local' ? 'local'
    : 'local'

  // Hosted mode fields — env vars override plugin config
  const apiUrl = process.env['APORT_API_URL']?.trim()
    || (typeof pluginConfig?.apiUrl === 'string' ? pluginConfig.apiUrl : undefined)
    || 'https://api.aport.io'

  const apiKey = process.env['APORT_API_KEY']?.trim()
    || (typeof pluginConfig?.apiKey === 'string' ? pluginConfig.apiKey : undefined)

  const agentId = process.env['APORT_AGENT_ID']?.trim()
    || (typeof pluginConfig?.agentId === 'string' ? pluginConfig.agentId : undefined)

  const isHosted = resolvedMode === 'api' && !!agentId

  _config = {
    mode: resolvedMode,
    openclawDir,
    passportFile:   resolveEnvPath('APORT_PASSPORT_FILE',  join(aportDir, 'passport.json')),
    auditLog:       resolveEnvPath('APORT_AUDIT_LOG',       join(aportDir, 'audit.log')),
    decisionFile:   resolveEnvPath('APORT_DECISION_FILE',   join(aportDir, 'decision.json')),
    hosted: isHosted,
    ...(resolvedMode === 'api' && { apiUrl, apiKey, agentId }),
  }
  _configCachedAt = Date.now()

  return _config
}

/** Reset cache — used in tests to inject different env vars between test cases. */
export function _resetConfigCache(): void {
  _config = null
  _configCachedAt = 0
}
