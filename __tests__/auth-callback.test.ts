import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('@/lib/partners', () => ({
  validatePartnerToken: vi.fn(),
  createSessionToken: vi.fn(() => 'session-token.signature'),
}))

vi.mock('@/lib/consumed-tokens', () => ({
  isTokenConsumed: vi.fn(() => false),
  consumeToken: vi.fn(),
}))

vi.mock('@/lib/auth-audit', () => ({
  logAuthEvent: vi.fn(),
}))

import { GET, POST } from '@/app/auth/callback/route'
import { validatePartnerToken, createSessionToken } from '@/lib/partners'
import { isTokenConsumed, consumeToken } from '@/lib/consumed-tokens'
import { logAuthEvent } from '@/lib/auth-audit'
import { NextRequest } from 'next/server'

function createGetRequest(params: {
  partnerToken?: string
  state?: string
  cookieState?: string
  hostname?: string
}): NextRequest {
  const host = params.hostname || 'myway.sh'
  const url = new URL(`https://${host}/auth/callback`)
  if (params.partnerToken) url.searchParams.set('partnerToken', params.partnerToken)
  if (params.state) url.searchParams.set('state', params.state)

  const headers: Record<string, string> = {}
  if (params.cookieState) {
    headers.cookie = `myway_auth_state=${params.cookieState}`
  }

  return new NextRequest(url, { method: 'GET', headers })
}

function createPostRequest(params: {
  partnerToken?: string
  state?: string
  cookieState?: string
  hostname?: string
}): NextRequest {
  const host = params.hostname || 'myway.sh'
  const url = new URL(`https://${host}/auth/callback`)

  const body = new URLSearchParams()
  if (params.partnerToken) body.set('partnerToken', params.partnerToken)
  if (params.state) body.set('state', params.state)

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  }
  if (params.cookieState) {
    headers.cookie = `myway_auth_state=${params.cookieState}`
  }

  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: body.toString(),
  })
}

describe('/auth/callback', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Re-set defaults after reset
    ;(createSessionToken as any).mockReturnValue('session-token.signature')
    ;(isTokenConsumed as any).mockReturnValue(false)
    delete process.env.MYWAY_BASE_DOMAIN
  })

  // ── CSRF state validation ───────────────────────────────────────────────

  it('should reject if state does not match cookie (GET)', async () => {
    const request = createGetRequest({
      partnerToken: 'valid-token',
      state: 'state-1',
      cookieState: 'state-2',
    })
    const response = await GET(request)
    expect(response.headers.get('location')).toContain('/auth/error?reason=invalid_state')
    expect(logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'csrf_mismatch' }))
  })

  it('should reject if no state cookie exists', async () => {
    const request = createGetRequest({
      partnerToken: 'valid-token',
      state: 'state-1',
    })
    const response = await GET(request)
    expect(response.headers.get('location')).toContain('/auth/error?reason=invalid_state')
  })

  // ── Token validation ────────────────────────────────────────────────────

  it('should reject if partner token is missing (GET)', async () => {
    const request = createGetRequest({ state: 'state-1', cookieState: 'state-1' })
    const response = await GET(request)
    expect(response.headers.get('location')).toContain('/auth/error?reason=missing_token')
    expect(logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'login_failed' }))
  })

  it('should reject if partner token is invalid', async () => {
    ;(validatePartnerToken as any).mockReturnValue({
      valid: false,
      error: 'Invalid signature',
    })

    const request = createGetRequest({
      partnerToken: 'bad-token',
      state: 'state-1',
      cookieState: 'state-1',
    })
    const response = await GET(request)
    expect(response.headers.get('location')).toContain('/auth/error')
    expect(logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'token_invalid' }))
  })

  // ── One-time use (persistent) ───────────────────────────────────────────

  it('should reject replayed tokens via persistent store', async () => {
    ;(isTokenConsumed as any).mockReturnValue(true)

    const request = createGetRequest({
      partnerToken: 'payload.replayed-sig',
      state: 'state-1',
      cookieState: 'state-1',
    })
    const response = await GET(request)
    expect(response.headers.get('location')).toContain('/auth/error?reason=token_already_used')
    expect(logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'token_replay_blocked' }))
  })

  it('should consume token on successful login', async () => {
    ;(validatePartnerToken as any).mockReturnValue({
      valid: true,
      payload: {
        userId: 'user-123',
        partnerId: 'approom',
        timestamp: Date.now(),
        expiresAt: Date.now() + 300000,
      },
    })

    const request = createGetRequest({
      partnerToken: 'payload.fresh-sig',
      state: 'state-abc',
      cookieState: 'state-abc',
    })
    await GET(request)
    expect(consumeToken).toHaveBeenCalledWith('fresh-sig')
  })

  // ── Subdomain verification ──────────────────────────────────────────────

  it('should reject if subdomain does not match token claim', async () => {
    process.env.MYWAY_BASE_DOMAIN = 'myway.sh'

    ;(validatePartnerToken as any).mockReturnValue({
      valid: true,
      payload: {
        userId: 'user-123',
        partnerId: 'approom',
        timestamp: Date.now(),
        expiresAt: Date.now() + 300000,
        metadata: { subdomain: 'alice' },
      },
    })

    const request = createGetRequest({
      partnerToken: 'payload.sig123',
      state: 'state-abc',
      cookieState: 'state-abc',
      hostname: 'uchi.myway.sh',
    })
    const response = await GET(request)
    expect(response.headers.get('location')).toContain('/auth/error?reason=access_denied')
    expect(logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'subdomain_mismatch' }))
  })

  it('should allow when subdomain matches token claim', async () => {
    process.env.MYWAY_BASE_DOMAIN = 'myway.sh'

    ;(validatePartnerToken as any).mockReturnValue({
      valid: true,
      payload: {
        userId: 'user-123',
        partnerId: 'approom',
        timestamp: Date.now(),
        expiresAt: Date.now() + 300000,
        metadata: { subdomain: 'uchi' },
      },
    })

    const request = createGetRequest({
      partnerToken: 'payload.sig456',
      state: 'state-abc',
      cookieState: 'state-abc',
      hostname: 'uchi.myway.sh',
    })
    const response = await GET(request)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).not.toContain('/auth/error')
    expect(createSessionToken).toHaveBeenCalledWith('user-123', 'approom', 'uchi')
  })

  // ── POST support (token out of URL) ─────────────────────────────────────

  it('should accept token via POST body', async () => {
    ;(validatePartnerToken as any).mockReturnValue({
      valid: true,
      payload: {
        userId: 'user-456',
        partnerId: 'approom',
        timestamp: Date.now(),
        expiresAt: Date.now() + 300000,
      },
    })

    const request = createPostRequest({
      partnerToken: 'payload.post-sig',
      state: 'state-xyz',
      cookieState: 'state-xyz',
    })
    const response = await POST(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/')
    expect(createSessionToken).toHaveBeenCalledWith('user-456', 'approom', undefined)
    expect(consumeToken).toHaveBeenCalledWith('post-sig')
    expect(logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'login_success',
      userId: 'user-456',
    }))
  })

  // ── Audit trail ─────────────────────────────────────────────────────────

  it('should set session cookie and redirect on valid token', async () => {
    ;(validatePartnerToken as any).mockReturnValue({
      valid: true,
      payload: {
        userId: 'user-123',
        partnerId: 'approom',
        timestamp: Date.now(),
        expiresAt: Date.now() + 300000,
        mfaVerifiedAt: Date.now(),
      },
    })

    const request = createGetRequest({
      partnerToken: 'valid-token.signature',
      state: 'state-abc',
      cookieState: 'state-abc',
    })
    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/')

    // Check session token creation
    expect(createSessionToken).toHaveBeenCalledWith('user-123', 'approom', undefined)

    // Check session cookie
    const cookies = response.headers.getSetCookie()
    const sessionCookie = cookies.find(c => c.includes('myway_session='))
    expect(sessionCookie).toBeTruthy()
    expect(sessionCookie).toContain('HttpOnly')
    expect(sessionCookie).toContain('Secure')
    expect(sessionCookie?.toLowerCase()).toContain('samesite=lax')

    // Check audit log
    expect(logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'login_success',
      userId: 'user-123',
      partnerId: 'approom',
    }))
  })
})
