/**
 * Push notification provider — mobile + web push.
 *
 * TODO: Implement push notification delivery.
 * Will support:
 *   - iOS: APNs
 *   - Android: Firebase Cloud Messaging (FCM)
 *   - Web: Web Push API (VAPID)
 *
 * For now, logs the notification and returns false.
 */

import type { NotificationMessage, NotificationOptions } from '../types'

export async function sendPush(
  _receivers: string[],
  message: NotificationMessage,
  _options: NotificationOptions = {},
): Promise<boolean> {
  // TODO: Implement push notification delivery
  console.log('[notification:push] TODO — Push notification not yet implemented:', {
    subject: message.subject,
    content: message.content?.slice(0, 80),
  })
  return false
}
