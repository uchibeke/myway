import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// Set env vars BEFORE module import (hoisted mocks + top-level consts)
process.env.MYWAY_SECRET = 'test-secret-for-hmac-session-signing'
process.env.MYWAY_APPROOM_URL = 'https://approom.ai'

// Mock partners module
vi.mock('@/lib/partners', () => ({
  getAllPartnerDomains: vi.fn(() => ['approom.ai']),
  hasPartners: vi.fn(() => true),
}))

import { middleware } from '@/middleware'
import { NextRequest } from 'next/server'

afterAll(() => {
  delete process.env.MYWAY_SECRET
  delete process.env.MYWAY_APPROOM_URL
})

describe('Middleware: Cookie Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should redirect unauthenticated page requests to AppRoom when configured', async () => {
    // Use a non-exempt page route (not / which is the landing page)
    const request = new NextRequest(new URL('https://myway.sh/apps/chat'))

    const response = await middleware(request)

    // Should redirect (302 or 307)
    expect([302, 307]).toContain(response.status)
    const location = response.headers.get('location')
    expect(location).toContain('approom.ai/auth/myway')
    expect(location).toContain('redirect=')
    expect(location).toContain('state=')

    // Should set state cookie
    const cookies = response.headers.getSetCookie()
    const stateCookie = cookies.find(c => c.includes('myway_auth_state='))
    expect(stateCookie).toBeTruthy()
    expect(stateCookie).toContain('HttpOnly')
  })

  it('should allow unauthenticated visitors on the home page (landing page)', async () => {
    const request = new NextRequest(new URL('https://myway.sh/'))

    const response = await middleware(request)

    // Home page is exempt — visitors see the landing page, not a redirect
    expect(response.status).not.toBe(401)
    expect([302, 307]).not.toContain(response.status)
  })

  it('should return 401 for unauthenticated API requests (not redirect)', async () => {
    const request = new NextRequest(new URL('https://myway.sh/api/chat'), {
      method: 'POST',
    })

    const response = await middleware(request)
    expect(response.status).toBe(401)
  })

  it('should allow auth-exempt callback path without auth', async () => {
    const request = new NextRequest(new URL('https://myway.sh/auth/callback?partnerToken=x&state=y'))

    const response = await middleware(request)
    // Exempt paths should not redirect — they get through (200 passthrough)
    expect(response.status).not.toBe(401)
    expect([302, 307]).not.toContain(response.status)
  })

  it('should allow auth-exempt error page', async () => {
    const request = new NextRequest(new URL('https://myway.sh/auth/error?reason=test'))

    const response = await middleware(request)
    expect(response.status).not.toBe(401)
    expect([302, 307]).not.toContain(response.status)
  })
})
