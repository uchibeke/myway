import { NextRequest, NextResponse } from 'next/server'
import {
  validatePartnerToken,
  createSessionToken,
} from '@/lib/partners'

/**
 * POST /api/partner/auth
 *
 * Exchange a partner HMAC token for a short-lived session token.
 * This endpoint is exempt from auth in middleware (it IS the auth endpoint).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token } = body

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing token', errorCode: 'MISSING_TOKEN' },
        { status: 400 },
      )
    }

    // Reject excessively large tokens (partner tokens should be <2KB)
    if (token.length > 4096) {
      return NextResponse.json(
        { success: false, error: 'Invalid token', errorCode: 'INVALID_TOKEN' },
        { status: 400 },
      )
    }

    // Get referer/origin for domain validation
    const referer = request.headers.get('referer') || request.headers.get('origin') || undefined

    const result = validatePartnerToken(token, referer)

    if (!result.valid || !result.payload) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Invalid token',
          errorCode: 'INVALID_TOKEN',
        },
        { status: 401 },
      )
    }

    const { userId, partnerId } = result.payload
    const sessionToken = createSessionToken(userId, partnerId)

    // Decode session to get expiry for client
    const sessionExp = Date.now() + 15 * 60 * 1000

    return NextResponse.json({
      success: true,
      sessionToken,
      userId,
      partnerId,
      expiresAt: sessionExp,
    })
  } catch (err) {
    console.error('[partner/auth] Token exchange failed:', err)
    return NextResponse.json(
      { success: false, error: 'Internal error', errorCode: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
