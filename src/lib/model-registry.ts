/**
 * Model Registry — single service for resolving available models and per-app model selection.
 *
 * Works across all deployment types:
 *   - OpenClaw: reads ~/.openclaw/openclaw.json for providers + models
 *   - BYOK: single model from MYWAY_AI_MODEL (or provider default)
 *   - Hosted: reads models config file at MYWAY_MODELS_CONFIG or ~/.myway/models.json
 *
 * Per-app model selection:
 *   1. App declares optional `provider` + `model` (e.g. "gemini" + "gemini-2.5-flash")
 *   2. Registry resolves to the actual provider config (baseUrl, apiKey)
 *   3. Falls back to DEFAULT_PROVIDER/DEFAULT_MODEL env vars, then system default
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getAIConfig, type AIMode } from './ai-config'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModelClass = 'creative' | 'fast' | 'smart'

export type ModelInfo = {
  id: string
  name?: string
  provider: string
  contextWindow?: number
  maxTokens?: number
}

export type ProviderConfig = {
  id: string
  baseUrl: string
  apiKey: string
  api?: string
  models: ModelInfo[]
}

export type ResolvedModel = {
  model: string
  baseUrl: string
  token: string
}

// ─── OpenClaw config reader (cached) ──────────────────────────────────────────

type OpenClawConfig = {
  models?: {
    providers?: Record<string, {
      baseUrl: string
      apiKey: string
      api?: string
      models: { id: string; name?: string; contextWindow?: number; maxTokens?: number }[]
    }>
  }
  env?: Record<string, string>
  agents?: { defaults?: { model?: { primary?: string } } }
}

let _configCache: { data: OpenClawConfig | null; checkedAt: number } | null = null
const CONFIG_CACHE_TTL = 300_000 // 5 minutes

function readOpenClawConfig(): OpenClawConfig | null {
  const now = Date.now()
  if (_configCache && (now - _configCache.checkedAt) < CONFIG_CACHE_TTL) {
    return _configCache.data
  }

  let data: OpenClawConfig | null = null
  try {
    const configPath = join(homedir(), '.openclaw', 'openclaw.json')
    if (existsSync(configPath)) {
      data = JSON.parse(readFileSync(configPath, 'utf-8'))
    }
  } catch { /* config not available */ }

  _configCache = { data, checkedAt: now }
  return data
}

/** Resolve ${VAR} references in OpenClaw config values using the env block. */
function resolveEnvRef(value: string, env: Record<string, string>): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key) => env[key] || process.env[key] || '')
}

// ─── Models config reader (hosted/custom) ─────────────────────────────────────

type ModelsConfig = {
  providers?: Record<string, {
    baseUrl: string
    apiKey: string
    models: { id: string; name?: string }[]
  }>
}

let _modelsConfigCache: { data: ModelsConfig | null; checkedAt: number } | null = null

function readModelsConfig(): ModelsConfig | null {
  const now = Date.now()
  if (_modelsConfigCache && (now - _modelsConfigCache.checkedAt) < CONFIG_CACHE_TTL) {
    return _modelsConfigCache.data
  }

  let data: ModelsConfig | null = null
  try {
    const configPath = process.env.MYWAY_MODELS_CONFIG?.trim()
      || join(homedir(), '.myway', 'models.json')
    if (existsSync(configPath)) {
      data = JSON.parse(readFileSync(configPath, 'utf-8'))
    }
  } catch { /* config not available */ }

  _modelsConfigCache = { data, checkedAt: now }
  return data
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get all available providers + models for the current deployment type.
 */
export function getAvailableModels(): ProviderConfig[] {
  const aiConfig = getAIConfig()

  if (aiConfig.mode === 'openclaw') {
    return getOpenClawModels()
  }

  // BYOK or hosted — check models.json first, fall back to single model
  const modelsConfig = readModelsConfig()
  if (modelsConfig?.providers) {
    return Object.entries(modelsConfig.providers).map(([id, p]) => ({
      id,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      models: p.models.map(m => ({ ...m, provider: id })),
    }))
  }

  // Single-model BYOK fallback
  const modelId = aiConfig.model || 'default'
  return [{
    id: 'byok',
    baseUrl: aiConfig.baseUrl,
    apiKey: aiConfig.token,
    models: [{ id: modelId, provider: 'byok', name: modelId }],
  }]
}

function getOpenClawModels(): ProviderConfig[] {
  const config = readOpenClawConfig()
  if (!config?.models?.providers) return []

  const env = config.env || {}
  return Object.entries(config.models.providers).map(([id, p]) => ({
    id,
    baseUrl: resolveEnvRef(p.baseUrl, env),
    apiKey: resolveEnvRef(p.apiKey, env),
    api: p.api,
    models: p.models.map(m => ({
      id: m.id,
      name: m.name,
      provider: id,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    })),
  }))
}

/**
 * Resolve the model + connection details for a specific app.
 *
 * Resolution order:
 *   1. App-level provider/model (if set and available)
 *   2. DEFAULT_MODEL / DEFAULT_PROVIDER env vars
 *   3. System default (OpenClaw primary model, or BYOK model)
 *
 * For OpenClaw mode, returns the provider's direct baseUrl + apiKey so
 * the request goes straight to the provider, bypassing the gateway's
 * model choice. If the requested provider isn't available, falls back
 * to the gateway.
 */
/**
 * Built-in model class defaults. Used when modelClass is set but no explicit
 * provider/model and no env defaults. These are known-good models that balance
 * quality and cost for each class.
 */
const MODEL_CLASS_DEFAULTS: Record<ModelClass, { provider: string; model: string }> = {
  creative: { provider: 'anthropic', model: 'anthropic/claude-3.5-haiku' },
  fast: { provider: 'gemini', model: 'gemini-3-flash-preview' },
  smart: { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
}

export function resolveModelForApp(appProvider?: string, appModel?: string, modelClass?: ModelClass): ResolvedModel {
  const aiConfig = getAIConfig()

  // Check env-level defaults
  const defaultProvider = process.env.MYWAY_DEFAULT_PROVIDER?.trim()
  const defaultModel = process.env.MYWAY_DEFAULT_MODEL?.trim()

  const targetProvider = appProvider || defaultProvider
  const targetModel = appModel || defaultModel

  // If no specific model requested, check modelClass for a smart default
  if (!targetProvider && !targetModel) {
    if (modelClass) {
      const classDefault = MODEL_CLASS_DEFAULTS[modelClass]
      // Only use class defaults if the provider is actually available
      const providers = getAvailableModels()
      const provider = providers.find(p => p.id === classDefault.provider)
      if (provider) {
        const model = provider.models.find(m => m.id === classDefault.model)
        if (model) {
          return {
            model: model.id,
            baseUrl: provider.baseUrl.replace(/\/$/, ''),
            token: provider.apiKey,
          }
        }
      }
      // Class default provider not available — fall through to base config
    }

    return {
      model: aiConfig.model || '',
      baseUrl: aiConfig.baseUrl,
      token: aiConfig.token,
    }
  }

  // Try to find the provider in available models
  if (targetProvider) {
    const providers = getAvailableModels()
    const provider = providers.find(p => p.id === targetProvider)

    if (provider) {
      // Use specific model from this provider, or first available
      const model = targetModel
        ? provider.models.find(m => m.id === targetModel)?.id || targetModel
        : provider.models[0]?.id || ''

      return {
        model,
        baseUrl: provider.baseUrl.replace(/\/$/, ''),
        token: provider.apiKey,
      }
    }
  }

  // Provider not found — try to use model name with default backend
  // (works when the gateway supports model routing, e.g. OpenClaw with "gemini/gemini-2.5-flash")
  if (targetModel) {
    const fullModelId = targetProvider ? `${targetProvider}/${targetModel}` : targetModel
    return {
      model: fullModelId,
      baseUrl: aiConfig.baseUrl,
      token: aiConfig.token,
    }
  }

  // Final fallback: base config
  return {
    model: aiConfig.model || '',
    baseUrl: aiConfig.baseUrl,
    token: aiConfig.token,
  }
}

/** Reset caches — useful for testing. */
export function _resetModelRegistryCache(): void {
  _configCache = null
  _modelsConfigCache = null
}
