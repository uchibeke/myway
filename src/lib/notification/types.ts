/**
 * Notification service types.
 */

export type NotificationChannel = 'email' | 'sms' | 'push'

export interface NotificationMessage {
  // Email
  subject?: string
  html?: string
  text?: string

  // SMS / Push
  content?: string

  // Common
  metadata?: Record<string, string>
}

export interface NotificationOptions {
  from?: string
  replyTo?: string
  priority?: 'low' | 'normal' | 'high'
}

export type NotificationResult = {
  success: boolean
  channel: NotificationChannel
  error?: string
}

/** User contact info resolved from profile. */
export type NotificationRecipient = {
  email?: string
  phone?: string
  name?: string
  timezone?: string
}
