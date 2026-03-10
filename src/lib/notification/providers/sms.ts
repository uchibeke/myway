/**
 * SMS notification provider — sends via Twilio API.
 */

import type { NotificationMessage, NotificationOptions } from '../types'

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID?.trim() || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim() || ''
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER?.trim() || ''

export async function sendSMS(
  receivers: string[],
  message: NotificationMessage,
  _options: NotificationOptions = {},
): Promise<boolean> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.warn('[notification:sms] Twilio credentials not configured')
    return false
  }

  const content = message.content || message.text || ''
  if (!content) {
    console.error('[notification:sms] SMS must have content')
    return false
  }

  try {
    const results = await Promise.all(
      receivers.map(async (to) => {
        try {
          const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: TWILIO_PHONE_NUMBER,
              To: to,
              Body: content,
            }),
            signal: AbortSignal.timeout(15_000),
          })

          if (!response.ok) {
            const error = await response.text()
            console.error(`[notification:sms] Twilio failed for ${to}:`, response.status, error)
            return false
          }

          const result = await response.json() as { sid: string }
          console.log(`[notification:sms] Sent to ${to}:`, result.sid)
          return true
        } catch (err) {
          console.error(`[notification:sms] Error for ${to}:`, err instanceof Error ? err.message : err)
          return false
        }
      }),
    )

    return results.every(r => r === true)
  } catch (error) {
    console.error('[notification:sms] Error:', error instanceof Error ? error.message : error)
    return false
  }
}
