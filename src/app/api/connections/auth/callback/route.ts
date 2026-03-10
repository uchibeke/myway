/**
 * GET /api/connections/auth/callback — handle OAuth callback
 *
 * Google redirects here with ?code=...&state=... after user approves.
 * Exchanges the code for tokens, stores them, triggers initial sync.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { handleOAuthCallback, verifyOAuthState } from '@/lib/connections/manager'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const error = req.nextUrl.searchParams.get('error')

  if (error) {
    return Response.json({ error: 'OAuth authorization failed' }, { status: 400 })
  }

  if (!code || !state) {
    return Response.json({ error: 'Missing code or state parameter' }, { status: 400 })
  }

  // Verify CSRF nonce in state parameter
  const connectionId = verifyOAuthState(state)
  if (!connectionId) {
    return Response.json({ error: 'Invalid OAuth state' }, { status: 403 })
  }

  try {
    const db = getDb(getTenantId(req))

    // Reconstruct redirect URI — must match what auth/start sent to Google.
    // Behind a reverse proxy, req.nextUrl.origin may be localhost.
    const forwardedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
    const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'http'
    const callbackOrigin = forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : req.nextUrl.origin
    const redirectUri = `${callbackOrigin}/api/connections/auth/callback`

    await handleOAuthCallback(db, connectionId, code, redirectUri)

    // Redirect to settings app with success indicator
    return NextResponse.redirect(new URL('/apps/settings?status=connected', callbackOrigin))
  } catch {
    return Response.json({ error: 'Failed to complete OAuth' }, { status: 500 })
  }
}
