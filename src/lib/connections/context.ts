/**
 * Connection context builders — server-side utilities for system prompt injection.
 *
 * Follows the same pattern as recipes.ts:buildRecipeContext() and
 * notes-context.ts:buildNotesContext(). Returns null if no data exists.
 *
 * SERVER ONLY — never import in client components.
 */

import type { Database } from 'better-sqlite3'
import type { ConnectionData, DataType } from './types'

// ─── Email Context ──────────────────────────────────────────────────────────

/**
 * Build email context for system prompt injection.
 * Returns null if no Google connection or no unread emails.
 */
export function buildEmailContext(db: Database, limit = 10): string | null {
  let rows: Record<string, unknown>[]
  try {
    rows = db.prepare(`
      SELECT * FROM connection_data
      WHERE data_type = 'email' AND is_read = 0
      ORDER BY occurred_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[]
  } catch {
    return null
  }

  if (rows.length === 0) return null

  const lines = [`**Email (Gmail) — ${rows.length} unread:**`]
  for (const row of rows) {
    let metadata: Record<string, unknown> = {}
    try { metadata = JSON.parse(row.metadata as string) } catch { /* empty */ }

    const title = row.title as string
    const from = (metadata.from as string) ?? 'unknown'
    const shortFrom = from.includes('<') ? from.split('<')[0].trim() : from
    const summary = (row.summary as string)?.slice(0, 80) ?? ''
    const url = row.external_url as string | null
    const ago = formatTimeAgo(row.occurred_at as number | null)

    const link = url ? `[${title}](${url})` : title
    lines.push(`- ${link} from ${shortFrom} — ${summary}${ago ? ` (${ago})` : ''}`)
  }
  lines.push('> When referencing emails, use the provided links. To draft a reply, use a `<myway:connection>` action block.')
  return lines.join('\n')
}

// ─── Calendar Context ───────────────────────────────────────────────────────

/**
 * Build calendar context for system prompt injection.
 * Returns null if no Google connection or no upcoming events.
 */
export function buildCalendarContext(db: Database, daysAhead = 2, tz = 'UTC'): string | null {
  const now = Math.floor(Date.now() / 1000)
  const until = now + daysAhead * 86400

  let rows: Record<string, unknown>[]
  try {
    rows = db.prepare(`
      SELECT * FROM connection_data
      WHERE data_type = 'calendar_event'
        AND occurred_at >= ?
        AND occurred_at <= ?
      ORDER BY occurred_at ASC
      LIMIT 30
    `).all(now, until) as Record<string, unknown>[]
  } catch {
    return null
  }

  if (rows.length === 0) return null

  const label = daysAhead <= 1 ? "Today's schedule" : `Schedule (next ${daysAhead} days)`
  const lines = [`**Calendar — ${label}:**`]

  for (const row of rows) {
    let metadata: Record<string, unknown> = {}
    try { metadata = JSON.parse(row.metadata as string) } catch { /* empty */ }

    const title = row.title as string
    const isAllDay = metadata.isAllDay as boolean
    const occurredAt = row.occurred_at as number
    const location = metadata.location ? ` (${metadata.location})` : ''
    const url = row.external_url as string | null

    const meetLink = (metadata.hangoutLink as string) ?? (metadata.conferenceLink as string)
    const meetingLink = meetLink ? ` — [Join](${meetLink})` : ''

    const time = isAllDay ? 'All day' : formatEventTime(occurredAt, tz)
    const linkText = url ? `[${title}](${url})` : title
    lines.push(`- ${time} — ${linkText}${location}${meetingLink}`)
  }
  lines.push('> When referencing events, include times. To create events, use a `<myway:connection>` action block.')
  return lines.join('\n')
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTimeAgo(epochSeconds: number | null): string | null {
  if (!epochSeconds) return null
  const diff = Math.floor(Date.now() / 1000) - epochSeconds
  if (diff < 0) return null
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function formatEventTime(epochSeconds: number, tz: string): string {
  const dt = new Date(epochSeconds * 1000)
  return dt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  })
}
