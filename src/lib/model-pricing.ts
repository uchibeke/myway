/**
 * Model pricing registry — cost per 1M tokens (USD).
 *
 * Prices are loaded from `model-pricing.json` at the repo root.
 * To update prices, edit that file — no code changes needed.
 *
 * Override via MYWAY_MODEL_PRICING env var for custom/private models:
 *   MYWAY_MODEL_PRICING=my-model:0.50:2.00,another:1.00:5.00
 *
 * Falls back to $0 for unknown models (still tracks tokens, just no cost).
 */

import { readFileSync } from 'fs'
import { join } from 'path'

type ModelPricing = { input: number; output: number }

// ─── Build flat lookup from grouped config ──────────────────────────────────
// model-pricing.json is grouped by provider for readability.
// We flatten it into a lookup map with both bare and provider-prefixed keys.

let _configPricing: Record<string, ModelPricing> | null = null

function loadConfigPricing(): Record<string, ModelPricing> {
  if (_configPricing) return _configPricing

  _configPricing = {}
  try {
    const configPath = join(process.cwd(), 'model-pricing.json')
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
    for (const [provider, models] of Object.entries(raw)) {
      if (provider.startsWith('$')) continue // skip JSON schema fields
      for (const [model, pricing] of Object.entries(models as Record<string, ModelPricing>)) {
        // Register bare name (e.g. "claude-sonnet-4-6")
        _configPricing[model] = pricing
        // Register provider-prefixed name (e.g. "anthropic/claude-sonnet-4-6")
        _configPricing[`${provider}/${model}`] = pricing
      }
    }
  } catch {
    // Config file not found — use empty (env overrides or $0 fallback)
  }
  return _configPricing
}

// ─── Env overrides ──────────────────────────────────────────────────────────

let _envPricing: Record<string, ModelPricing> | null = null

function loadEnvPricing(): Record<string, ModelPricing> {
  if (_envPricing) return _envPricing
  _envPricing = {}
  const raw = process.env.MYWAY_MODEL_PRICING?.trim()
  if (!raw) return _envPricing

  for (const entry of raw.split(',')) {
    const [model, inputStr, outputStr] = entry.split(':')
    if (model && inputStr && outputStr) {
      _envPricing[model.trim()] = {
        input: parseFloat(inputStr),
        output: parseFloat(outputStr),
      }
    }
  }
  return _envPricing
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get pricing for a model. Resolution order:
 *   1. Exact match in env overrides
 *   2. Exact match in config file
 *   3. Normalized (strip provider prefix) match
 *   4. Longest prefix match (handles date-suffixed model names)
 *
 * Returns { input: 0, output: 0 } if truly unknown.
 */
export function getModelPricing(model: string): ModelPricing {
  const env = loadEnvPricing()
  const config = loadConfigPricing()

  // Exact match (env takes priority)
  if (env[model]) return env[model]
  if (config[model]) return config[model]

  // Normalize: strip provider prefix ('anthropic/', 'openai/', etc.)
  const normalized = model.includes('/') ? model.split('/').pop()! : model

  if (env[normalized]) return env[normalized]
  if (config[normalized]) return config[normalized]

  // Fuzzy: find the longest registry key that the model name starts with
  // e.g. 'claude-sonnet-4-5-20250514' matches 'claude-sonnet-4-5'
  const allKeys = [...Object.keys(env), ...Object.keys(config)]
  let bestMatch: string | null = null
  for (const key of allKeys) {
    if (normalized.startsWith(key) && (!bestMatch || key.length > bestMatch.length)) {
      bestMatch = key
    }
  }
  if (bestMatch) return env[bestMatch] || config[bestMatch]

  return { input: 0, output: 0 }
}

/** Estimate cost in USD for a given token count and model. */
export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = getModelPricing(model)
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000
}

/** Get all known model names (for UI display). */
export function getKnownModels(): string[] {
  const env = loadEnvPricing()
  const config = loadConfigPricing()
  return [...new Set([...Object.keys(config), ...Object.keys(env)])]
}

/** Reset caches — for testing. */
export function _resetPricingCaches(): void {
  _configPricing = null
  _envPricing = null
}
