/**
 * OpenClaw Webhook Client
 *
 * Myway → OpenClaw event bridge.
 *
 * OpenClaw exposes `POST /hooks/wake` for immediate agent wakes.
 * Call `notifyOpenClaw()` from any Myway event handler (task completed,
 * health threshold, new email from unknown contact, etc.) to push a
 * system event into the agent's main session — no CLI required.
 *
 * Architecture:
 *   Myway (Next.js) → POST /hooks/wake → OpenClaw Gateway → heartbeat fires NOW
 *
 * Docs: https://docs.openclaw.ai/automation/webhook
 */

const OPENCLAW_BASE_URL = process.env.OPENCLAW_BASE_URL ?? 'http://localhost:18789'
const OPENCLAW_HOOK_TOKEN = process.env.OPENCLAW_HOOK_TOKEN ?? ''

export type NotifyMode = 'now' | 'next-heartbeat'

export type NotifyResult =
  | { ok: true }
  | { ok: false; error: string; status?: number }

/**
 * Send a system event to OpenClaw and optionally trigger an immediate heartbeat.
 *
 * @param text  - Event description (e.g., "Task completed: Review quarterly report")
 * @param mode  - 'now' triggers heartbeat immediately (default). 'next-heartbeat' waits.
 *
 * @example
 * // Task completed — trigger immediate heartbeat
 * await notifyOpenClaw('Task completed: Review quarterly report', 'now')
 *
 * // Health alert — wake agent immediately
 * await notifyOpenClaw('Myway health alert: memory at 87%', 'now')
 *
 * // Non-urgent background update — queue for next heartbeat
 * await notifyOpenClaw('New recipe saved: Pasta Carbonara', 'next-heartbeat')
 */
export async function notifyOpenClaw(
  text: string,
  mode: NotifyMode = 'now',
): Promise<NotifyResult> {
  if (!OPENCLAW_HOOK_TOKEN) {
    return { ok: false, error: 'OPENCLAW_HOOK_TOKEN not configured' }
  }

  try {
    const res = await fetch(`${OPENCLAW_BASE_URL}/hooks/wake`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_HOOK_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, mode }),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[openclaw-webhook] Wake failed: ${res.status} ${body}`)
      return { ok: false, error: body || res.statusText, status: res.status }
    }

    console.log(`[openclaw-webhook] Notified (${mode}): ${text}`)
    return { ok: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[openclaw-webhook] Error: ${error}`)
    return { ok: false, error }
  }
}

/**
 * Convenience: fire-and-forget notify (swallows errors, safe to use anywhere).
 * Use when you don't care about the result — e.g., inside a route handler after
 * completing the primary operation.
 */
export function notifyOpenClawBackground(
  text: string,
  mode: NotifyMode = 'now',
): void {
  void notifyOpenClaw(text, mode).catch(() => {
    // Silently swallow — OpenClaw being down should never break Myway
  })
}
