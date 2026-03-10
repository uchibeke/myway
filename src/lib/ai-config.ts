/**
 * Centralized AI backend configuration.
 *
 * Supports two modes:
 *   - 'openclaw' — default, uses OpenClaw gateway (OPENCLAW_* env vars)
 *   - 'byok'     — Bring Your Own Key, any OpenAI-compatible provider
 *                   (MYWAY_AI_BASE_URL / MYWAY_AI_TOKEN / MYWAY_AI_MODEL)
 *
 * Ollama users: set MYWAY_AI_BASE_URL without a token — works fine.
 */

export type AIMode = 'openclaw' | 'byok'

export type AIConfig = {
  baseUrl: string
  token: string
  model: string | undefined
  mode: AIMode
}

/**
 * Derive the AI backend mode from environment variables.
 *
 * BYOK when MYWAY_AI_BASE_URL or MYWAY_AI_TOKEN is explicitly set.
 * OpenClaw otherwise (even if OPENCLAW_* vars are missing — that's just
 * an unconfigured install, not BYOK).
 */
function resolveMode(): AIMode {
  if (process.env.MYWAY_AI_BASE_URL || process.env.MYWAY_AI_TOKEN) {
    return 'byok'
  }
  return 'openclaw'
}

/**
 * Build the full AI config from env vars.
 */
export function getAIConfig(): AIConfig {
  const mode = resolveMode()

  const baseUrl = process.env.MYWAY_AI_BASE_URL
    ?? process.env.OPENCLAW_BASE_URL
    ?? 'http://localhost:18789'

  const token = process.env.MYWAY_AI_TOKEN
    ?? process.env.OPENCLAW_GATEWAY_TOKEN
    ?? ''

  const model = process.env.MYWAY_AI_MODEL ?? undefined

  return { baseUrl: baseUrl.replace(/\/$/, ''), token, model, mode }
}

/**
 * Returns true if there's enough config to make AI requests.
 *
 * - OpenClaw mode: needs a token (gateway always requires auth)
 * - BYOK mode: token OR base URL is sufficient (Ollama needs no token)
 */
/**
 * Build the full chat completions URL from a base URL.
 *
 * Base URLs vary by provider:
 *   - Bare host (OpenClaw): http://localhost:18789 → .../v1/chat/completions
 *   - With path (Gemini):   .../v1beta/openai      → .../v1beta/openai/chat/completions
 *   - With /v1 (Ollama):    .../v1                  → .../v1/chat/completions
 *
 * Rule: if pathname is just "/", prepend /v1. Otherwise append directly.
 */
export function chatCompletionsUrl(baseUrl: string): string {
  try {
    const u = new URL(baseUrl)
    const path = u.pathname.replace(/\/+$/, '')
    if (!path || path === '/') {
      u.pathname = '/v1/chat/completions'
    } else {
      u.pathname = `${path}/chat/completions`
    }
    return u.toString().replace(/\/+$/, '')
  } catch {
    // Malformed URL — best-effort fallback
    const clean = baseUrl.replace(/\/+$/, '')
    return `${clean}/chat/completions`
  }
}

export function isAIConfigured(): boolean {
  const { token, mode } = getAIConfig()
  if (mode === 'byok') {
    // BYOK: having a base URL alone is enough (Ollama)
    return true
  }
  // OpenClaw: must have a token
  return !!token
}
