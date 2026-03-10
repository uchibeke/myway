/**
 * APort kill-switch module.
 *
 * Aligned with the official @aporthq/aport-agent-guardrails implementation:
 *   "The passport is the source of truth. We do NOT create or read any separate file."
 *
 * Two modes:
 *   LOCAL:  Reads/writes `passport.json` status field directly.
 *   HOSTED: API call to APort to suspend/reactivate the agent's passport.
 *
 * Kill switch active = passport status is "suspended" or "revoked".
 * Kill switch inactive = passport status is "active".
 *
 * Never throws. SERVER ONLY.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { AportConfig } from './config'

export type KillSwitchState = {
  /** Whether the kill switch is currently active (passport suspended/revoked) */
  active: boolean
  /** The passport status string */
  passportStatus?: string
  /** The resolved file path (local) or API URL (hosted) — for display */
  path: string
  /** Which mode is in use */
  mode?: 'local' | 'api' | 'hosted'
}

// ─── Local mode ────────────────────────────────────────────────────────────────

/**
 * Read the current kill-switch state from the local passport file.
 * Passport status is the single source of truth — no separate sentinel file.
 */
export function readKillSwitch(passportFile: string): KillSwitchState {
  try {
    if (!existsSync(passportFile)) {
      return { active: false, path: passportFile, mode: 'local' }
    }
    const raw = readFileSync(passportFile, 'utf8')
    const data = JSON.parse(raw)
    const status = typeof data?.status === 'string' ? data.status : 'active'
    return {
      active: status !== 'active',
      passportStatus: status,
      path: passportFile,
      mode: 'local',
    }
  } catch {
    // Fail-closed: if we can't read the passport, treat as active (blocked)
    return { active: true, passportStatus: 'unknown', path: passportFile, mode: 'local' }
  }
}

/**
 * Activate the kill switch by setting passport status to "suspended".
 * This is the official OAP approach — mutate passport.json directly.
 */
export function activateKillSwitch(passportFile: string): KillSwitchState {
  try {
    if (!existsSync(passportFile)) {
      return { active: false, path: passportFile, mode: 'local' }
    }
    const raw = readFileSync(passportFile, 'utf8')
    const data = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) {
      return { active: false, path: passportFile, mode: 'local' }
    }
    data.status = 'suspended'
    writeFileSync(passportFile, JSON.stringify(data, null, 2) + '\n', 'utf8')
  } catch (err) {
    process.stderr.write(`[aport] failed to activate kill switch: ${err}\n`)
  }
  return readKillSwitch(passportFile)
}

/**
 * Deactivate the kill switch by setting passport status to "active".
 */
export function deactivateKillSwitch(passportFile: string): KillSwitchState {
  try {
    if (!existsSync(passportFile)) {
      return { active: false, path: passportFile, mode: 'local' }
    }
    const raw = readFileSync(passportFile, 'utf8')
    const data = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) {
      return { active: false, path: passportFile, mode: 'local' }
    }
    data.status = 'active'
    writeFileSync(passportFile, JSON.stringify(data, null, 2) + '\n', 'utf8')
  } catch (err) {
    process.stderr.write(`[aport] failed to deactivate kill switch: ${err}\n`)
  }
  return readKillSwitch(passportFile)
}

// ─── Hosted mode ───────────────────────────────────────────────────────────────

/**
 * Read the kill switch state from the APort hosted API.
 * In hosted mode, "kill switch active" means the passport status is "suspended".
 * Fail-closed: if API unreachable, treat as active (blocked).
 */
export async function readKillSwitchHosted(config: AportConfig): Promise<KillSwitchState> {
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
      // Fail-closed: can't confirm status → treat as blocked
      return { active: true, passportStatus: 'unknown', path: url, mode: 'hosted' }
    }

    const data = await res.json()
    const status = typeof data?.status === 'string' ? data.status : 'unknown'
    return {
      active: status !== 'active',
      passportStatus: status,
      path: url,
      mode: 'hosted',
    }
  } catch {
    // Fail-closed: API unreachable → treat as blocked
    return { active: true, passportStatus: 'unreachable', path: url, mode: 'hosted' }
  }
}

/**
 * Toggle the kill switch via the APort hosted API.
 * Activate = suspend the passport. Deactivate = reactivate it.
 */
export async function toggleKillSwitchHosted(
  config: AportConfig,
  action: 'activate' | 'deactivate',
): Promise<KillSwitchState> {
  const { apiUrl, apiKey, agentId } = config
  const endpoint = action === 'activate'
    ? `${apiUrl}/v1/agents/${agentId}/suspend`
    : `${apiUrl}/v1/agents/${agentId}/reactivate`

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }

    return readKillSwitchHosted(config)
  } catch (err) {
    throw new Error(
      `Failed to ${action} kill switch via APort API: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
