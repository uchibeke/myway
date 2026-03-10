/**
 * HTML email template for Myway briefings.
 *
 * Design: monochrome, quiet luxury, functional.
 * Based on proven email deliverability patterns:
 * - CSS reset + <style> block (with inline fallbacks for Gmail)
 * - MSO conditional comments for Outlook
 * - Responsive media queries
 * - System font stack
 * - multipart/alternative MIME (plain text + HTML)
 * - base64 transfer encoding for HTML part
 */

export type BriefingSection = {
  title: string
  items: string[]
  /** Optional callout box (highlight, warning, etc.) */
  callout?: { text: string; style?: 'neutral' | 'highlight' | 'warm' }
}

export type BriefingEmailData = {
  greeting: string
  date: string
  type: 'morning' | 'evening' | 'weekly' | 'update'
  sections: BriefingSection[]
  signoff?: string
}

/**
 * Convert markdown-like content to email-safe HTML.
 * Handles: **bold**, [links](url), `code`, newlines.
 */
function mdToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:13px;font-family:\'SF Mono\',Monaco,\'Cascadia Code\',Consolas,monospace;">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#1f2937;text-decoration:underline;">$1</a>')
    .replace(/\n/g, '<br>')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const HEADER_LABELS: Record<string, string> = {
  morning: 'Morning Brief',
  evening: 'Evening Recap',
  weekly: 'Weekly Review',
  update: 'Quick Update',
}

/**
 * Build a complete briefing HTML email.
 */
export function buildBriefingHtml(data: BriefingEmailData): string {
  const headerLabel = HEADER_LABELS[data.type] || 'Brief'

  const sectionBlocks = data.sections.map((section) => {
    const items = section.items
      .map(
        (item) => `
              <tr>
                <td style="padding:6px 0 6px 0;font-size:15px;line-height:1.6;color:#1f2937;">
                  ${mdToHtml(item)}
                </td>
              </tr>`
      )
      .join('')

    const calloutHtml = section.callout
      ? `<tr><td style="padding:12px 0 4px 0;">
          <div style="padding:14px 16px;background:${section.callout.style === 'highlight' ? '#f8fafc' : section.callout.style === 'warm' ? '#fffbeb' : '#f8fafc'};border:1px solid ${section.callout.style === 'warm' ? '#fde68a' : '#e5e7eb'};border-radius:6px;">
            <p style="margin:0;font-size:14px;line-height:1.5;color:${section.callout.style === 'warm' ? '#92400e' : '#374151'};">
              ${mdToHtml(section.callout.text)}
            </p>
          </div>
        </td></tr>`
      : ''

    return `
            <!-- Section: ${escapeHtml(section.title)} -->
            <tr>
              <td style="padding:24px 0 6px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#9ca3af;">
                ${escapeHtml(section.title)}
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 0 0;border-top:1px solid #f3f4f6;">
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                  ${items}
                  ${calloutHtml}
                </table>
              </td>
            </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>Myway ${headerLabel}</title>

  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->

  <style>
    body, table, td, p, a, li, blockquote {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td {
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    img {
      -ms-interpolation-mode: bicubic;
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
    }
    body {
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      background-color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
    }
    a { color: #1f2937; }
    .email-container { max-width: 560px; margin: 0 auto; }
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-body { padding-left: 20px !important; padding-right: 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.6;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
    <tr>
      <td align="center" style="padding:0;">
        <div class="email-container" style="max-width:560px;margin:0 auto;">

          <!-- Header -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td class="email-body" style="padding:40px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:0 0 24px 0;border-bottom:1px solid #e5e7eb;">
                      <p style="margin:0 0 2px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#9ca3af;">
                        MYWAY &middot; ${escapeHtml(headerLabel.toUpperCase())}
                      </p>
                      <p style="margin:0;font-size:13px;color:#9ca3af;">
                        ${escapeHtml(data.date)}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Content -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td class="email-body" style="padding:24px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <!-- Greeting -->
                  <tr>
                    <td style="padding:0 0 4px 0;">
                      <p style="margin:0;font-size:17px;font-weight:600;color:#111827;line-height:1.4;">
                        ${escapeHtml(data.greeting)}
                      </p>
                    </td>
                  </tr>

                  <!-- Sections -->
                  ${sectionBlocks}
                </table>
              </td>
            </tr>
          </table>

          <!-- Footer -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td class="email-body" style="padding:32px 32px 40px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${data.signoff ? `
                  <tr>
                    <td style="padding:0 0 20px 0;">
                      <p style="margin:0;font-size:15px;color:#374151;line-height:1.5;">
                        ${escapeHtml(data.signoff)}
                      </p>
                    </td>
                  </tr>` : ''}
                  <tr>
                    <td style="padding:20px 0 0 0;border-top:1px solid #e5e7eb;">
                      <p style="margin:0;font-size:12px;color:#9ca3af;">
                        Sent by Myway &middot; Your ambient intelligence layer
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

        </div>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Build the MIME multipart/alternative message (plain text + HTML).
 * Returns a raw RFC 2822 message string (before base64url encoding).
 *
 * Gmail API takes the full RFC 2822 message as base64url, so we use
 * base64 Content-Transfer-Encoding for the HTML part (handles special chars)
 * and 7bit for plain text.
 */
export function buildBriefingMime(opts: {
  to: string
  subject: string
  plainText: string
  html: string
  inReplyTo?: string
  threadId?: string
}): string {
  const boundary = `myway_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

  // Base64-encode the HTML part to handle special characters cleanly
  const htmlBase64 = Buffer.from(opts.html, 'utf-8').toString('base64')
  // Wrap at 76 chars per RFC 2045
  const htmlBase64Wrapped = htmlBase64.match(/.{1,76}/g)?.join('\r\n') ?? htmlBase64

  // RFC 2047 encode subject so non-ASCII chars (em dash, accents, etc.) don't get mangled
  const encodedSubject = `=?UTF-8?B?${Buffer.from(opts.subject, 'utf-8').toString('base64')}?=`

  const headers = [
    `MIME-Version: 1.0`,
    `To: ${opts.to}`,
    `Subject: ${encodedSubject}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`)

  const body = [
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    opts.plainText,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    htmlBase64Wrapped,
    ``,
    `--${boundary}--`,
  ]

  return headers.join('\r\n') + '\r\n\r\n' + body.join('\r\n')
}
