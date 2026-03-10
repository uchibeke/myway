import { NextRequest, NextResponse } from 'next/server'
import {
  getAllPartnerDomains,
  hasPartners,
  type SessionPayload,
} from '@/lib/partners'

/**
 * Lightweight API authentication + rate limiting middleware.
 *
 * Auth modes (evaluated in order):
 *   1. Session token (contains '.') — validated via HMAC with MYWAY_SECRET.
 *      Extracts userId from payload, sets x-myway-user-id header.
 *   2. API token (no '.') — compared against MYWAY_API_TOKEN (admin/self-hosted).
 *   3. No auth header — 401 if auth is required.
 *
 * Auth is required when MYWAY_API_TOKEN is set OR any partner secrets exist.
 * Self-hosted with no token and no partners → all routes open.
 *
 * Rate limiting: simple sliding-window per IP, 60 requests/minute on
 * expensive endpoints (chat, extract, tts, upload). Health/SSE are exempt.
 *
 * CORS / CSP: MYWAY_ALLOWED_ORIGINS + partner domains are merged.
 * Partner domains (from MYWAY_PARTNER_<ID>_DOMAINS) are auto-added.
 *
 * NOTE: All crypto in this file uses Web Crypto API + pure-JS helpers
 * because Next.js middleware runs in Edge Runtime (no Node.js 'crypto' module).
 */

const API_TOKEN = process.env.MYWAY_API_TOKEN?.trim()

// ── Allowed origins for CORS + CSP frame-ancestors ──────────────────────────
// Merge explicit MYWAY_ALLOWED_ORIGINS with auto-discovered partner domains.

const PARTNER_DOMAIN_ORIGINS = getAllPartnerDomains().map(d => `https://${d}`)

const ALLOWED_ORIGINS: string[] = [
  ...(process.env.MYWAY_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean),
  ...PARTNER_DOMAIN_ORIGINS,
]

/**
 * Whether auth is required on API and page routes.
 *
 * Mirrors the logic in isHostedMode() (src/lib/hosted-storage.ts) but
 * kept inline because middleware runs in Edge Runtime and cannot import
 * Node-only modules (better-sqlite3). Must stay in sync.
 *
 * True when ANY of these signals indicate a hosted/platform deployment:
 *   - MYWAY_API_TOKEN      — single-tenant hosted mode
 *   - Partner secrets       — multi-tenant AppRoom integration
 *   - MYWAY_BASE_DOMAIN    — shared domain deployment (e.g. myway.sh)
 *
 * When false (none set), the instance is self-hosted and all routes are open.
 */
function isAuthRequired(): boolean {
  return !!API_TOKEN || hasPartners() || !!process.env.MYWAY_BASE_DOMAIN?.trim()
}

/** Check if an origin is in the allowlist. Returns the matched origin or null. */
function matchOrigin(origin: string | null): string | null {
  if (!origin || ALLOWED_ORIGINS.length === 0) return null
  return ALLOWED_ORIGINS.includes(origin) ? origin : null
}

/** Apply CORS headers to a response for a matched origin. */
function applyCorsHeaders(response: NextResponse, origin: string): void {
  response.headers.set('Access-Control-Allow-Origin', origin)
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Myway-User-Id')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
}

// ── Edge-compatible crypto helpers ──────────────────────────────────────────
// No Node.js 'crypto' import — Edge Runtime only supports Web Crypto API.

const encoder = new TextEncoder()

/** Hex-encode a Uint8Array. */
function toHex(buf: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i].toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Constant-time string comparison (pure JS, no Node.js crypto).
 * Prevents timing attacks on signature verification.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/**
 * Constant-time API token comparison.
 * Both strings are compared character-by-character to prevent timing attacks.
 */
function tokenMatches(candidate: string): boolean {
  if (!API_TOKEN) return false
  return constantTimeEqual(candidate, API_TOKEN)
}

/**
 * Validate a session token using Web Crypto HMAC-SHA256 + constant-time comparison.
 */
async function validateSessionTokenEdge(token: string): Promise<SessionPayload | null> {
  const dotIndex = token.indexOf('.')
  if (dotIndex === -1) return null

  const encoded = token.slice(0, dotIndex)
  const sig = token.slice(dotIndex + 1)
  if (!encoded || !sig) return null

  const secret = process.env.MYWAY_SECRET?.trim()
  if (!secret) return null

  try {
    // Import the secret as an HMAC key (Web Crypto API)
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )

    // Compute expected signature
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(encoded))
    const expectedHex = toHex(new Uint8Array(signatureBuffer))

    // Constant-time comparison
    if (!constantTimeEqual(sig, expectedHex)) return null

    // Decode payload
    const decoded = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
    const payload: SessionPayload = JSON.parse(decoded)
    if (!payload.userId || !payload.partnerId || !payload.exp) return null
    if (Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

// ── CSRF state bound to callback URL ─────────────────────────────────────────
// The state cookie is HMAC-bound to the callback URL so it can't be reused for
// a different redirect target. Format: nonce.hmac(nonce+callbackUrl)

async function createBoundState(callbackUrl: string): Promise<string> {
  const nonce = crypto.randomUUID()
  const secret = process.env.MYWAY_SECRET?.trim()
  if (!secret) return nonce // Fallback: unbound nonce if no secret configured

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const data = `${nonce}:${callbackUrl}`
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return `${nonce}.${toHex(new Uint8Array(sig))}`
}

// ── Rate limiter (in-memory, per-process) ────────────────────────────────────

const RATE_WINDOW_MS = 60_000 // 1 minute
const DEFAULT_RATE_LIMIT = 60 // requests per window
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

// Endpoints that are rate-limited (expensive operations).
// Per-prefix limits: auth endpoints get a stricter limit to prevent brute-force.
const RATE_LIMITED_PREFIXES: { prefix: string; limit: number }[] = [
  { prefix: '/api/openclaw/chat',    limit: DEFAULT_RATE_LIMIT },
  { prefix: '/api/extract',          limit: DEFAULT_RATE_LIMIT },
  { prefix: '/api/tts',              limit: DEFAULT_RATE_LIMIT },
  { prefix: '/api/files/upload',     limit: DEFAULT_RATE_LIMIT },
  { prefix: '/api/connections/auth', limit: DEFAULT_RATE_LIMIT },
  { prefix: '/api/onboarding/live', limit: 10 },
  // Auth endpoints — 10 req/min per IP (prevent brute-force token guessing)
  { prefix: '/api/partner/auth',     limit: 10 },
  { prefix: '/auth/callback',        limit: 10 },
  { prefix: '/api/admin',            limit: 30 },
  // Addon checkout — 10 req/min per IP (prevent purchase spam)
  { prefix: '/api/addons',           limit: 10 },
]

// Clean up stale buckets every 5 minutes to prevent memory leaks
let lastCleanup = Date.now()
function cleanupBuckets() {
  const now = Date.now()
  if (now - lastCleanup < 300_000) return
  lastCleanup = now
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt < now) rateBuckets.delete(key)
  }
}

function checkRateLimit(ip: string, limit: number = DEFAULT_RATE_LIMIT): { allowed: boolean; remaining: number; resetAt: number; limit: number } {
  cleanupBuckets()
  const now = Date.now()
  const bucketKey = `${ip}:${limit}` // separate buckets per limit tier
  const bucket = rateBuckets.get(bucketKey)

  if (!bucket || bucket.resetAt < now) {
    const resetAt = now + RATE_WINDOW_MS
    rateBuckets.set(bucketKey, { count: 1, resetAt })
    return { allowed: true, remaining: limit - 1, resetAt, limit }
  }

  bucket.count++
  if (bucket.count > limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt, limit }
  }
  return { allowed: true, remaining: limit - bucket.count, resetAt: bucket.resetAt, limit }
}

// ── Auth paths exempt from token checks ─────────────────────────────────────

const AUTH_EXEMPT_PATHS = [
  '/api/partner/auth',
  '/api/auth/status',
  '/api/home/context',
  '/api/onboarding/tts',
  '/api/onboarding/tts/play',
  '/api/onboarding/step',
  '/auth/callback',
  '/auth/error',
  '/api/demo/respond',
  '/api/demo/stream',
  '/api/demo/realtime/session',
  '/api/integrations/status',
]

/** Page routes that visitors can access without authentication (landing page). */
const PAGE_AUTH_EXEMPT_PATHS = [
  '/',
  '/terms',
  '/privacy',
]

/** Read lazily so tests can set env after module import. */
function getAppRoomUrl(): string {
  return process.env.MYWAY_APPROOM_URL?.trim() || ''
}

/**
 * Get the public-facing origin for this request.
 *
 * Behind a reverse proxy (Cloudflare Tunnel, nginx, etc.) request.url resolves
 * to the internal address (e.g. http://localhost:48291). We reconstruct the
 * real origin from X-Forwarded-Host / X-Forwarded-Proto headers that the proxy
 * sets, so redirects go to alice.myway.sh instead of localhost.
 */
function getPublicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https'
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }
  // Fallback: use the Host header (may still be correct for direct access)
  const host = request.headers.get('host')
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    return `${forwardedProto}://${host}`
  }
  return request.nextUrl.origin
}

/**
 * Subdomain-based user binding for shared deployments.
 *
 * MYWAY_BASE_DOMAIN — e.g., 'myway.sh'
 *   When set, the middleware extracts the subdomain from the request hostname
 *   (e.g., 'uchi' from 'uchi.myway.sh') and verifies it matches the authenticated
 *   userId's assigned subdomain. The mapping is stored in the partner token's
 *   metadata.subdomain field, set by AppRoom at token generation.
 *
 * When NOT set (self-hosted, single-user), no subdomain check is performed.
 */
function getBaseDomain(): string {
  return process.env.MYWAY_BASE_DOMAIN?.trim() || ''
}

/**
 * Extract subdomain from hostname given the base domain.
 * e.g., hostname='uchi.myway.sh', baseDomain='myway.sh' → 'uchi'
 * Returns null if hostname doesn't match or is the bare domain.
 */
function extractSubdomain(hostname: string, baseDomain: string): string | null {
  if (!hostname.endsWith(baseDomain)) return null
  const prefix = hostname.slice(0, hostname.length - baseDomain.length)
  if (!prefix || prefix === '.') return null // bare domain
  // Remove trailing dot: 'uchi.' → 'uchi'
  const sub = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix
  if (!sub || sub.includes('.')) return null // nested subdomains not allowed
  return sub
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isApiRoute = pathname.startsWith('/api/')
  const requestOrigin = request.headers.get('origin')
  const matchedOrigin = matchOrigin(requestOrigin)

  // ── Strip external X-Myway-User-Id — only middleware should set this ──────
  // Prevents header spoofing: without stripping, a caller could send
  // X-Myway-User-Id to impersonate another user's tenant DB.
  const requestHeaders = new Headers(request.headers)
  if (request.headers.get('x-myway-user-id')) {
    requestHeaders.delete('x-myway-user-id')
  }

  // ── Validate X-Myway-User-Id header (tenant ID) ──────────────────────────
  const tenantId = requestHeaders.get('x-myway-user-id')
  if (tenantId && !/^[a-zA-Z0-9_-]{1,64}$/.test(tenantId)) {
    return NextResponse.json({ error: 'Invalid X-Myway-User-Id' }, { status: 400 })
  }

  // ── CORS preflight (OPTIONS) — must be handled before auth ─────────────────
  if (isApiRoute && request.method === 'OPTIONS' && matchedOrigin) {
    const preflightResponse = new NextResponse(null, { status: 204 })
    applyCorsHeaders(preflightResponse, matchedOrigin)
    preflightResponse.headers.set('Access-Control-Max-Age', '86400')
    return preflightResponse
  }

  // ── Page routes — add CSP frame-ancestors when origins configured ──────────
  if (!isApiRoute) {
    // Always identify user from session cookie (tenant identification).
    // Decoupled from auth enforcement so logged-in users on self-hosted
    // instances (no hosted env vars) still get their tenant ID set.
    const isPageAuthExempt = AUTH_EXEMPT_PATHS.some(p => pathname.startsWith(p))
      || PAGE_AUTH_EXEMPT_PATHS.includes(pathname)
    const cookieToken = request.cookies.get('myway_session')?.value
    let pageAuthenticated = false

    if (cookieToken?.includes('.')) {
      const session = await validateSessionTokenEdge(cookieToken)
      if (session) {
        // Verify subdomain binding if MYWAY_BASE_DOMAIN is set
        const baseDomain = getBaseDomain()
        if (baseDomain) {
          const hostname = request.nextUrl.hostname
          const requestSub = extractSubdomain(hostname, baseDomain)
          if (requestSub && requestSub !== session.subdomain) {
            const response = NextResponse.redirect(new URL('/auth/error?reason=access_denied', getPublicOrigin(request)))
            response.cookies.delete('myway_session')
            return response
          }
        }
        pageAuthenticated = true
        requestHeaders.set('x-myway-user-id', session.userId)

        // Sliding window: only refresh cookie when < 50% lifetime remains.
        const remainingSec = Math.max(0, (session.exp - Date.now()) / 1000)
        const halfLife = (24 * 60 * 60) / 2 // 12 hours
        if (remainingSec < halfLife) {
          requestHeaders.set('x-myway-refresh-session', cookieToken!)
        }
      }
    }

    // Auth enforcement: redirect unauthenticated users when auth is required
    if (isAuthRequired() && !pageAuthenticated && !isPageAuthExempt) {
      const appRoomUrl = getAppRoomUrl()
      if (appRoomUrl) {
        // Redirect to AppRoom login
        const callbackUrl = new URL('/auth/callback', getPublicOrigin(request)).toString()

        // SECURITY: Reuse existing state cookie if present to prevent race conditions
        // During email auth flow, multiple requests can hit middleware and overwrite state
        const existingState = request.cookies.get('myway_auth_state')?.value
        const state = existingState || await createBoundState(callbackUrl)
        const loginUrl = `${appRoomUrl}/auth/myway?redirect=${encodeURIComponent(callbackUrl)}&state=${state}&brandName=Myway&theme=dark&primaryColor=2563eb`

        const accept = request.headers.get('accept') || ''
        const secFetchMode = request.headers.get('sec-fetch-mode')
        const isFetchRequest = request.headers.get('rsc') === '1'
          || request.headers.get('next-router-state-tree') !== null
          || request.nextUrl.searchParams.has('_rsc')
          || (!accept.includes('text/html') && secFetchMode === 'cors')
        if (isFetchRequest) {
          const response = NextResponse.json({ loginUrl }, { status: 401 })
          if (!existingState) {
            response.cookies.set('myway_auth_state', state, {
              httpOnly: true,
              secure: true,
              sameSite: 'lax',
              maxAge: 600,
              path: '/',
            })
          }
          return response
        }

        const response = NextResponse.redirect(loginUrl)
        if (!existingState) {
          response.cookies.set('myway_auth_state', state, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 600,
            path: '/',
          })
        }
        return response
      }
      // Auth required but no login URL configured — block access
      return new NextResponse('Authentication required', { status: 403 })
    }

    const response = ALLOWED_ORIGINS.length > 0
      ? NextResponse.next({ request: { headers: requestHeaders } })
      : NextResponse.next({ request: { headers: requestHeaders } })

    if (ALLOWED_ORIGINS.length > 0) {
      response.headers.set(
        'Content-Security-Policy',
        `frame-ancestors 'self' ${ALLOWED_ORIGINS.join(' ')}`,
      )
    }

    // Sliding window: refresh session cookie so it doesn't expire while user is active
    const refreshToken = requestHeaders.get('x-myway-refresh-session')
    if (refreshToken) {
      response.cookies.set('myway_session', refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60, // 24 hours
        path: '/',
      })
    }

    return response
  }

  // ── API routes below ───────────────────────────────────────────────────────

  // Exempt paths (auth endpoint itself, etc.)
  const isAuthExempt = AUTH_EXEMPT_PATHS.some(p => pathname === p)

  // Always identify user from session/bearer token (tenant identification).
  // Decoupled from auth enforcement so logged-in users on self-hosted
  // instances (no hosted env vars) still get their tenant ID set.
  const authHeader = request.headers.get('authorization')
  const apiCookieToken = request.cookies.get('myway_session')?.value
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = bearerToken || apiCookieToken
  let apiAuthenticated = false

  if (token) {
    if (token.includes('.')) {
      const session = await validateSessionTokenEdge(token)
      if (session) {
        const baseDomain = getBaseDomain()
        if (baseDomain) {
          const hostname = request.nextUrl.hostname
          const requestSub = extractSubdomain(hostname, baseDomain)
          if (requestSub && requestSub !== session.subdomain) {
            const resp = NextResponse.json({ error: 'Access denied: subdomain mismatch' }, { status: 403 })
            if (matchedOrigin) applyCorsHeaders(resp, matchedOrigin)
            return resp
          }
        }
        apiAuthenticated = true
        requestHeaders.set('x-myway-user-id', session.userId)
        // NOTE: No cookie refresh on API routes. Setting Set-Cookie on API
        // responses causes Next.js to invalidate the router cache, triggering
        // unwanted page re-fetches (visible as reloads while user is typing).
        // Session refresh only happens on page navigations (handled above).
      }
    } else if (bearerToken) {
      if (tokenMatches(bearerToken)) {
        apiAuthenticated = true
      }
    }
  }

  // Auth enforcement: block unauthenticated requests when auth is required
  if (isAuthRequired() && !isAuthExempt && !apiAuthenticated) {
    const resp = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (matchedOrigin) applyCorsHeaders(resp, matchedOrigin)
    return resp
  }

  // Rate limiting on expensive endpoints (per-prefix limits)
  const matchedPrefix = RATE_LIMITED_PREFIXES.find(p => pathname.startsWith(p.prefix))

  if (matchedPrefix) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
    const { allowed, remaining, resetAt, limit: effectiveLimit } = checkRateLimit(ip, matchedPrefix.limit)

    if (!allowed) {
      console.warn(`[rate-limit] ${ip} blocked on ${pathname} (limit=${effectiveLimit}/min)`)
      const resp = NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)),
            'X-RateLimit-Limit': String(effectiveLimit),
            'X-RateLimit-Remaining': '0',
          },
        },
      )
      if (matchedOrigin) applyCorsHeaders(resp, matchedOrigin)
      return resp
    }

    const response = NextResponse.next({ request: { headers: requestHeaders } })
    response.headers.set('X-RateLimit-Limit', String(effectiveLimit))
    response.headers.set('X-RateLimit-Remaining', String(remaining))
    if (matchedOrigin) applyCorsHeaders(response, matchedOrigin)
    refreshSessionCookie(requestHeaders, response)
    return response
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  if (matchedOrigin) applyCorsHeaders(response, matchedOrigin)
  refreshSessionCookie(requestHeaders, response)
  return response
}

/** Sliding window session refresh — extends cookie lifetime on every authenticated request. */
function refreshSessionCookie(reqHeaders: Headers, response: NextResponse): void {
  const token = reqHeaders.get('x-myway-refresh-session')
  if (!token) return
  response.cookies.set('myway_session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60, // 24 hours
    path: '/',
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon|icon|manifest).*)'],
}
