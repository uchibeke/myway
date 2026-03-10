import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getAIConfig, isAIConfigured } from '@/lib/ai-config'

describe('getAIConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear all AI-related env vars
    delete process.env.MYWAY_AI_BASE_URL
    delete process.env.MYWAY_AI_TOKEN
    delete process.env.MYWAY_AI_MODEL
    delete process.env.OPENCLAW_BASE_URL
    delete process.env.OPENCLAW_GATEWAY_TOKEN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('defaults to openclaw mode with localhost base URL', () => {
    const config = getAIConfig()
    expect(config.mode).toBe('openclaw')
    expect(config.baseUrl).toBe('http://localhost:18789')
    expect(config.token).toBe('')
    expect(config.model).toBeUndefined()
  })

  it('uses OPENCLAW_* vars in openclaw mode', () => {
    process.env.OPENCLAW_BASE_URL = 'http://custom:8000'
    process.env.OPENCLAW_GATEWAY_TOKEN = 'oc-token-123'
    const config = getAIConfig()
    expect(config.mode).toBe('openclaw')
    expect(config.baseUrl).toBe('http://custom:8000')
    expect(config.token).toBe('oc-token-123')
  })

  it('switches to byok mode when MYWAY_AI_BASE_URL is set', () => {
    process.env.MYWAY_AI_BASE_URL = 'https://api.openai.com/v1'
    const config = getAIConfig()
    expect(config.mode).toBe('byok')
    expect(config.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('switches to byok mode when MYWAY_AI_TOKEN is set', () => {
    process.env.MYWAY_AI_TOKEN = 'sk-test'
    const config = getAIConfig()
    expect(config.mode).toBe('byok')
    expect(config.token).toBe('sk-test')
  })

  it('MYWAY_AI_* takes precedence over OPENCLAW_*', () => {
    process.env.OPENCLAW_BASE_URL = 'http://openclaw:18789'
    process.env.OPENCLAW_GATEWAY_TOKEN = 'oc-token'
    process.env.MYWAY_AI_BASE_URL = 'https://openrouter.ai/api/v1'
    process.env.MYWAY_AI_TOKEN = 'or-token'
    const config = getAIConfig()
    expect(config.mode).toBe('byok')
    expect(config.baseUrl).toBe('https://openrouter.ai/api/v1')
    expect(config.token).toBe('or-token')
  })

  it('strips trailing slash from base URL', () => {
    process.env.MYWAY_AI_BASE_URL = 'https://api.openai.com/v1/'
    const config = getAIConfig()
    expect(config.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('reads MYWAY_AI_MODEL', () => {
    process.env.MYWAY_AI_BASE_URL = 'http://localhost:11434/v1'
    process.env.MYWAY_AI_MODEL = 'llama3'
    const config = getAIConfig()
    expect(config.model).toBe('llama3')
  })

  it('falls back through env var chain: MYWAY_AI_* → OPENCLAW_* → defaults', () => {
    process.env.OPENCLAW_BASE_URL = 'http://openclaw:9000'
    process.env.OPENCLAW_GATEWAY_TOKEN = 'oc-fallback'
    // No MYWAY_AI_* set → should use OPENCLAW_* as fallback values
    const config = getAIConfig()
    expect(config.baseUrl).toBe('http://openclaw:9000')
    expect(config.token).toBe('oc-fallback')
  })
})

describe('isAIConfigured', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.MYWAY_AI_BASE_URL
    delete process.env.MYWAY_AI_TOKEN
    delete process.env.MYWAY_AI_MODEL
    delete process.env.OPENCLAW_BASE_URL
    delete process.env.OPENCLAW_GATEWAY_TOKEN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns false when nothing is configured (openclaw mode, no token)', () => {
    expect(isAIConfigured()).toBe(false)
  })

  it('returns true in openclaw mode with token', () => {
    process.env.OPENCLAW_GATEWAY_TOKEN = 'test-token'
    expect(isAIConfigured()).toBe(true)
  })

  it('returns true in byok mode with base URL only (Ollama)', () => {
    process.env.MYWAY_AI_BASE_URL = 'http://localhost:11434/v1'
    // No token — Ollama doesn't need one
    expect(isAIConfigured()).toBe(true)
  })

  it('returns true in byok mode with token only', () => {
    process.env.MYWAY_AI_TOKEN = 'sk-test'
    expect(isAIConfigured()).toBe(true)
  })

  it('returns true in byok mode with both base URL and token', () => {
    process.env.MYWAY_AI_BASE_URL = 'https://api.openai.com/v1'
    process.env.MYWAY_AI_TOKEN = 'sk-test'
    expect(isAIConfigured()).toBe(true)
  })
})
