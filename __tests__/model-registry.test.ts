import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolveModelForApp, getAvailableModels, _resetModelRegistryCache } from '@/lib/model-registry'

// Mock fs and os for controlled test environment
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
}))
vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock/home'),
}))

const { readFileSync, existsSync } = await import('fs')

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) process.env[k] = v
}
function clearEnv(...keys: string[]) {
  for (const k of keys) delete process.env[k]
}

describe('resolveModelForApp', () => {
  beforeEach(() => {
    _resetModelRegistryCache()
    clearEnv(
      'MYWAY_AI_BASE_URL', 'MYWAY_AI_TOKEN', 'MYWAY_AI_MODEL',
      'OPENCLAW_BASE_URL', 'OPENCLAW_GATEWAY_TOKEN',
      'MYWAY_DEFAULT_PROVIDER', 'MYWAY_DEFAULT_MODEL',
      'MYWAY_MODELS_CONFIG',
    )
    vi.mocked(existsSync).mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearEnv(
      'MYWAY_AI_BASE_URL', 'MYWAY_AI_TOKEN', 'MYWAY_AI_MODEL',
      'OPENCLAW_BASE_URL', 'OPENCLAW_GATEWAY_TOKEN',
      'MYWAY_DEFAULT_PROVIDER', 'MYWAY_DEFAULT_MODEL',
      'MYWAY_MODELS_CONFIG',
    )
  })

  it('returns base AI config when no provider/model/class specified', () => {
    setEnv({ OPENCLAW_BASE_URL: 'http://localhost:18789', OPENCLAW_GATEWAY_TOKEN: 'tok' })
    const result = resolveModelForApp()
    expect(result.baseUrl).toBe('http://localhost:18789')
    expect(result.token).toBe('tok')
    expect(result.model).toBe('')
  })

  it('returns BYOK config with explicit model', () => {
    setEnv({ MYWAY_AI_BASE_URL: 'https://api.openai.com/v1', MYWAY_AI_TOKEN: 'sk-test', MYWAY_AI_MODEL: 'gpt-4o' })
    const result = resolveModelForApp()
    expect(result.baseUrl).toBe('https://api.openai.com/v1')
    expect(result.model).toBe('gpt-4o')
  })

  it('uses MYWAY_DEFAULT_PROVIDER/MODEL env when no app-level override', () => {
    setEnv({
      OPENCLAW_BASE_URL: 'http://localhost:18789',
      OPENCLAW_GATEWAY_TOKEN: 'tok',
      MYWAY_DEFAULT_PROVIDER: 'openai',
      MYWAY_DEFAULT_MODEL: 'gpt-4o-mini',
    })
    // No openclaw config available, so provider lookup fails, falls back to gateway with model
    const result = resolveModelForApp()
    expect(result.model).toBe('openai/gpt-4o-mini')
  })

  it('app-level provider/model overrides env defaults', () => {
    setEnv({
      OPENCLAW_BASE_URL: 'http://localhost:18789',
      OPENCLAW_GATEWAY_TOKEN: 'tok',
      MYWAY_DEFAULT_PROVIDER: 'openai',
      MYWAY_DEFAULT_MODEL: 'gpt-4o-mini',
    })
    // App wants gemini — no provider config available, falls back to gateway with full model id
    const result = resolveModelForApp('gemini', 'gemini-2.5-flash')
    expect(result.model).toBe('gemini/gemini-2.5-flash')
    expect(result.baseUrl).toBe('http://localhost:18789')
  })

  it('resolves provider from OpenClaw config when available', () => {
    setEnv({ OPENCLAW_BASE_URL: 'http://localhost:18789', OPENCLAW_GATEWAY_TOKEN: 'tok' })

    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).includes('openclaw.json')
    )
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      env: { GEMINI_API_KEY: 'gem-key-123' },
      models: {
        providers: {
          gemini: {
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
            apiKey: '${GEMINI_API_KEY}',
            models: [
              { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
              { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
            ],
          },
        },
      },
    }))

    const result = resolveModelForApp('gemini', 'gemini-2.5-flash')
    expect(result.model).toBe('gemini-2.5-flash')
    expect(result.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
    expect(result.token).toBe('gem-key-123')
  })

  it('uses modelClass to pick default when provider is available', () => {
    setEnv({ OPENCLAW_BASE_URL: 'http://localhost:18789', OPENCLAW_GATEWAY_TOKEN: 'tok' })

    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).includes('openclaw.json')
    )
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      env: { GEMINI_API_KEY: 'gem-key' },
      models: {
        providers: {
          gemini: {
            baseUrl: 'https://gemini.api/v1',
            apiKey: '${GEMINI_API_KEY}',
            models: [{ id: 'gemini-3-flash-preview', name: 'Flash' }],
          },
        },
      },
    }))

    const result = resolveModelForApp(undefined, undefined, 'fast')
    expect(result.model).toBe('gemini-3-flash-preview')
    expect(result.baseUrl).toBe('https://gemini.api/v1')
    expect(result.token).toBe('gem-key')
  })

  it('falls back to base config when modelClass provider not available', () => {
    setEnv({ OPENCLAW_BASE_URL: 'http://gw:18789', OPENCLAW_GATEWAY_TOKEN: 'tok' })
    // No config file → no providers → class default can't resolve
    const result = resolveModelForApp(undefined, undefined, 'creative')
    expect(result.baseUrl).toBe('http://gw:18789')
    expect(result.token).toBe('tok')
  })

  it('uses first model from provider when no model specified', () => {
    setEnv({ OPENCLAW_BASE_URL: 'http://localhost:18789', OPENCLAW_GATEWAY_TOKEN: 'tok' })

    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).includes('openclaw.json')
    )
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      env: { KEY: 'k' },
      models: {
        providers: {
          anthropic: {
            baseUrl: 'https://api.anthropic.com/v1',
            apiKey: '${KEY}',
            models: [
              { id: 'claude-sonnet-4-6', name: 'Sonnet' },
              { id: 'claude-haiku-4-5-20251001', name: 'Haiku' },
            ],
          },
        },
      },
    }))

    // Provider specified but no model — should pick first
    const result = resolveModelForApp('anthropic')
    expect(result.model).toBe('claude-sonnet-4-6')
    expect(result.token).toBe('k')
  })

  it('falls back to gateway with model only when provider not specified', () => {
    setEnv({ OPENCLAW_BASE_URL: 'http://gw:18789', OPENCLAW_GATEWAY_TOKEN: 'tok' })
    // No provider, just model — should use base config with the model name
    const result = resolveModelForApp(undefined, 'custom-model')
    expect(result.model).toBe('custom-model')
    expect(result.baseUrl).toBe('http://gw:18789')
  })

  it('resolves env vars from process.env when not in config env block', () => {
    setEnv({
      OPENCLAW_BASE_URL: 'http://localhost:18789',
      OPENCLAW_GATEWAY_TOKEN: 'tok',
      MY_EXTERNAL_KEY: 'ext-key-val',
    })

    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).includes('openclaw.json')
    )
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      // No env block — should fall back to process.env
      models: {
        providers: {
          custom: {
            baseUrl: 'https://custom.api/v1',
            apiKey: '${MY_EXTERNAL_KEY}',
            models: [{ id: 'model-x' }],
          },
        },
      },
    }))

    const result = resolveModelForApp('custom', 'model-x')
    expect(result.token).toBe('ext-key-val')

    clearEnv('MY_EXTERNAL_KEY')
  })
})

describe('getAvailableModels', () => {
  beforeEach(() => {
    _resetModelRegistryCache()
    clearEnv('MYWAY_AI_BASE_URL', 'MYWAY_AI_TOKEN', 'MYWAY_AI_MODEL', 'OPENCLAW_BASE_URL', 'OPENCLAW_GATEWAY_TOKEN', 'MYWAY_MODELS_CONFIG')
    vi.mocked(existsSync).mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearEnv('MYWAY_AI_BASE_URL', 'MYWAY_AI_TOKEN', 'MYWAY_AI_MODEL', 'OPENCLAW_BASE_URL', 'OPENCLAW_GATEWAY_TOKEN', 'MYWAY_MODELS_CONFIG')
  })

  it('returns single BYOK model when no config files', () => {
    setEnv({ MYWAY_AI_BASE_URL: 'https://api.openai.com/v1', MYWAY_AI_TOKEN: 'sk-test', MYWAY_AI_MODEL: 'gpt-4o' })
    const models = getAvailableModels()
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('byok')
    expect(models[0].models[0].id).toBe('gpt-4o')
  })

  it('returns OpenClaw providers when config exists', () => {
    setEnv({ OPENCLAW_BASE_URL: 'http://localhost:18789', OPENCLAW_GATEWAY_TOKEN: 'tok' })

    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).includes('openclaw.json')
    )
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      env: { KEY1: 'val1' },
      models: {
        providers: {
          provA: {
            baseUrl: 'https://a.com',
            apiKey: '${KEY1}',
            models: [{ id: 'model-a' }, { id: 'model-b' }],
          },
          provB: {
            baseUrl: 'https://b.com',
            apiKey: 'direct-key',
            models: [{ id: 'model-c' }],
          },
        },
      },
    }))

    const models = getAvailableModels()
    expect(models).toHaveLength(2)
    expect(models[0].id).toBe('provA')
    expect(models[0].apiKey).toBe('val1')
    expect(models[0].models).toHaveLength(2)
    expect(models[1].id).toBe('provB')
    expect(models[1].apiKey).toBe('direct-key')
  })

  it('returns providers from models.json config in BYOK mode', () => {
    setEnv({
      MYWAY_AI_BASE_URL: 'https://api.openai.com/v1',
      MYWAY_AI_TOKEN: 'sk-test',
      MYWAY_MODELS_CONFIG: '/tmp/test-models.json',
    })

    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === '/tmp/test-models.json'
    )
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
        },
        anthropic: {
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'sk-ant-test',
          models: [{ id: 'claude-sonnet-4-6', name: 'Sonnet' }],
        },
      },
    }))

    const models = getAvailableModels()
    expect(models).toHaveLength(2)
    expect(models[0].id).toBe('openai')
    expect(models[1].id).toBe('anthropic')
    expect(models[1].models[0].id).toBe('claude-sonnet-4-6')
  })

  it('returns empty array when OpenClaw config has no providers', () => {
    setEnv({ OPENCLAW_BASE_URL: 'http://localhost:18789', OPENCLAW_GATEWAY_TOKEN: 'tok' })

    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).includes('openclaw.json')
    )
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      models: {},
    }))

    const models = getAvailableModels()
    expect(models).toHaveLength(0)
  })
})
