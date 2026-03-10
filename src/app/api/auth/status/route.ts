import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/partners'

/**
 * GET /api/auth/status — Session status check for silent refresh.
 *
 * Returns session expiry info so the client can trigger refresh before expiry.
 * Does NOT require auth (used to check if auth is still valid).
 */
export async function GET(request: NextRequest) {
  const cookieToken = request.cookies.get('myway_session')?.value
  if (!cookieToken) {
    return NextResponse.json({ authenticated: false })
  }

  const session = validateSessionToken(cookieToken)
  if (!session) {
    return NextResponse.json({ authenticated: false })
  }

  const expiresIn = Math.max(0, Math.floor((session.exp - Date.now()) / 1000))
  return NextResponse.json({
    authenticated: true,
    expiresIn,
  })
}
