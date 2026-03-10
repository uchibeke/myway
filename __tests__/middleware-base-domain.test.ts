/**
 * Tests for AUTH_REQUIRED when only MYWAY_BASE_DOMAIN is set
 * (no partner secrets, no API token).
 *
 * This covers the myway.sh scenario where the domain is public but
 * no AppRoom integration is configured yet — auth must still be enforced.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// Set env BEFORE module import — middleware reads at module level
process.env.MYWAY_BASE_DOMAIN = 'myway.sh'
process.env.MYWAY_SECRET = 'test-secret-for-hmac'

// No partners, no API token
vi.mock('@/lib/partners', () => ({
  getAllPartnerDomains: vi.fn(() => []),
  hasPartners: vi.fn(() => false),
}))

import { middleware } from '@/middleware'
import { NextRequest } from 'next/server'

afterAll(() => {
  delete process.env.MYWAY_BASE_DOMAIN
  delete process.env.MYWAY_SECRET
})

describe('Middleware: MYWAY_BASE_DOMAIN auth enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks unauthenticated API requests with 401', async () => {
    const request = new NextRequest(new URL('https://myway.sh/api/store/history?appId=somni'))
    const response = await middleware(request)
    expect(response.status).toBe(401)
  })

  it('blocks unauthenticated chat API with 401', async () => {
    const request = new NextRequest(new URL('https://myway.sh/api/openclaw/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await middleware(request)
    expect(response.status).toBe(401)
  })

  it('blocks unauthenticated page access with 403 (no AppRoom URL to redirect to)', async () => {
    const request = new NextRequest(new URL('https://myway.sh/apps/somni'))
    const response = await middleware(request)
    expect(response.status).toBe(403)
  })

  it('allows unauthenticated home page (landing)', async () => {
    const request = new NextRequest(new URL('https://myway.sh/'))
    const response = await middleware(request)
    expect(response.status).not.toBe(401)
    expect(response.status).not.toBe(403)
  })

  it('allows auth-exempt API paths', async () => {
    const request = new NextRequest(new URL('https://myway.sh/api/home/context'))
    const response = await middleware(request)
    expect(response.status).not.toBe(401)
  })

  it('blocks files API with 401', async () => {
    const request = new NextRequest(new URL('https://myway.sh/api/files'))
    const response = await middleware(request)
    expect(response.status).toBe(401)
  })
})
