import { describe, it, expect, vi, afterEach } from 'vitest'
import { readPassport, readPassportAsync } from '@/lib/aport/passport-reader'
import type { AportConfig } from '@/lib/aport/config'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readPassport (sync wrapper)', () => {
  it('delegates to readLocalPassport', () => {
    const config: AportConfig = {
      mode: 'local',
      hosted: false,
      auditLog: '',
      decisionFile: '',
      openclawDir: '',
      passportFile: '/nonexistent/path/passport.json',
    }

    const result = readPassport(config)

    expect(result.configured).toBe(false)
    expect(result.mode).toBe('local')
  })
})

describe('readPassportAsync', () => {
  it('reads local passport for local mode', async () => {
    const config: AportConfig = {
      mode: 'local',
      hosted: false,
      auditLog: '',
      decisionFile: '',
      openclawDir: '',
      passportFile: '/nonexistent/passport.json',
    }

    const result = await readPassportAsync(config)

    expect(result.configured).toBe(false)
    expect(result.mode).toBe('local')
  })

  it('reads local passport for API mode without agentId', async () => {
    const config: AportConfig = {
      mode: 'api',
      hosted: false,
      auditLog: '',
      decisionFile: '',
      openclawDir: '',
      passportFile: '/nonexistent/passport.json',
    }

    const result = await readPassportAsync(config)

    expect(result.configured).toBe(false)
    expect(result.mode).toBe('api') // overridden from 'local' to 'api'
  })

  it('fetches hosted passport when hosted + agentId + apiKey', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        passport_id: 'hosted-123',
        owner_id: 'user@example.com',
        status: 'active',
        assurance_level: 'L2',
        spec_version: 'oap/1.0',
        kind: 'instance',
        capabilities: [{ id: 'repo.pr.create' }],
      }), { status: 200 })
    )

    const config: AportConfig = {
      mode: 'api',
      hosted: true,
      auditLog: '',
      decisionFile: '',
      openclawDir: '',
      passportFile: '',
      apiUrl: 'https://api.aport.io',
      apiKey: 'test-key',
      agentId: 'ap_test123',
    }

    const result = await readPassportAsync(config)

    expect(result.configured).toBe(true)
    expect(result.passportId).toBe('hosted-123')
    expect(result.mode).toBe('hosted')
    expect(result.assuranceLevel).toBe('L2')
    expect(result.capabilities).toHaveLength(1)
  })

  it('returns error for 404 from hosted API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404 })
    )

    const config: AportConfig = {
      mode: 'api',
      hosted: true,
      auditLog: '',
      decisionFile: '',
      openclawDir: '',
      passportFile: '',
      apiUrl: 'https://api.aport.io',
      apiKey: 'test-key',
      agentId: 'ap_missing',
    }

    const result = await readPassportAsync(config)

    expect(result.configured).toBe(false)
    expect(result.mode).toBe('hosted')
    expect(result.error).toContain('not found')
  })

  it('returns error for non-404 HTTP error from hosted API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Server Error', { status: 500 })
    )

    const config: AportConfig = {
      mode: 'api',
      hosted: true,
      auditLog: '',
      decisionFile: '',
      openclawDir: '',
      passportFile: '',
      apiUrl: 'https://api.aport.io',
      apiKey: 'test-key',
      agentId: 'ap_test',
    }

    const result = await readPassportAsync(config)

    expect(result.configured).toBe(true)
    expect(result.mode).toBe('hosted')
    expect(result.error).toContain('HTTP 500')
  })

  it('returns error for network failure from hosted API', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('DNS resolution failed'))

    const config: AportConfig = {
      mode: 'api',
      hosted: true,
      auditLog: '',
      decisionFile: '',
      openclawDir: '',
      passportFile: '',
      apiUrl: 'https://api.aport.io',
      apiKey: 'test-key',
      agentId: 'ap_test',
    }

    const result = await readPassportAsync(config)

    expect(result.configured).toBe(true)
    expect(result.mode).toBe('hosted')
    expect(result.error).toContain('DNS resolution failed')
  })
})
