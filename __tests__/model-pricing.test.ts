import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getModelPricing, estimateCost, getKnownModels, _resetPricingCaches } from '@/lib/model-pricing'

beforeEach(() => {
  _resetPricingCaches()
})

// ─── Config file loading ────────────────────────────────────────────────────

describe('config file loading', () => {
  it('loads pricing from model-pricing.json', () => {
    // claude-sonnet-4-6 is defined in model-pricing.json under "anthropic"
    const pricing = getModelPricing('claude-sonnet-4-6')
    expect(pricing.input).toBeGreaterThan(0)
    expect(pricing.output).toBeGreaterThan(0)
  })

  it('registers both bare and provider-prefixed keys', () => {
    const bare = getModelPricing('claude-sonnet-4-6')
    const prefixed = getModelPricing('anthropic/claude-sonnet-4-6')
    expect(bare).toEqual(prefixed)
  })

  it('includes all providers from config', () => {
    const models = getKnownModels()
    // Should have models from multiple providers
    expect(models.some(m => m.includes('claude'))).toBe(true)
    expect(models.some(m => m.includes('gpt'))).toBe(true)
    expect(models.some(m => m.includes('gemini'))).toBe(true)
    expect(models.some(m => m.includes('deepseek'))).toBe(true)
  })
})

// ─── Exact matches ──────────────────────────────────────────────────────────

describe('getModelPricing — exact matches', () => {
  it('returns correct pricing for Anthropic models', () => {
    expect(getModelPricing('claude-sonnet-4-6')).toEqual({ input: 3.00, output: 15.00 })
    expect(getModelPricing('claude-opus-4-6')).toEqual({ input: 15.00, output: 75.00 })
    expect(getModelPricing('claude-haiku-4-5')).toEqual({ input: 0.80, output: 4.00 })
  })

  it('returns correct pricing for OpenAI models', () => {
    expect(getModelPricing('gpt-4o').input).toBe(2.50)
    expect(getModelPricing('gpt-4o').output).toBe(10.00)
    expect(getModelPricing('gpt-4o-mini').input).toBe(0.15)
  })

  it('returns correct pricing for Google models', () => {
    expect(getModelPricing('gemini-2.0-flash').input).toBe(0.10)
    expect(getModelPricing('gemini-2.0-flash').output).toBe(0.40)
  })

  it('returns correct pricing for DeepSeek models', () => {
    expect(getModelPricing('deepseek-chat').input).toBe(0.27)
    expect(getModelPricing('deepseek-reasoner').input).toBe(0.55)
  })
})

// ─── Provider prefix stripping ──────────────────────────────────────────────

describe('getModelPricing — provider prefix stripping', () => {
  it('strips anthropic/ prefix', () => {
    const pricing = getModelPricing('anthropic/claude-sonnet-4-6')
    expect(pricing.input).toBe(3.00)
    expect(pricing.output).toBe(15.00)
  })

  it('strips openai/ prefix', () => {
    expect(getModelPricing('openai/gpt-4o').input).toBe(2.50)
  })

  it('strips google/ prefix for bare model names', () => {
    // google/gemini-2.0-flash is registered as provider-prefixed key
    expect(getModelPricing('google/gemini-2.0-flash').input).toBe(0.10)
  })

  it('strips deepseek/ prefix', () => {
    expect(getModelPricing('deepseek/deepseek-chat').input).toBe(0.27)
    expect(getModelPricing('deepseek/deepseek-reasoner').input).toBe(0.55)
  })

  it('strips meta/ prefix', () => {
    expect(getModelPricing('meta/llama-3.3-70b-instruct').input).toBe(0.40)
  })
})

// ─── Fuzzy prefix matching ──────────────────────────────────────────────────

describe('getModelPricing — fuzzy prefix matching', () => {
  it('matches claude model with date suffix', () => {
    const pricing = getModelPricing('claude-sonnet-4-6-20250514')
    expect(pricing.input).toBe(3.00)
    expect(pricing.output).toBe(15.00)
  })

  it('matches provider-prefixed model with date suffix', () => {
    const pricing = getModelPricing('anthropic/claude-sonnet-4-6-20250514')
    expect(pricing.input).toBe(3.00)
  })

  it('matches claude-haiku with date suffix', () => {
    const pricing = getModelPricing('claude-haiku-4-5-20251001')
    expect(pricing.input).toBe(0.80)
    expect(pricing.output).toBe(4.00)
  })

  it('matches claude-opus with date suffix', () => {
    expect(getModelPricing('anthropic/claude-opus-4-6-20260101').input).toBe(15.00)
  })

  it('matches gemini with extra suffix', () => {
    const pricing = getModelPricing('gemini-2.5-flash-preview-05-20-extra')
    expect(pricing.input).toBe(0.15)
  })

  it('picks longest prefix match', () => {
    // "claude-sonnet-4-6" is longer than "claude-sonnet-4-5"
    // so "claude-sonnet-4-6-xyz" should match "claude-sonnet-4-6"
    const pricing = getModelPricing('claude-sonnet-4-6-xyz')
    expect(pricing.input).toBe(3.00) // sonnet-4-6 pricing
  })
})

// ─── Env overrides ──────────────────────────────────────────────────────────

describe('getModelPricing — env overrides', () => {
  const originalEnv = process.env.MYWAY_MODEL_PRICING

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MYWAY_MODEL_PRICING
    else process.env.MYWAY_MODEL_PRICING = originalEnv
    _resetPricingCaches()
  })

  it('uses env pricing for custom models', () => {
    process.env.MYWAY_MODEL_PRICING = 'my-custom-model:1.50:7.50'
    _resetPricingCaches()

    const pricing = getModelPricing('my-custom-model')
    expect(pricing.input).toBe(1.50)
    expect(pricing.output).toBe(7.50)
  })

  it('env overrides config file pricing', () => {
    process.env.MYWAY_MODEL_PRICING = 'claude-sonnet-4-6:99.00:99.00'
    _resetPricingCaches()

    const pricing = getModelPricing('claude-sonnet-4-6')
    expect(pricing.input).toBe(99.00)
    expect(pricing.output).toBe(99.00)
  })

  it('supports multiple models in env var', () => {
    process.env.MYWAY_MODEL_PRICING = 'model-a:1.00:2.00,model-b:3.00:4.00'
    _resetPricingCaches()

    expect(getModelPricing('model-a')).toEqual({ input: 1.00, output: 2.00 })
    expect(getModelPricing('model-b')).toEqual({ input: 3.00, output: 4.00 })
  })

  it('skips malformed env entries', () => {
    process.env.MYWAY_MODEL_PRICING = 'good:1.00:2.00,bad-entry,also-bad:1.00'
    _resetPricingCaches()

    expect(getModelPricing('good')).toEqual({ input: 1.00, output: 2.00 })
    expect(getModelPricing('bad-entry')).toEqual({ input: 0, output: 0 })
  })
})

// ─── Unknown models ─────────────────────────────────────────────────────────

describe('getModelPricing — unknown models', () => {
  it('returns zero pricing for unknown model', () => {
    const pricing = getModelPricing('totally-unknown-model-xyz')
    expect(pricing.input).toBe(0)
    expect(pricing.output).toBe(0)
  })

  it('returns zero pricing for "openclaw" (opaque proxy name)', () => {
    const pricing = getModelPricing('openclaw')
    expect(pricing.input).toBe(0)
    expect(pricing.output).toBe(0)
  })

  it('returns zero pricing for empty string', () => {
    expect(getModelPricing('')).toEqual({ input: 0, output: 0 })
  })
})

// ─── estimateCost ───────────────────────────────────────────────────────────

describe('estimateCost', () => {
  it('calculates cost correctly for known model', () => {
    // claude-sonnet-4-6: input=$3/1M, output=$15/1M
    const cost = estimateCost('claude-sonnet-4-6', 1000, 500)
    // (1000 * 3 + 500 * 15) / 1_000_000 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 6)
  })

  it('returns 0 for unknown model', () => {
    expect(estimateCost('unknown-model', 1000, 500)).toBe(0)
  })

  it('handles zero tokens', () => {
    expect(estimateCost('gpt-4o', 0, 0)).toBe(0)
  })

  it('handles large token counts', () => {
    const cost = estimateCost('gpt-4o', 1_000_000, 500_000)
    expect(cost).toBeCloseTo(7.5, 2)
  })

  it('works with provider-prefixed model names', () => {
    const cost = estimateCost('anthropic/claude-sonnet-4-6', 1000, 500)
    expect(cost).toBeCloseTo(0.0105, 6)
  })

  it('works with date-suffixed model names', () => {
    const cost = estimateCost('claude-sonnet-4-6-20250514', 1000, 500)
    expect(cost).toBeCloseTo(0.0105, 6)
  })
})

// ─── getKnownModels ─────────────────────────────────────────────────────────

describe('getKnownModels', () => {
  it('returns array of model names', () => {
    const models = getKnownModels()
    expect(Array.isArray(models)).toBe(true)
    expect(models.length).toBeGreaterThan(0)
  })

  it('includes key models from each provider', () => {
    const models = getKnownModels()
    expect(models).toContain('claude-sonnet-4-6')
    expect(models).toContain('gpt-4o')
    expect(models).toContain('gemini-2.0-flash')
    expect(models).toContain('deepseek-chat')
  })

  it('includes provider-prefixed variants', () => {
    const models = getKnownModels()
    expect(models).toContain('anthropic/claude-sonnet-4-6')
    expect(models).toContain('openai/gpt-4o')
  })

  it('returns unique entries', () => {
    const models = getKnownModels()
    expect(new Set(models).size).toBe(models.length)
  })
})
