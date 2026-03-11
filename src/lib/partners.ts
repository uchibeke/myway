/**
 * Partner Authentication — HMAC token exchange for platform mode.
 *
 * Partners embed Myway in iframes and authenticate users via HMAC-signed tokens.
 * Each partner has a shared secret (env var). Myway verifies the signature and
 * issues a short-lived session token for subsequent API calls.
 *
 * Env var convention:
 *   MYWAY_PARTNER_<ID>_SECRET  — shared HMAC secret (required, 32+ hex chars)
 *   MYWAY_PARTNER_<ID>_DOMAINS — comma-separated allowed domains (optional)
 *   MYWAY_PARTNER_<ID>_NAME    — display name (optional, defaults to capitalized ID)
 */

// Lazy-imported: Node 'crypto' is not available in Edge Runtime (middleware).
// Only the HMAC functions below need it — getAllPartnerDomains/hasPartners (used
// by middleware) work without it.
let _crypto: typeof import('crypto') | null = null
function getCrypto() {
  if (!_crypto) _crypto = require('crypto') as typeof import('crypto')
  return _crypto
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface PartnerConfig {
  id: string
  name: string
  sharedSecret: string
  allowedDomains: string[]
}

export interface PartnerTokenPayload {
  userId: string
  partnerId: string
  timestamp: number
  expiresAt: number
  metadata?: Record<string, unknown>
}

export interface SessionPayload {
  userId: string
  partnerId: string
  subdomain?: string
  iat: number
  exp: number
}

// ── Partner Registry (env-var-driven) ────────────────────────────────────────

let _partners: Map<string, PartnerConfig> | null = null

/** Scan env vars for MYWAY_PARTNER_<ID>_SECRET pattern. Cached after first call. */
export function loadPartners(): Map<string, PartnerConfig> {
  if (_partners) return _partners
  _partners = new Map()

  const secretPattern = /^MYWAY_PARTNER_([A-Z0-9_]+)_SECRET$/
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(secretPattern)
    if (!match || !value?.trim()) continue

    const rawId = match[1]
    const id = rawId.toLowerCase()
    const secret = value.trim()

    const domains = (process.env[`MYWAY_PARTNER_${rawId}_DOMAINS`] ?? '')
      .split(',')
      .map(d => d.trim())
      .filter(Boolean)

    const name =
      process.env[`MYWAY_PARTNER_${rawId}_NAME`]?.trim() ||
      rawId.charAt(0) + rawId.slice(1).toLowerCase()

    _partners.set(id, { id, name, sharedSecret: secret, allowedDomains: domains })
  }

  return _partners
}

/** Get all partner allowed domains (for CORS/CSP merge). */
export function getAllPartnerDomains(): string[] {
  const partners = loadPartners()
  const domains: string[] = []
  for (const partner of partners.values()) {
    domains.push(...partner.allowedDomains)
  }
  return domains
}

/** Check if any partners are configured. */
export function hasPartners(): boolean {
  return loadPartners().size > 0
}

// ── Base64url helpers ────────────────────────────────────────────────────────

function base64urlEncode(data: string): string {
  return Buffer.from(data).toString('base64url')
}

function base64urlDecode(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf-8')
}

// ── HMAC helpers ─────────────────────────────────────────────────────────────

function hmacSign(data: string, secret: string): string {
  return getCrypto().createHmac('sha256', secret).update(data).digest('hex')
}

function hmacVerify(data: string, signature: string, secret: string): boolean {
  const expected = hmacSign(data, secret)
  const a = Buffer.from(signature, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  return getCrypto().timingSafeEqual(a, b)
}

// ── Partner Token Validation ─────────────────────────────────────────────────

export function validatePartnerToken(
  token: string,
  referer?: string,
): { valid: boolean; payload?: PartnerTokenPayload; error?: string } {
  // 1. Parse format: base64url(payload).hmac_hex
  const dotIndex = token.indexOf('.')
  if (dotIndex === -1) {
    return { valid: false, error: 'Invalid token format: missing separator' }
  }

  const encodedPayload = token.slice(0, dotIndex)
  const signature = token.slice(dotIndex + 1)

  if (!encodedPayload || !signature) {
    return { valid: false, error: 'Invalid token format: empty segments' }
  }

  // 2. Decode + parse JSON payload
  let payload: PartnerTokenPayload
  try {
    const decoded = base64urlDecode(encodedPayload)
    payload = JSON.parse(decoded)
  } catch {
    return { valid: false, error: 'Invalid token: failed to decode payload' }
  }

  // 3. Validate required fields
  if (!payload.userId || typeof payload.userId !== 'string') {
    return { valid: false, error: 'Missing or invalid userId' }
  }
  if (!payload.partnerId || typeof payload.partnerId !== 'string') {
    return { valid: false, error: 'Missing or invalid partnerId' }
  }
  if (typeof payload.timestamp !== 'number') {
    return { valid: false, error: 'Missing or invalid timestamp' }
  }
  if (typeof payload.expiresAt !== 'number') {
    return { valid: false, error: 'Missing or invalid expiresAt' }
  }

  // 4. Look up partner config
  const partners = loadPartners()
  const partner = partners.get(payload.partnerId.toLowerCase())
  if (!partner) {
    return { valid: false, error: 'Invalid token' }
  }

  // 5. Verify referer domain (if provided and partner has allowedDomains)
  if (referer && partner.allowedDomains.length > 0) {
    try {
      const refererHost = new URL(referer).hostname
      const domainMatch = partner.allowedDomains.some(
        d => refererHost === d || refererHost.endsWith(`.${d}`),
      )
      if (!domainMatch) {
        return { valid: false, error: `Referer domain not allowed: ${refererHost}` }
      }
    } catch {
      // Malformed referer — skip domain check rather than blocking
    }
  }

  // 6. Verify HMAC-SHA256 signature (timing-safe)
  if (!hmacVerify(encodedPayload, signature, partner.sharedSecret)) {
    return { valid: false, error: 'Invalid signature' }
  }

  // 7. Check expiration
  if (Date.now() > payload.expiresAt) {
    return { valid: false, error: 'Token expired' }
  }

  return { valid: true, payload }
}

// ── Session Token (signed with MYWAY_SECRET) ────────────────────────────────

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours

function getSessionSecret(): string {
  const secret = process.env.MYWAY_SECRET?.trim()
  if (!secret) {
    throw new Error('MYWAY_SECRET is required for partner session tokens')
  }
  return secret
}

/** Create a session token signed with MYWAY_SECRET. */
export function createSessionToken(userId: string, partnerId: string, subdomain?: string): string {
  const now = Date.now()
  const payload: SessionPayload = {
    userId,
    partnerId,
    ...(subdomain ? { subdomain } : {}),
    iat: now,
    exp: now + SESSION_DURATION_MS,
  }
  const encoded = base64urlEncode(JSON.stringify(payload))
  const sig = hmacSign(encoded, getSessionSecret())
  return `${encoded}.${sig}`
}

/** Validate session token. Returns payload or null. */
export function validateSessionToken(token: string): SessionPayload | null {
  const dotIndex = token.indexOf('.')
  if (dotIndex === -1) return null

  const encoded = token.slice(0, dotIndex)
  const sig = token.slice(dotIndex + 1)
  if (!encoded || !sig) return null

  // Verify signature
  if (!hmacVerify(encoded, sig, getSessionSecret())) return null

  // Decode payload
  try {
    const payload: SessionPayload = JSON.parse(base64urlDecode(encoded))
    if (!payload.userId || !payload.partnerId || !payload.exp) return null
    if (Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}
