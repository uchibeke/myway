/**
 * Tests for /api/addons/checkout endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock env
const originalEnv = { ...process.env }

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

import { POST } from '@/app/api/addons/checkout/route'
import { NextRequest } from 'next/server'

function createRequest(body: Record<string, unknown>, userId?: string): NextRequest {
  const req = new NextRequest(new URL('http://localhost/api/addons/checkout'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'x-myway-user-id': userId } : {}),
    },
    body: JSON.stringify(body),
  })
  return req
}

describe('POST /api/addons/checkout', () => {
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

  it('should reject unauthenticated requests', async () => {
    const res = await POST(createRequest({ appId: 'test', outcomeId: 'chat', quantity: 10 }))
    expect(res.status).toBe(401)
  })

  it('should reject invalid body', async () => {
    const res = await POST(createRequest({}, 'user-1'))
    expect(res.status).toBe(400)
  })

  it('should proxy to AppRoom and return checkout URL', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/xxx' }),
    })

    const res = await POST(createRequest(
      { appId: 'chat', outcomeId: 'chat_message', quantity: 50 },
      'user-1',
    ))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.checkoutUrl).toBe('https://checkout.stripe.com/xxx')
  })

  it('should return 502 when AppRoom fails', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal server error',
    })

    const res = await POST(createRequest(
      { appId: 'chat', outcomeId: 'chat_message', quantity: 50 },
      'user-1',
    ))
    expect(res.status).toBe(502)
  })

  it('should return 503 when AppRoom not configured', async () => {
    delete process.env.MYWAY_APPROOM_URL

    const res = await POST(createRequest(
      { appId: 'chat', outcomeId: 'chat_message', quantity: 50 },
      'user-1',
    ))
    expect(res.status).toBe(503)
  })
})
