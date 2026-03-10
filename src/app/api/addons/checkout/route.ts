/**
 * POST /api/addons/checkout — Initiate addon purchase via AppRoom + Stripe.
 *
 * Called from the QuotaExceeded component when a user clicks "Buy more actions".
 * Proxies the checkout request to AppRoom, which creates a Stripe one-time
 * payment session and returns the checkout URL.
 *
 * Body: { appId, outcomeId, quantity }
 * Returns: { checkoutUrl } or { error }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, randomUUID } from 'crypto'
import { logAuthEvent } from '@/lib/auth-audit'

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-myway-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await req.json()
    const { appId, outcomeId, quantity } = body as {
      appId: string
      outcomeId: string
      quantity: number
    }

    if (!appId || !outcomeId || !quantity || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      return NextResponse.json({ error: 'Invalid request: appId, outcomeId, and quantity (1-1000) required' }, { status: 400 })
    }

    // Validate ID formats to prevent URL injection in success/cancel URLs
    const idPattern = /^[a-zA-Z0-9_-]{1,64}$/
    if (!idPattern.test(appId) || !idPattern.test(outcomeId)) {
      return NextResponse.json({ error: 'Invalid appId or outcomeId format' }, { status: 400 })
    }

    const appRoomUrl = process.env.MYWAY_APPROOM_URL?.trim()
    const secret = process.env.MYWAY_PARTNER_APPROOM_SECRET?.trim()

    if (!appRoomUrl || !secret) {
      return NextResponse.json({ error: 'AppRoom integration not configured' }, { status: 503 })
    }

    // Build the success/cancel URLs pointing back to Myway
    const mywayUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin
    const successUrl = `${mywayUrl}/apps/${appId}?addon=success`
    const cancelUrl = `${mywayUrl}/apps/${appId}?addon=cancelled`

    // Request ID for Stripe idempotency — unique per user-initiated checkout attempt
    const requestId = randomUUID()

    const payload = JSON.stringify({
      userId,
      appId,
      outcomeId,
      quantity,
      successUrl,
      cancelUrl,
      instanceId: process.env.MYWAY_INSTANCE_ID || 'default',
      requestId,
    })

    const signature = createHmac('sha256', secret).update(payload).digest('hex')

    const res = await fetch(`${appRoomUrl}/api/addons/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Myway-Signature': signature,
        'X-Myway-Instance': process.env.MYWAY_INSTANCE_ID || 'default',
      },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[addons/checkout] AppRoom returned ${res.status}: ${text.slice(0, 200)}`)
      return NextResponse.json(
        { error: 'Failed to create checkout session' },
        { status: res.status >= 500 ? 502 : res.status },
      )
    }

    const data = await res.json() as { checkoutUrl?: string }
    if (!data.checkoutUrl) {
      return NextResponse.json({ error: 'No checkout URL returned' }, { status: 502 })
    }

    logAuthEvent({
      event: 'addon_checkout',
      userId,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      detail: `appId=${appId} outcomeId=${outcomeId} quantity=${quantity}`,
    })

    return NextResponse.json({ checkoutUrl: data.checkoutUrl })
  } catch (err) {
    console.error('[addons/checkout] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
