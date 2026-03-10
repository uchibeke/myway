/**
 * Notification Service — unified multi-channel notification delivery.
 *
 * Channels:
 *   - email: via Resend API
 *   - sms: via Twilio API
 *   - push: TODO (APNs / FCM / Web Push)
 *
 * Usage:
 *   import { notification } from '@/lib/notification'
 *
 *   // Send to a single channel
 *   await notification.send('email', ['user@example.com'], { subject: '...', content: '...' })
 *
 *   // Send briefing (email + sms, uses Myway briefing template)
 *   await notification.sendBriefing(briefingHtml, briefingText, recipient)
 *
 *   // Send to multiple channels
 *   await notification.sendMultiple(['email', 'sms'], receivers, message)
 *
 * SERVER ONLY.
 */

import type {
  NotificationChannel,
  NotificationMessage,
  NotificationOptions,
  NotificationResult,
  NotificationRecipient,
} from './types'
import { sendEmail } from './providers/email'
import { sendSMS } from './providers/sms'
import { sendPush } from './providers/push'
import { buildBriefingHtml, type BriefingEmailData } from '@/lib/connections/email-template'

export type { NotificationChannel, NotificationMessage, NotificationOptions, NotificationResult, NotificationRecipient }

// ─── Core send ──────────────────────────────────────────────────────────────

async function send(
  channel: NotificationChannel,
  receivers: string | string[],
  message: NotificationMessage,
  options: NotificationOptions = {},
): Promise<NotificationResult> {
  const receiversArray = Array.isArray(receivers) ? receivers : [receivers]

  if (receiversArray.length === 0) {
    return { success: false, channel, error: 'No receivers' }
  }

  let success = false
  try {
    switch (channel) {
      case 'email':
        success = await sendEmail(receiversArray, message, options)
        break
      case 'sms':
        success = await sendSMS(receiversArray, message, options)
        break
      case 'push':
        success = await sendPush(receiversArray, message, options)
        break
      default:
        return { success: false, channel, error: `Unsupported channel: ${channel}` }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[notification] ${channel} error:`, error)
    return { success: false, channel, error }
  }

  return { success, channel }
}

// ─── Multi-channel send ─────────────────────────────────────────────────────

async function sendMultiple(
  channels: NotificationChannel[],
  receivers: string | string[],
  message: NotificationMessage,
  options: NotificationOptions = {},
): Promise<NotificationResult[]> {
  const results = await Promise.all(
    channels.map(channel => send(channel, receivers, message, options)),
  )
  return results
}

// ─── Briefing-specific send ─────────────────────────────────────────────────

/**
 * Send a briefing notification to a user via all available channels.
 *
 * Accepts either:
 *   1. Pre-built HTML + plain text (e.g. from existing email.briefing flow)
 *   2. Structured BriefingEmailData — renders via the production Myway briefing
 *      template (table-based, inline styles, Gmail-safe)
 *
 * - Email: full HTML briefing using the Myway email template
 * - SMS: short summary (first line of plain text)
 * - Push: TODO
 *
 * Skips channels where the recipient has no contact info.
 */
async function sendBriefing(
  briefingHtmlOrData: string | BriefingEmailData,
  briefingText: string,
  recipient: NotificationRecipient,
  subject?: string,
): Promise<NotificationResult[]> {
  const results: NotificationResult[] = []

  // Build HTML from structured data if needed (uses production template)
  const html = typeof briefingHtmlOrData === 'string'
    ? briefingHtmlOrData
    : buildBriefingHtml(briefingHtmlOrData)

  const briefSubject = subject || 'Your Morning Brief is ready'

  // Email — full briefing in Myway template
  if (recipient.email) {
    const result = await send('email', recipient.email, {
      subject: briefSubject,
      html,
      text: briefingText,
    })
    results.push(result)
  }

  // SMS — short summary
  if (recipient.phone) {
    const smsContent = briefingText.length > 155
      ? briefingText.slice(0, 155) + '...'
      : briefingText
    const result = await send('sms', recipient.phone, {
      content: `${briefSubject}\n\n${smsContent}`,
    })
    results.push(result)
  }

  // Push — TODO
  // if (recipient has push token) { ... }

  if (results.length === 0) {
    console.warn('[notification] sendBriefing: no contact info for recipient')
  }

  return results
}

// ─── Resolve recipient from DB profile ──────────────────────────────────────

/**
 * Build a NotificationRecipient from the user's profile in the database.
 */
function resolveRecipient(db: import('better-sqlite3').Database): NotificationRecipient {
  const get = (key: string): string | undefined => {
    try {
      const row = db.prepare('SELECT value FROM user_profile WHERE key = ?').get(key) as { value: string } | undefined
      return row?.value || undefined
    } catch { return undefined }
  }

  const getIdentity = (key: string): string | undefined => {
    try {
      const row = db.prepare('SELECT value FROM identity WHERE key = ?').get(key) as { value: string } | undefined
      return row?.value || undefined
    } catch { return undefined }
  }

  return {
    email: get('email'),
    phone: get('phone') || get('phone_number'),
    name: get('name') || getIdentity('user.name'),
    timezone: getIdentity('user.timezone') || get('timezone') || 'UTC',
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const notification = {
  send,
  sendMultiple,
  sendBriefing,
  resolveRecipient,
}
