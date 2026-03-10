/**
 * Tests for /api/plan/checkout endpoint.
 * Follows the same pattern as addon-checkout.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto')
  return {
    ...actual,
    createHmac: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn(() => 'mock-signature'),
    })),
  }
})

import { POST } from '@/app/api/plan/checkout/route'
import { NextRequest } from 'next/server'

const originalEnv = { ...process.env }

function createRequest(body: Record<string, unknown>, userId?: string): NextRequest {
  return new NextRequest(new URL('http://localhost/api/plan/checkout'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'x-myway-user-id': userId } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/plan/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    process.env = {
      ...originalEnv,
      MYWAY_APPROOM_URL: 'https://approom.ai',
      MYWAY_PARTNER_APPROOM_SECRET: 'test-secret',
      NEXT_PUBLIC_APP_URL: 'https://myway.local',
    }
  })

  it('rejects unauthenticated requests', async () => {
    const res = await POST(createRequest({}))
    expect(res.status).toBe(401)
  })

  it('returns 503 when AppRoom not configured', async () => {
    delete process.env.MYWAY_APPROOM_URL

    const res = await POST(createRequest({}, 'user-1'))
    expect(res.status).toBe(503)
  })

  it('proxies to AppRoom and returns checkout URL', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/plan-xxx' }),
    })

    const res = await POST(createRequest({}, 'user-1'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.checkoutUrl).toBe('https://checkout.stripe.com/plan-xxx')

    // Verify AppRoom was called with correct path
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://approom.ai/api/plan/checkout',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('passes userId and return URLs in payload', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/xxx' }),
    })

    await POST(createRequest({ annual: true }, 'user-42'))

    const callArgs = (globalThis.fetch as any).mock.calls[0]
    const sentBody = JSON.parse(callArgs[1].body)
    expect(sentBody.userId).toBe('user-42')
    expect(sentBody.annual).toBe(true)
    expect(sentBody.successUrl).toBe('https://myway.local/?plan=activated')
    expect(sentBody.cancelUrl).toBe('https://myway.local/?plan=cancelled')
  })

  it('sends HMAC signature header', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/xxx' }),
    })

    await POST(createRequest({}, 'user-1'))

    const callArgs = (globalThis.fetch as any).mock.calls[0]
    expect(callArgs[1].headers['X-Myway-Signature']).toBe('mock-signature')
  })

  it('returns 502 when AppRoom fails', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal server error',
    })

    const res = await POST(createRequest({}, 'user-1'))
    expect(res.status).toBe(502)
  })

  it('returns 502 when AppRoom returns no checkout URL', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })

    const res = await POST(createRequest({}, 'user-1'))
    expect(res.status).toBe(502)
  })

  it('returns 400 when user already on personal plan', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Already on Personal plan',
    })

    const res = await POST(createRequest({}, 'user-1'))
    expect(res.status).toBe(400)
  })
})
