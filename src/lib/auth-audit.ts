/**
 * Auth Audit Trail — logs all authentication events to a file.
 *
 * Events are append-only, one JSON line per event, written to:
 *   $MYWAY_DATA_DIR/auth-audit.log
 *
 * Format: JSON Lines (one object per line) for easy processing.
 * Each entry includes: timestamp, event type, userId, IP, outcome, metadata.
 */

import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export type AuthEvent =
  | 'login_success'
  | 'login_failed'
  | 'token_replay_blocked'
  | 'token_expired'
  | 'token_invalid'
  | 'code_exchange_failed'
  | 'code_exchange_error'
  | 'csrf_mismatch'
  | 'subdomain_mismatch'
  | 'session_validated'
  | 'session_expired'
  | 'session_invalid'
  | 'rate_limited'
  | 'access_denied'
  | 'admin_access'
  | 'addon_checkout'
  | 'plan_upgrade_checkout'
  | 'settings_changed'

interface AuditEntry {
  ts: string
  event: AuthEvent
  userId?: string
  ip?: string
  hostname?: string
  subdomain?: string
  partnerId?: string
  detail?: string
}

function getAuditLogPath(): string {
  const dataDir = process.env.MYWAY_DATA_DIR ?? join(homedir(), '.myway', 'data')
  mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'auth-audit.log')
}

/**
 * Append an auth event to the audit log.
 * Non-blocking best-effort — never throws (auth should not break on log failure).
 */
export function logAuthEvent(entry: Omit<AuditEntry, 'ts'>): void {
  try {
    const record: AuditEntry = {
      ts: new Date().toISOString(),
      ...entry,
    }
    appendFileSync(getAuditLogPath(), JSON.stringify(record) + '\n')
  } catch {
    // Best-effort — do not let logging failures break auth
    console.error('[auth-audit] Failed to write audit log entry')
  }
}
