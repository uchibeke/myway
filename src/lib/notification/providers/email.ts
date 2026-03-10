/**
 * Email notification provider — sends via Resend API.
 *
 * Template follows email best practices to avoid Gmail clipping:
 *   - Table-based layout (not div) — universal client support
 *   - ALL styles inline (Gmail strips <style> blocks)
 *   - role="presentation" on layout tables
 *   - MSO conditional comments for Outlook
 *   - x-apple-disable-message-reformatting meta
 *   - Compact HTML — stays well under Gmail's ~102KB clip threshold
 *   - multipart: Resend auto-generates plain text fallback from HTML
 *
 * SERVER ONLY.
 */

import type { NotificationMessage, NotificationOptions } from '../types'

const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim() || ''
const MAIL_DOMAIN = process.env.MAIL_DOMAIN?.trim() || 'mail.myway.sh'
const APP_NAME = 'Myway'

export async function sendEmail(
  receivers: string[],
  message: NotificationMessage,
  options: NotificationOptions = {},
): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.warn('[notification:email] RESEND_API_KEY not configured')
    return false
  }

  if (!message.subject) {
    console.error('[notification:email] Email must have a subject')
    return false
  }

  // If caller provides pre-built HTML (e.g. briefing template), use it directly.
  // Otherwise, wrap plain text/content in our email template.
  const html = message.html || wrapInTemplate(message.text || message.content || '', message.subject)
  const text = message.text || message.content || stripHtml(message.html || '')

  if (!html && !text) {
    console.error('[notification:email] Email must have content')
    return false
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: options.from || `${APP_NAME} <noreply@${MAIL_DOMAIN}>`,
        to: receivers,
        subject: message.subject,
        html,
        text,
        reply_to: options.replyTo,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('[notification:email] Resend failed:', response.status, error)
      return false
    }

    const result = await response.json() as { id: string }
    console.log('[notification:email] Sent:', result.id)
    return true
  } catch (error) {
    console.error('[notification:email] Error:', error instanceof Error ? error.message : error)
    return false
  }
}

// ─── Email template ─────────────────────────────────────────────────────────
// Table-based, all inline styles, Gmail-safe. Mirrors the existing
// production briefing template at src/lib/connections/email-template.ts
// but generalized for any notification content.

function wrapInTemplate(content: string, title: string): string {
  const escapedTitle = esc(title)
  const year = new Date().getFullYear()

  // Convert newlines to <br> and basic markdown bold
  const htmlContent = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#1f2937;text-decoration:underline;">$1</a>')
    .replace(/\n/g, '<br>')

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<title>${escapedTitle}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.6;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
<tr>
<td align="center" style="padding:0;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;margin:0 auto;">

<!-- Header -->
<tr>
<td style="padding:40px 32px 0 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:0 0 24px 0;border-bottom:1px solid #e5e7eb;">
<p style="margin:0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#9ca3af;">MYWAY</p>
</td>
</tr>
</table>
</td>
</tr>

<!-- Content -->
<tr>
<td style="padding:24px 32px 0 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:0 0 4px 0;">
<p style="margin:0 0 4px 0;font-size:17px;font-weight:600;color:#111827;line-height:1.4;">${escapedTitle}</p>
</td>
</tr>
<tr>
<td style="padding:12px 0 0 0;">
<p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${htmlContent}</p>
</td>
</tr>
</table>
</td>
</tr>

<!-- Footer -->
<tr>
<td style="padding:32px 32px 40px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:20px 0 0 0;border-top:1px solid #e5e7eb;">
<p style="margin:0;font-size:12px;color:#9ca3af;">Sent by Myway &middot; &copy; ${year}</p>
</td>
</tr>
</table>
</td>
</tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>`
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&middot;/g, '-').replace(/&copy;/g, '(c)').trim()
}
