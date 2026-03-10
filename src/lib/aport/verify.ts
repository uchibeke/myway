/**
 * APort pre-action verification — checks policy before executing actions.
 *
 * Resolution chain for credentials:
 *   Hosted (multi-tenant): DB passport only. No fallback to env vars.
 *   Self-hosted:           DB passport → env vars (APORT_AGENT_ID + APORT_API_KEY)
 *   Not configured → skip verification (allow)
 *
 * Fail-closed: if API is unreachable or returns error, action is DENIED.
 *
 * SERVER ONLY.
 */

import { createHash } from 'crypto'
import type { Database } from 'better-sqlite3'
import { getAportConfig } from './config'
import { getPassportApiKey } from './passport-store'
import type { GuardrailEvent } from './audit-parser'

// ─── Types ──────────────────────────────────────────────────────────────────

export type VerifyContext = {
  /** The action being requested (e.g., 'email.send', 'calendar.create', 'system.command.execute') */
  action: string
  /** Free-form context about the action */
  context?: Record<string, unknown>
}

export type VerifyDecision = {
  allowed: boolean
  decisionId?: string
  policyId?: string
  reasons?: { code: string; message: string }[]
  /** Whether verification was skipped (no passport configured) */
  skipped?: boolean
}

// ─── Policy Pack Mapping ────────────────────────────────────────────────────
// Maps Myway action categories to APort policy pack IDs.
// When no specific policy exists, falls back to 'general.action.v1'.

const ACTION_TO_POLICY: Record<string, string> = {
  // Connection actions
  'email.send': 'communication.email.send.v1',
  'email.draft': 'communication.email.draft.v1',
  'calendar.create': 'scheduling.calendar.create.v1',
  'calendar.update': 'scheduling.calendar.update.v1',
  'calendar.respond': 'scheduling.calendar.respond.v1',
  // System actions
  'system.command.execute': 'system.command.execute.v1',
  'file.write': 'data.file.write.v1',
  'file.delete': 'data.file.delete.v1',
  // Telegram
  'telegram.send': 'communication.message.send.v1',
}

const DEFAULT_POLICY = 'general.action.v1'

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Verify an action against APort policy.
 *
 * @param db        - Tenant database (for DB-backed passports)
 * @param appId     - App requesting the action (for per-app passport resolution)
 * @param action    - The action being verified (e.g., 'email.send')
 * @param context   - Additional context about the action
 * @param isTenant  - true when called for a logged-in user. Prevents fallback to env vars.
 */
export async function verifyAction(
  db: Database,
  appId: string,
  action: string,
  context: Record<string, unknown> = {},
  isTenant: boolean = false,
): Promise<VerifyDecision> {
  // Resolve credentials: DB passport → (if anonymous) global env → not configured
  const creds = resolveCredentials(db, appId, isTenant)
  if (!creds) {
    return { allowed: true, skipped: true }
  }

  const config = getAportConfig()
  const apiUrl = config.apiUrl ?? 'https://api.aport.io'
  const policyPack = ACTION_TO_POLICY[action] ?? DEFAULT_POLICY

  try {
    const url = `${apiUrl}/api/verify/policy/${policyPack}`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': creds.apiKey,
      },
      body: JSON.stringify({
        passport: {
          agent_id: creds.agentId,
          passport_id: creds.agentId,
        },
        context: {
          action,
          app_id: appId,
          ...context,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      // Fail-closed: API error → DENY
      const text = await res.text().catch(() => '')
      console.error(`[aport-verify] API error ${res.status}: ${text.slice(0, 200)}`)
      return {
        allowed: false,
        reasons: [{
          code: 'oap.api_error',
          message: `APort API returned HTTP ${res.status}`,
        }],
      }
    }

    const body = await res.json() as {
      decision?: {
        decision_id?: string
        policy_id?: string
        allow?: boolean
        reasons?: { code: string; message: string }[]
      }
    }

    const decision = body.decision ?? (body as Record<string, unknown>)

    const result: VerifyDecision = {
      allowed: decision.allow === true,
      decisionId: decision.decision_id as string | undefined,
      policyId: decision.policy_id as string | undefined,
      reasons: decision.reasons as { code: string; message: string }[] | undefined,
    }

    // Record audit event (non-blocking)
    recordAuditEvent(db, {
      decisionId: result.decisionId,
      action,
      allowed: result.allowed,
      policy: policyPack,
      code: result.reasons?.[0]?.code ?? (result.allowed ? 'oap.allowed' : 'oap.denied'),
      context: JSON.stringify(context).slice(0, 500),
    })

    return result
  } catch (err) {
    // Fail-closed: network error → DENY
    console.error(`[aport-verify] Failed to reach APort API:`, err instanceof Error ? err.message : err)

    // Record the failure as an audit event
    recordAuditEvent(db, {
      action,
      allowed: false,
      policy: policyPack,
      code: 'oap.evaluation_error',
      context: JSON.stringify(context).slice(0, 500),
    })

    return {
      allowed: false,
      reasons: [{
        code: 'oap.evaluation_error',
        message: 'Policy evaluation failed. Fail-closed per OAP spec.',
      }],
    }
  }
}

// ─── Credential Resolution ──────────────────────────────────────────────────

function resolveCredentials(
  db: Database,
  appId: string,
  isTenant: boolean,
): { agentId: string; apiKey: string } | null {
  const config = getAportConfig()

  // 1. DB passport (per-user, per-app → falls back to 'default')
  try {
    const dbCreds = getPassportApiKey(db, appId)
    if (dbCreds) {
      const apiKey = dbCreds.apiKey ?? config.apiKey
      if (apiKey) return { agentId: dbCreds.agentId, apiKey }
      return null
    }
  } catch {
    // Table might not exist yet — fall through
  }

  // Logged-in user: DB passport is the only source. No env var fallback.
  if (isTenant) {
    return null
  }

  // 2. Anonymous / self-hosted: global env vars are the user's own credentials
  if (config.agentId && config.apiKey) {
    return { agentId: config.agentId, apiKey: config.apiKey }
  }

  // 3. Not configured
  return null
}

// ─── Audit Event Recording ─────────────────────────────────────────────────

type AuditInput = {
  decisionId?: string
  action: string
  allowed: boolean
  policy: string
  code: string
  context: string
}

/**
 * Write an audit event to the tenant DB and broadcast to SSE listeners.
 * Non-blocking — failures are logged but never propagated.
 */
function recordAuditEvent(db: Database, input: AuditInput): void {
  try {
    const now = Math.floor(Date.now() / 1000)
    const id = input.decisionId
      ?? `syn-${createHash('sha1').update(`${now}:${input.action}:${input.context.slice(0, 64)}`).digest('hex').slice(0, 12)}`

    const event: GuardrailEvent = {
      id,
      timestamp: now,
      tool: input.action,
      allowed: input.allowed,
      policy: input.policy,
      code: input.code,
      context: input.context,
    }

    // Persist to tenant DB
    db.prepare(
      `INSERT INTO guardrail_events (id, timestamp, tool, allowed, policy, code, context, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         allowed = excluded.allowed, policy = excluded.policy,
         code = excluded.code, context = excluded.context, synced_at = excluded.synced_at`,
    ).run(id, now, input.action, input.allowed ? 1 : 0, input.policy, input.code, input.context, now)

    // Broadcast to SSE listeners via the global tailer
    try {
      const { auditTailer } = require('./audit-tailer') as typeof import('./audit-tailer')
      auditTailer.emit('event', event)
    } catch { /* tailer not available — SSE won't get this event but DB has it */ }
  } catch (err) {
    console.error('[aport-verify] audit record failed:', err instanceof Error ? err.message : err)
  }
}
