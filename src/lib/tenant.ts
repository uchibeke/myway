/**
 * Tenant ID extraction from request.
 *
 * Resolution order:
 *   1. X-Myway-User-Id header (set by middleware from validated session)
 *   2. myway_session cookie (direct validation — handles cases where
 *      middleware didn't inject the header, e.g. self-hosted dev with no
 *      hosted env vars but a valid login session)
 *
 * The session cookie IS the login signal: if a valid signed session exists
 * the user is logged in, regardless of isHostedMode() / env vars.
 *
 * Returns undefined for anonymous / self-hosted users without a session,
 * which causes getDb() to use the default singleton database.
 */

import { NextRequest } from 'next/server'

const TENANT_RE = /^[a-zA-Z0-9_-]{1,64}$/

/** Extract tenant ID from header or session cookie. */
export function getTenantId(req: NextRequest): string | undefined {
  // 1. Header injected by middleware (fast path)
  const id = req.headers.get('x-myway-user-id')
  if (id) {
    if (!TENANT_RE.test(id)) throw new Error('Invalid tenant ID')
    return id
  }

  // 2. Fallback: validate session cookie directly.
  //    Covers the case where middleware skipped header injection
  //    (isAuthRequired() false) but user has a valid login session.
  const cookieToken = req.cookies.get('myway_session')?.value
  if (cookieToken?.includes('.')) {
    try {
      // Dynamic import avoids pulling Node crypto into the module graph
      // at parse time (safe here — API routes always run in Node.js).
      const { validateSessionToken } = require('@/lib/partners') as typeof import('@/lib/partners')
      const session = validateSessionToken(cookieToken)
      if (session?.userId) {
        if (!TENANT_RE.test(session.userId)) throw new Error('Invalid tenant ID')
        return session.userId
      }
    } catch {
      // Invalid/expired cookie or missing MYWAY_SECRET — treat as anonymous
    }
  }

  return undefined
}
