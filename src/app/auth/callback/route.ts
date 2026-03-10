import { NextRequest, NextResponse } from 'next/server'
import { validatePartnerToken, createSessionToken } from '@/lib/partners'
import { isTokenConsumed, consumeToken } from '@/lib/consumed-tokens'
import { logAuthEvent } from '@/lib/auth-audit'

/**
 * POST/GET /auth/callback — AppRoom SSO callback
 *
 * Handles two authentication flows:
 *
 * 1. OAuth Authorization Code Flow (redirect-based SSO - RECOMMENDED):
 *    - AppRoom redirects with ?code=xxx&state=yyy
 *    - Code is exchanged server-side via HMAC-signed request
 *    - Code is useless without shared secret (secure for URL transmission)
 *
 * 2. Partner Token Flow (iframe embedding - legacy):
 *    - AppRoom submits partnerToken via POST/GET
 *    - Token is HMAC-signed and validated directly
 *    - Used for iframe embedding scenarios
 *
 * Query params (GET) or form body (POST):
 *   code         — OAuth authorization code (new flow)
 *   partnerToken — HMAC-signed token (iframe flow)
 *   state        — CSRF nonce (must match HttpOnly cookie)
 *
 * Security:
 *   - CSRF state validated against HttpOnly cookie (HMAC-bound to callback URL)
 *   - OAuth code: exchanged server-side with HMAC signature
 *   - Partner token: HMAC-verified, one-time use, subdomain-bound
 *   - All events logged to auth audit trail
 */

/**
 * Extract subdomain from hostname given a base domain.
 * e.g., hostname='uchi.myway.sh', baseDomain='myway.sh' → 'uchi'
 */
function extractSubdomain(hostname: string, baseDomain: string): string | null {
  if (!hostname.endsWith(baseDomain)) return null
  const prefix = hostname.slice(0, hostname.length - baseDomain.length)
  if (!prefix || prefix === '.') return null
  const sub = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix
  if (!sub || sub.includes('.')) return null
  return sub
}

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
}

/** Reconstruct public origin from proxy headers (Cloudflare Tunnel, etc.). */
function getPublicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https'
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`
  const host = request.headers.get('host')
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    return `${forwardedProto}://${host}`
  }
  return new URL(request.url).origin
}

async function handleCallback(request: NextRequest) {
  const ip = getClientIp(request)
  const hostname = request.nextUrl.hostname

  // Extract params from POST body or GET query
  let token: string | null = null
  let code: string | null = null
  let state: string | null = null

  if (request.method === 'POST') {
    try {
      const contentType = request.headers.get('content-type') || ''
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const body = await request.text()
        const params = new URLSearchParams(body)
        token = params.get('partnerToken')
        code = params.get('code')
        state = params.get('state')
      } else {
        const formData = await request.formData()
        token = formData.get('partnerToken') as string | null
        code = formData.get('code') as string | null
        state = formData.get('state') as string | null
      }
    } catch {
      logAuthEvent({ event: 'login_failed', ip, hostname, detail: 'invalid_form_body' })
      return NextResponse.redirect(new URL('/auth/error?reason=invalid_token', getPublicOrigin(request)))
    }
  } else {
    token = request.nextUrl.searchParams.get('partnerToken')
    code = request.nextUrl.searchParams.get('code')
    state = request.nextUrl.searchParams.get('state')
  }

  // 1. Validate CSRF state (HMAC-bound to callback URL)
  const expectedState = request.cookies.get('myway_auth_state')?.value
  if (!state || !expectedState || state !== expectedState) {
    logAuthEvent({ event: 'csrf_mismatch', ip, hostname, detail: 'state_cookie_mismatch' })
    return NextResponse.redirect(new URL('/auth/error?reason=invalid_state', getPublicOrigin(request)))
  }

  // 2. Handle OAuth authorization code flow (new secure flow)
  if (code && !token) {
    const appRoomUrl = process.env.MYWAY_APPROOM_URL?.trim()
    const partnerSecret = process.env.MYWAY_PARTNER_APPROOM_SECRET?.trim()

    if (!appRoomUrl || !partnerSecret) {
      logAuthEvent({ event: 'login_failed', ip, hostname, detail: 'approom_not_configured' })
      return NextResponse.redirect(new URL('/auth/error?reason=configuration_error', getPublicOrigin(request)))
    }

    // Exchange code for user data (server-to-server HMAC-signed request)
    try {
      const callbackUrl = new URL('/auth/callback', getPublicOrigin(request)).toString()
      const exchangeBody = JSON.stringify({ code, redirect: callbackUrl, state })
      const signature = require('crypto').createHmac('sha256', partnerSecret).update(exchangeBody).digest('hex')

      const exchangeRes = await fetch(`${appRoomUrl}/api/auth/myway/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Myway-Signature': signature,
        },
        body: exchangeBody,
      })

      if (!exchangeRes.ok) {
        const errorText = await exchangeRes.text().catch(() => 'Unknown error')
        logAuthEvent({ event: 'code_exchange_failed', ip, hostname, detail: `${exchangeRes.status}: ${errorText}` })
        return NextResponse.redirect(new URL('/auth/error?reason=exchange_failed', getPublicOrigin(request)))
      }

      const userData = await exchangeRes.json() as { userId: string; subdomain?: string }
      const userId = userData.userId
      const subdomain = userData.subdomain

      // Create session token
      const { createSessionToken } = await import('@/lib/partners')
      const sessionToken = createSessionToken(userId, 'approom', subdomain)

      // Log successful login
      logAuthEvent({
        event: 'login_success',
        userId,
        partnerId: 'approom',
        ip,
        hostname,
        subdomain,
      })

      // Post-login setup (async, non-blocking)
      try {
        const { getDb } = await import('@/lib/db')
        const db = getDb(userId)
        const { runPostLoginSetup } = await import('@/lib/post-login-setup')
        runPostLoginSetup(db, {
          userId,
          email: (userData as Record<string, unknown>)?.email as string | undefined,
          subdomain,
        }).catch((err) => {
          console.error('[auth-callback] Post-login setup failed:', err)
        })
      } catch { /* non-critical */ }

      // Set HttpOnly cookie + clear state cookie
      const response = NextResponse.redirect(new URL('/', getPublicOrigin(request)))
      response.cookies.set('myway_session', sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60, // 24 hours
        path: '/',
      })
      response.cookies.delete('myway_auth_state')

      return response
    } catch (error) {
      logAuthEvent({ event: 'code_exchange_error', ip, hostname, detail: error instanceof Error ? error.message : 'unknown' })
      return NextResponse.redirect(new URL('/auth/error?reason=exchange_error', getPublicOrigin(request)))
    }
  }

  // 3. Validate partner token presence (existing iframe flow)
  if (!token) {
    logAuthEvent({ event: 'login_failed', ip, hostname, detail: 'missing_token_or_code' })
    return NextResponse.redirect(new URL('/auth/error?reason=missing_token', getPublicOrigin(request)))
  }

  // 4. Check token format (partner token flow)
  const dotIndex = token.indexOf('.')
  if (dotIndex === -1) {
    logAuthEvent({ event: 'token_invalid', ip, hostname, detail: 'no_separator' })
    return NextResponse.redirect(new URL('/auth/error?reason=invalid_token', getPublicOrigin(request)))
  }
  const tokenSig = token.slice(dotIndex + 1)

  // 5. Check one-time use (persisted to SQLite — survives restart)
  if (isTokenConsumed(tokenSig)) {
    logAuthEvent({ event: 'token_replay_blocked', ip, hostname, detail: 'signature_reused' })
    return NextResponse.redirect(new URL('/auth/error?reason=token_already_used', getPublicOrigin(request)))
  }

  // 6. Validate HMAC signature + expiration
  const result = validatePartnerToken(token)
  if (!result.valid || !result.payload) {
    const event: 'token_expired' | 'token_invalid' =
      result.error === 'Token expired' ? 'token_expired' : 'token_invalid'
    logAuthEvent({ event, ip, hostname, detail: result.error })
    return NextResponse.redirect(
      new URL(`/auth/error?reason=${encodeURIComponent(result.error || 'invalid_token')}`, getPublicOrigin(request)),
    )
  }

  // 7. Subdomain verification (shared deployments with MYWAY_BASE_DOMAIN)
  const claimedSubdomain = (result.payload.metadata as Record<string, unknown>)?.subdomain as string | undefined
  const baseDomain = process.env.MYWAY_BASE_DOMAIN?.trim() || ''
  if (baseDomain) {
    const subdomain = extractSubdomain(hostname, baseDomain)

    if (subdomain && subdomain !== claimedSubdomain) {
      logAuthEvent({
        event: 'subdomain_mismatch',
        userId: result.payload.userId,
        ip,
        hostname,
        subdomain,
        detail: `expected=${claimedSubdomain || 'none'} actual=${subdomain}`,
      })
      return NextResponse.redirect(new URL('/auth/error?reason=access_denied', getPublicOrigin(request)))
    }
    if (!subdomain && claimedSubdomain) {
      logAuthEvent({
        event: 'subdomain_mismatch',
        userId: result.payload.userId,
        ip,
        hostname,
        detail: `bare_domain_with_subdomain_claim=${claimedSubdomain}`,
      })
      return NextResponse.redirect(new URL('/auth/error?reason=access_denied', getPublicOrigin(request)))
    }
  }

  // 8. Mark token as consumed (persisted — survives restart)
  consumeToken(tokenSig)

  // 9. Create session token (includes subdomain for per-request verification)
  const sessionToken = createSessionToken(result.payload.userId, result.payload.partnerId, claimedSubdomain)

  // 10. Log successful login
  logAuthEvent({
    event: 'login_success',
    userId: result.payload.userId,
    partnerId: result.payload.partnerId,
    ip,
    hostname,
    subdomain: claimedSubdomain,
  })

  // 11. Post-login setup: profile sync, passport, welcome data (async, non-blocking)
  try {
    const { getDb } = await import('@/lib/db')
    const db = getDb(result.payload.userId)
    const { runPostLoginSetup } = await import('@/lib/post-login-setup')
    const metadata = result.payload.metadata as Record<string, unknown> | undefined
    runPostLoginSetup(db, {
      userId: result.payload.userId,
      email: metadata?.email as string | undefined,
      subdomain: claimedSubdomain,
    }).catch((err) => {
      console.error('[auth-callback] Post-login setup failed:', err)
    })
  } catch { /* non-critical — setup is best-effort */ }

  // 12. Set HttpOnly cookie + clear state cookie
  const response = NextResponse.redirect(new URL('/', getPublicOrigin(request)))
  response.cookies.set('myway_session', sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60, // 24 hours (matches session token expiry)
    path: '/',
  })
  response.cookies.delete('myway_auth_state')

  return response
}

export async function POST(request: NextRequest) {
  return handleCallback(request)
}

export async function GET(request: NextRequest) {
  return handleCallback(request)
}
