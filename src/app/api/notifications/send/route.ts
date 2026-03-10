/**
 * POST /api/notifications/send — send external notification (email, sms, push).
 *
 * Used by:
 *   - Cron engine (after generating briefing)
 *   - Admin panel (test notifications)
 *   - Internal services
 *
 * Body:
 *   { channel: 'email' | 'sms' | 'push', to: string[], message: { subject?, content?, html? } }
 *   OR
 *   { type: 'briefing', subject?, html?, text? }  — sends to user's profile email/phone
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { notification } from '@/lib/notification'
import type { NotificationChannel } from '@/lib/notification'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getDb(getTenantId(req))

  // Briefing mode — resolve recipient from profile, send via all channels
  if (body.type === 'briefing') {
    const recipient = notification.resolveRecipient(db)

    if (!recipient.email && !recipient.phone) {
      return Response.json(
        { error: 'No email or phone in user profile — cannot deliver briefing' },
        { status: 422 },
      )
    }

    const html = (body.html as string) || ''
    const text = (body.text as string) || ''
    const subject = (body.subject as string) || undefined

    const results = await notification.sendBriefing(html, text, recipient, subject)
    return Response.json({
      results: results.map(r => ({ channel: r.channel, success: r.success, error: r.error })),
      recipient: { email: recipient.email ? '***' : null, phone: recipient.phone ? '***' : null },
    })
  }

  // Direct channel mode
  const channel = body.channel as NotificationChannel
  if (!channel || !['email', 'sms', 'push'].includes(channel)) {
    return Response.json({ error: 'channel must be email, sms, or push' }, { status: 400 })
  }

  const to = body.to as string | string[]
  if (!to || (Array.isArray(to) && to.length === 0)) {
    return Response.json({ error: 'to is required' }, { status: 400 })
  }

  const message = (body.message as Record<string, string>) || {}
  if (!message.subject && !message.content && !message.html && !message.text) {
    return Response.json({ error: 'message must have subject, content, html, or text' }, { status: 400 })
  }

  const result = await notification.send(channel, to, message)
  return Response.json(result)
}
