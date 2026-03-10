/**
 * Tests for AppRoom API client — checkQuota, trackOutcome, reportUsage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Must mock before import
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { checkQuota, trackOutcome, reportUsage, isConfigured } from '@/lib/approom/client'

function mockResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

describe('AppRoom client', () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MYWAY_APPROOM_URL = 'https://approom.test'
    process.env.MYWAY_PARTNER_APPROOM_SECRET = 'a'.repeat(64)
  })

  afterEach(() => {
    process.env = { ...origEnv }
  })

  describe('isConfigured', () => {
    it('returns true when both env vars set', () => {
      expect(isConfigured()).toBe(true)
    })

    it('returns false when URL missing', () => {
      delete process.env.MYWAY_APPROOM_URL
      expect(isConfigured()).toBe(false)
    })

    it('returns false when secret missing', () => {
      delete process.env.MYWAY_PARTNER_APPROOM_SECRET
      expect(isConfigured()).toBe(false)
    })
  })

  describe('checkQuota', () => {
    it('returns allowed:true when not configured', async () => {
      delete process.env.MYWAY_APPROOM_URL
      const result = await checkQuota('user1', 'app1', 'draft-email')
      expect(result.allowed).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('calls AppRoom check-quota and returns result', async () => {
      fetchMock.mockResolvedValue(mockResponse(200, {
        allowed: true,
        remaining: 15,
      }))

      const result = await checkQuota('user1', 'app1', 'draft-email')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(15)

      expect(fetchMock).toHaveBeenCalledWith(
        'https://approom.test/api/outcomes/check-quota',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Myway-Signature': expect.any(String),
          }),
        }),
      )
    })

    it('returns addon options when quota exceeded', async () => {
      fetchMock.mockResolvedValue(mockResponse(200, {
        allowed: false,
        remaining: 0,
        addon_options: [{ quantity: 10, price_usd: 4.99 }],
      }))

      const result = await checkQuota('user1', 'app1', 'draft-email')
      expect(result.allowed).toBe(false)
      expect(result.addonOptions).toEqual([{ quantity: 10, priceUsd: 4.99 }])
    })

    it('fails closed on network error (paid apps cost real money)', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'))
      const result = await checkQuota('user1', 'app1', 'draft-email')
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('fails closed on AppRoom non-200 response', async () => {
      fetchMock.mockResolvedValue(mockResponse(500, { error: 'Internal error' }))
      const result = await checkQuota('user1', 'app1', 'draft-email')
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })
  })

  describe('trackOutcome', () => {
    it('returns success when not configured', async () => {
      delete process.env.MYWAY_APPROOM_URL
      const result = await trackOutcome({
        userId: 'user1',
        appId: 'app1',
        outcomeId: 'draft-email',
        tokenUsage: { input: 100, output: 200, total: 300, cost: 0.01 },
        status: 'completed',
      })
      expect(result.success).toBe(true)
    })

    it('posts outcome data to AppRoom', async () => {
      fetchMock.mockResolvedValue(mockResponse(200, { remaining: 14 }))

      const result = await trackOutcome({
        userId: 'user1',
        appId: 'app1',
        outcomeId: 'draft-email',
        tokenUsage: { input: 100, output: 200, total: 300, cost: 0.01 },
        durationMs: 2500,
        status: 'completed',
      })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(14)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://approom.test/api/outcomes/track',
        expect.any(Object),
      )
    })

    it('handles API failure gracefully', async () => {
      fetchMock.mockResolvedValue(mockResponse(500, { error: 'internal' }))
      const result = await trackOutcome({
        userId: 'user1',
        appId: 'app1',
        outcomeId: 'draft-email',
        tokenUsage: { input: 100, output: 200, total: 300, cost: 0.01 },
        status: 'completed',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('reportUsage', () => {
    it('returns success when not configured', async () => {
      delete process.env.MYWAY_APPROOM_URL
      const result = await reportUsage([])
      expect(result.success).toBe(true)
    })

    it('skips when entries are empty', async () => {
      const result = await reportUsage([])
      expect(result.success).toBe(true)
      expect(result.accepted).toBe(0)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('sends usage report to AppRoom', async () => {
      fetchMock.mockResolvedValue(mockResponse(200, { accepted: 1 }))

      const result = await reportUsage([{
        userId: 'user1',
        promptTokens: 500,
        completionTokens: 300,
        estimatedCostUsd: 0.025,
        models: ['gpt-4o'],
        periodStart: '2026-03-01',
        periodEnd: '2026-03-05',
      }])

      expect(result.success).toBe(true)
      expect(result.accepted).toBe(1)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://approom.test/api/usage/report',
        expect.any(Object),
      )
    })
  })

  describe('HMAC signing', () => {
    it('includes X-Myway-Signature header', async () => {
      fetchMock.mockResolvedValue(mockResponse(200, { allowed: true, remaining: 5 }))
      await checkQuota('user1', 'app1', 'draft-email')

      const [, options] = fetchMock.mock.calls[0]
      expect(options.headers['X-Myway-Signature']).toBeDefined()
      expect(options.headers['X-Myway-Signature']).toHaveLength(64) // SHA-256 hex
    })
  })
})
