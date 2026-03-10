/**
 * Token usage tracking — extract usage from SSE completions and persist.
 *
 * Works with all 3 deployment modes:
 *   - Hosted (AppRoom SSO): per-tenant DB isolation
 *   - OpenClaw: default DB
 *   - BYOK: default DB
 *
 * The SSE stream from OpenAI-compatible APIs includes a `usage` object
 * in the final chunk. We parse it and insert into the `token_usage` table.
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Database } from 'better-sqlite3'
import { estimateCost } from './model-pricing'

// ─── OpenClaw model resolution ─────────────────────────────────────────────
// OpenClaw gateway returns "openclaw" as the model name in SSE streams.
// We resolve the actual model from ~/.openclaw/openclaw.json config.

let _openclawModelCache: { model: string | null; checkedAt: number } | null = null
const OPENCLAW_CACHE_TTL = 300_000 // 5 minutes

/**
 * Read the primary model from OpenClaw's config file.
 * Cached for 5 minutes to avoid repeated disk reads.
 */
export function resolveOpenClawModel(): string | null {
  const now = Date.now()
  if (_openclawModelCache && (now - _openclawModelCache.checkedAt) < OPENCLAW_CACHE_TTL) {
    return _openclawModelCache.model
  }

  let model: string | null = null
  try {
    const configPath = join(homedir(), '.openclaw', 'openclaw.json')
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      // Primary model: agents.defaults.model.primary (e.g. "anthropic/claude-sonnet-4-6")
      model = config?.agents?.defaults?.model?.primary ?? null
    }
  } catch { /* config not available */ }

  _openclawModelCache = { model, checkedAt: now }
  return model
}

/** Reset cache — useful for testing. */
export function _resetOpenClawModelCache(): void {
  _openclawModelCache = null
}

export interface TokenUsageRecord {
  appId: string
  model: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number
}

/**
 * Extract token usage from accumulated SSE text.
 *
 * Supports multiple SSE formats:
 *  1. OpenAI: `usage` object in the final chunk (requires stream_options.include_usage)
 *  2. Anthropic (via OpenAI-compat proxy): `x_anthropic` or `usage` in message_delta
 *  3. Fallback: estimate tokens from streamed content (~4 chars per token)
 */
export function extractUsageFromSSE(sseText: string): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
  const lines = sseText.split('\n')

  // Pass 1: Look for explicit usage object (OpenAI format or proxy-injected)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.startsWith('data: ')) continue
    const raw = line.slice(6).trim()
    if (raw === '[DONE]') continue
    try {
      const parsed = JSON.parse(raw)
      // Anthropic native format (message_delta with usage) — check BEFORE generic
      // usage check because both have `parsed.usage` but with different field names.
      if (parsed.type === 'message_delta' && parsed.usage) {
        return {
          promptTokens: parsed.usage.input_tokens ?? 0,
          completionTokens: parsed.usage.output_tokens ?? 0,
          totalTokens: (parsed.usage.input_tokens ?? 0) + (parsed.usage.output_tokens ?? 0),
        }
      }
      // OpenAI format
      if (parsed.usage) {
        return {
          promptTokens: parsed.usage.prompt_tokens ?? 0,
          completionTokens: parsed.usage.completion_tokens ?? 0,
          totalTokens: parsed.usage.total_tokens ?? (parsed.usage.prompt_tokens ?? 0) + (parsed.usage.completion_tokens ?? 0),
        }
      }
      // Anthropic message_start has input token count
      if (parsed.type === 'message_start' && parsed.message?.usage) {
        // We'll keep scanning for message_delta which has the final output count
        continue
      }
    } catch { /* not JSON */ }
  }

  // Pass 2: Fallback — estimate from streamed content deltas
  // This ensures tracking works even when the gateway doesn't report usage
  let completionChars = 0
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const raw = line.slice(6).trim()
    if (raw === '[DONE]') continue
    try {
      const parsed = JSON.parse(raw)
      // OpenAI-compat format
      const delta = parsed.choices?.[0]?.delta?.content
      if (delta) completionChars += delta.length
      // Anthropic native format
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        completionChars += parsed.delta.text.length
      }
    } catch { /* not JSON */ }
  }

  if (completionChars > 0) {
    // Rough estimate: ~4 chars per token for English text
    const estCompletion = Math.ceil(completionChars / 4)
    return {
      promptTokens: 0,  // Can't estimate prompt tokens from SSE
      completionTokens: estCompletion,
      totalTokens: estCompletion,
    }
  }

  return null
}

/**
 * Record token usage in the database.
 */
export function recordTokenUsage(db: Database, record: TokenUsageRecord): void {
  try {
    db.prepare(`
      INSERT INTO token_usage (app_id, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      record.appId,
      record.model,
      record.promptTokens,
      record.completionTokens,
      record.totalTokens,
      record.estimatedCostUsd,
    )
  } catch {
    // Non-critical — don't break the response if tracking fails
    console.warn('[token-tracking] Failed to record usage')
  }
}

/**
 * Extract the model name from SSE stream data.
 * OpenAI-compat APIs include `model` in every chunk.
 */
export function extractModelFromSSE(sseText: string): string | null {
  for (const line of sseText.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const raw = line.slice(6).trim()
    if (raw === '[DONE]') continue
    try {
      const parsed = JSON.parse(raw)
      if (parsed.model) return parsed.model
    } catch { /* not JSON */ }
  }
  return null
}

/**
 * Resolve the actual model name from what we know.
 *
 * Priority:
 *  1. Explicit model from MYWAY_AI_MODEL env var (BYOK mode)
 *  2. Model name from SSE stream (gateway echoes it back)
 *  3. If SSE says "openclaw", resolve via ~/.openclaw/openclaw.json config
 *
 * This ensures we get the real model (e.g. "anthropic/claude-sonnet-4-6")
 * instead of the opaque "openclaw" proxy name.
 */
export function resolveModelName(configModel: string | null, sseText: string): string | null {
  if (configModel) return configModel

  const sseModel = extractModelFromSSE(sseText)
  if (!sseModel) return null

  // OpenClaw gateway returns "openclaw" as model name — resolve to real model
  if (sseModel === 'openclaw') {
    return resolveOpenClawModel() ?? sseModel
  }

  return sseModel
}

/**
 * Convenience: extract usage from SSE and record it.
 * Called from the chat route's flush() callback.
 */
export function trackUsageFromSSE(
  db: Database,
  appId: string,
  model: string | null,
  sseText: string,
): { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCost: number } | null {
  const usage = extractUsageFromSSE(sseText)
  if (!usage) return null

  const resolvedModel = resolveModelName(model, sseText)
  const cost = resolvedModel ? estimateCost(resolvedModel, usage.promptTokens, usage.completionTokens) : 0

  recordTokenUsage(db, {
    appId,
    model: resolvedModel,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd: cost,
  })

  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    estimatedCost: cost,
  }
}

// ── Query helpers (for API endpoints) ──────────────────────────────────────

export interface UsageSummary {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  totalCost: number
  requestCount: number
  byApp: { appId: string; tokens: number; cost: number; count: number }[]
  byModel: { model: string; tokens: number; cost: number; count: number }[]
  byDay: { date: string; tokens: number; cost: number; count: number }[]
}

export function getUsageSummary(db: Database, days: number = 30): UsageSummary {
  const since = Math.floor(Date.now() / 1000) - days * 86400

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(estimated_cost_usd), 0) as total_cost,
      COUNT(*) as request_count
    FROM token_usage WHERE created_at >= ?
  `).get(since) as Record<string, number>

  const byApp = db.prepare(`
    SELECT app_id, SUM(total_tokens) as tokens, SUM(estimated_cost_usd) as cost, COUNT(*) as count
    FROM token_usage WHERE created_at >= ?
    GROUP BY app_id ORDER BY cost DESC
  `).all(since) as { app_id: string; tokens: number; cost: number; count: number }[]

  const byModel = db.prepare(`
    SELECT COALESCE(model, 'unknown') as model, SUM(total_tokens) as tokens, SUM(estimated_cost_usd) as cost, COUNT(*) as count
    FROM token_usage WHERE created_at >= ?
    GROUP BY model ORDER BY cost DESC
  `).all(since) as { model: string; tokens: number; cost: number; count: number }[]

  const byDay = db.prepare(`
    SELECT date(created_at, 'unixepoch') as date, SUM(total_tokens) as tokens, SUM(estimated_cost_usd) as cost, COUNT(*) as count
    FROM token_usage WHERE created_at >= ?
    GROUP BY date ORDER BY date ASC
  `).all(since) as { date: string; tokens: number; cost: number; count: number }[]

  return {
    totalTokens: totals.total_tokens,
    promptTokens: totals.prompt_tokens,
    completionTokens: totals.completion_tokens,
    totalCost: totals.total_cost,
    requestCount: totals.request_count,
    byApp: byApp.map(r => ({ appId: r.app_id, tokens: r.tokens, cost: r.cost, count: r.count })),
    byModel: byModel.map(r => ({ model: r.model, tokens: r.tokens, cost: r.cost, count: r.count })),
    byDay,
  }
}
