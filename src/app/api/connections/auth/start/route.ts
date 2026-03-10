/**
 * POST /api/connections/auth/start — get OAuth redirect URL
 *
 * Body: { definitionId: 'google-workspace' }
 * Returns: { url: 'https://accounts.google.com/...', connectionId: '...' }
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { startOAuth } from '@/lib/connections/manager'
import { IntegrationNotConfiguredError } from '@/lib/integrations'

export async function POST(req: NextRequest) {
  try {
    const { definitionId } = await req.json()
    if (!definitionId) {
      return Response.json({ error: 'definitionId is required' }, { status: 400 })
    }

    const db = getDb(getTenantId(req))

    // Build redirect URI. Behind a reverse proxy (Cloudflare tunnel, nginx),
    // req.nextUrl.origin may resolve to localhost. Use forwarded headers when
    // available, falling back to req.nextUrl.origin for direct access.
    const forwardedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
    const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'http'
    const requestOrigin = forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : req.nextUrl.origin

    // For hosted deployments, validate against MYWAY_BASE_DOMAIN.
    const baseDomain = process.env.MYWAY_BASE_DOMAIN?.trim()
    if (baseDomain) {
      // Strip port from host header for domain comparison (some proxies include :443)
      const host = (forwardedHost ?? req.nextUrl.host).replace(/:\d+$/, '')
      if (host !== baseDomain && !host.endsWith(`.${baseDomain}`)) {
        return Response.json({ error: 'Invalid request origin' }, { status: 400 })
      }
    }
    const redirectUri = `${requestOrigin}/api/connections/auth/callback`

    const { url, connectionId } = startOAuth(db, definitionId, redirectUri)
    return Response.json({ url, connectionId })
  } catch (e) {
    if (e instanceof IntegrationNotConfiguredError) {
      return Response.json({ error: e.message, hint: e.setupHint }, { status: 400 })
    }
    console.error('[POST /api/connections/auth/start]', e)
    return Response.json({ error: 'Failed to start OAuth flow' }, { status: 500 })
  }
}
