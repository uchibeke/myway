/**
 * POST /api/plan/checkout — Initiate platform plan upgrade via AppRoom + Stripe.
 *
 * Called from the QuotaExceeded component when a free-tier user hits their
 * spend limit and clicks "Upgrade to Personal". Proxies to AppRoom's
 * /api/plan/checkout which creates a Stripe subscription checkout session.
 *
 * Body: { annual? }
 * Returns: { checkoutUrl } or { error }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { logAuthEvent } from '@/lib/auth-audit'

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-myway-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({})) as { annual?: boolean }

    const appRoomUrl = process.env.MYWAY_APPROOM_URL?.trim()
    const secret = process.env.MYWAY_PARTNER_APPROOM_SECRET?.trim()

    if (!appRoomUrl || !secret) {
      return NextResponse.json({ error: 'AppRoom integration not configured' }, { status: 503 })
    }

    // Build return URLs pointing back to Myway
    const mywayUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin
    const successUrl = `${mywayUrl}/?plan=activated`
    const cancelUrl = `${mywayUrl}/?plan=cancelled`

    const payload = JSON.stringify({
      userId,
      successUrl,
      cancelUrl,
      annual: body.annual ?? false,
    })

    const signature = createHmac('sha256', secret).update(payload).digest('hex')

    const res = await fetch(`${appRoomUrl}/api/plan/checkout`, {
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
      console.error(`[plan/checkout] AppRoom returned ${res.status}: ${text.slice(0, 200)}`)
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
      event: 'plan_upgrade_checkout',
      userId,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      detail: `plan=personal annual=${body.annual ?? false}`,
    })

    return NextResponse.json({ checkoutUrl: data.checkoutUrl })
  } catch (err) {
    console.error('[plan/checkout] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
