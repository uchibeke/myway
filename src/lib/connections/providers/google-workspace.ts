/**
 * Google Workspace provider — Gmail + Google Calendar integration.
 *
 * Implements ConnectionProvider using the googleapis package.
 * Handles OAuth, email sync, calendar sync, and write actions.
 */

import type { Database } from 'better-sqlite3'
import type {
  ConnectionProvider,
  OAuthConfig,
  TokenResponse,
  ConnectionTokens,
  ConnectionAction,
  ConnectionData,
  DataType,
  SyncResult,
  ExecuteResult,
} from '../types'
import { getConnectionData } from '../store'
import { requireIntegration } from '@/lib/integrations'

// ─── Types for incremental calendar sync ─────────────────────────────────────

export type CalendarChangeEvent = {
  id: string
  status: string              // 'confirmed', 'tentative', 'cancelled'
  summary?: string
  description?: string
  location?: string
  updated: string             // RFC3339
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean }[]
  hangoutLink?: string
  conferenceData?: { entryPoints?: { uri?: string }[] }
  recurringEventId?: string
  organizer?: { email?: string }
  htmlLink?: string
}

export type CalendarChangesResult = {
  events: CalendarChangeEvent[]
  nextSyncToken: string | null
  requiresFullSync: boolean
}

// ─── Lazy googleapis import ─────────────────────────────────────────────────
// Only loaded when actually used (avoids startup cost if no Google connection)

function getOAuth2Client(config: OAuthConfig, redirectUri?: string) {
  const { google } = require('googleapis') as typeof import('googleapis')
  requireIntegration('google-workspace')
  const clientId = process.env[config.clientIdEnvVar]!
  const clientSecret = process.env[config.clientSecretEnvVar]!
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

function getAuthedClient(config: OAuthConfig, tokens: ConnectionTokens) {
  const client = getOAuth2Client(config)
  client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  })
  return client
}

// ─── Incremental Calendar Sync ───────────────────────────────────────────────

/**
 * Fetch calendar changes incrementally using Google's syncToken mechanism.
 * Without a syncToken, performs an initial full sync (showDeleted: true) to get one.
 */
export async function listCalendarChanges(
  tokens: ConnectionTokens,
  syncToken?: string | null,
): Promise<CalendarChangesResult> {
  const config: OAuthConfig = {
    scopes: [],
    endpoints: { authorize: '', token: '' },
    clientIdEnvVar: 'GOOGLE_CLIENT_ID',
    clientSecretEnvVar: 'GOOGLE_CLIENT_SECRET',
  }
  const auth = getAuthedClient(config, tokens)
  const { google } = require('googleapis') as typeof import('googleapis')
  const calendar = google.calendar({ version: 'v3', auth })

  try {
    const params: Record<string, unknown> = {
      calendarId: 'primary',
      singleEvents: true,
      maxResults: 250,
    }

    if (syncToken) {
      params.syncToken = syncToken
    } else {
      // Initial full sync — get events from 30 days ago to 60 days ahead
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const sixtyDaysAhead = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      params.timeMin = thirtyDaysAgo.toISOString()
      params.timeMax = sixtyDaysAhead.toISOString()
      params.showDeleted = true
      params.orderBy = 'startTime'
    }

    const events: CalendarChangeEvent[] = []
    let pageToken: string | undefined
    let nextSyncToken: string | null = null

    do {
      if (pageToken) params.pageToken = pageToken

      const res = await calendar.events.list(params)
      const items = res.data.items ?? []

      for (const item of items) {
        if (!item.id) continue
        events.push({
          id: item.id,
          status: item.status ?? 'confirmed',
          summary: item.summary ?? undefined,
          description: item.description ?? undefined,
          location: item.location ?? undefined,
          updated: item.updated ?? new Date().toISOString(),
          start: item.start ? {
            dateTime: item.start.dateTime ?? undefined,
            date: item.start.date ?? undefined,
          } : undefined,
          end: item.end ? {
            dateTime: item.end.dateTime ?? undefined,
            date: item.end.date ?? undefined,
          } : undefined,
          attendees: (item.attendees ?? []).map((a) => ({
            email: a.email ?? undefined,
            displayName: a.displayName ?? undefined,
            responseStatus: a.responseStatus ?? undefined,
            self: a.self ?? undefined,
          })),
          hangoutLink: item.hangoutLink ?? undefined,
          conferenceData: item.conferenceData ? {
            entryPoints: item.conferenceData.entryPoints?.map((ep) => ({
              uri: ep.uri ?? undefined,
            })),
          } : undefined,
          recurringEventId: item.recurringEventId ?? undefined,
          organizer: item.organizer ? { email: item.organizer.email ?? undefined } : undefined,
          htmlLink: item.htmlLink ?? undefined,
        })
      }

      pageToken = res.data.nextPageToken ?? undefined
      if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken
    } while (pageToken)

    return { events, nextSyncToken, requiresFullSync: false }
  } catch (e: unknown) {
    // 410 Gone = syncToken invalidated, need full re-sync
    if (e && typeof e === 'object' && 'code' in e && (e as { code: number }).code === 410) {
      return { events: [], nextSyncToken: null, requiresFullSync: true }
    }
    throw e
  }
}

/**
 * PATCH a single calendar event with only the changed fields.
 * Returns the event's new `updated` timestamp (RFC3339).
 */
export async function patchCalendarEvent(
  tokens: ConnectionTokens,
  eventId: string,
  fields: { title?: string; start?: string; end?: string; description?: string; location?: string },
): Promise<string> {
  const config: OAuthConfig = {
    scopes: [],
    endpoints: { authorize: '', token: '' },
    clientIdEnvVar: 'GOOGLE_CLIENT_ID',
    clientSecretEnvVar: 'GOOGLE_CLIENT_SECRET',
  }
  const auth = getAuthedClient(config, tokens)
  const { google } = require('googleapis') as typeof import('googleapis')
  const calendar = google.calendar({ version: 'v3', auth })

  const requestBody: Record<string, unknown> = {}
  if (fields.title !== undefined) requestBody.summary = fields.title
  if (fields.description !== undefined) requestBody.description = fields.description
  if (fields.location !== undefined) requestBody.location = fields.location
  if (fields.start !== undefined) {
    const isAllDay = !fields.start.includes('T')
    requestBody.start = isAllDay ? { date: fields.start } : { dateTime: fields.start }
  }
  if (fields.end !== undefined) {
    const isAllDay = !fields.end.includes('T')
    requestBody.end = isAllDay ? { date: fields.end } : { dateTime: fields.end }
  }

  const res = await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody,
  })

  return res.data.updated ?? new Date().toISOString()
}

// ─── Provider Implementation ────────────────────────────────────────────────

export const googleWorkspaceProvider: ConnectionProvider = {
  getAuthUrl(config, redirectUri, state) {
    const client = getOAuth2Client(config, redirectUri)
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: config.scopes,
      state: state ?? undefined,
    })
  },

  async exchangeCode(config, code, redirectUri) {
    const client = getOAuth2Client(config, redirectUri)
    const { tokens } = await client.getToken(code)

    return {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token ?? undefined,
      tokenType: tokens.token_type ?? 'Bearer',
      expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : undefined,
      scopes: tokens.scope ?? undefined,
      raw: JSON.stringify(tokens),
    }
  },

  async refreshTokens(config, refreshToken) {
    const client = getOAuth2Client(config)
    client.setCredentials({ refresh_token: refreshToken })
    const { credentials } = await client.refreshAccessToken()

    return {
      accessToken: credentials.access_token!,
      refreshToken: credentials.refresh_token ?? refreshToken,
      tokenType: credentials.token_type ?? 'Bearer',
      expiresAt: credentials.expiry_date ? Math.floor(credentials.expiry_date / 1000) : undefined,
      scopes: credentials.scope ?? undefined,
      raw: JSON.stringify(credentials),
    }
  },

  async sync(db, connectionId, tokens, cursor) {
    const config: OAuthConfig = {
      scopes: [],
      endpoints: { authorize: '', token: '' },
      clientIdEnvVar: 'GOOGLE_CLIENT_ID',
      clientSecretEnvVar: 'GOOGLE_CLIENT_SECRET',
    }
    const auth = getAuthedClient(config, tokens)
    const { google } = require('googleapis') as typeof import('googleapis')

    const items: SyncResult['items'] = []
    const errors: string[] = []

    // ── Sync emails ──────────────────────────────────────────────────────
    try {
      const gmail = google.gmail({ version: 'v1', auth })
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread',
        maxResults: 20,
      })

      const messageIds = listRes.data.messages ?? []
      for (const msg of messageIds) {
        try {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date'],
          })

          const headers = detail.data.payload?.headers ?? []
          const subject = headers.find((h) => h.name === 'Subject')?.value ?? '(no subject)'
          const from = headers.find((h) => h.name === 'From')?.value ?? 'unknown'
          const dateStr = headers.find((h) => h.name === 'Date')?.value
          const occurredAt = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : Math.floor(Date.now() / 1000)
          const snippet = detail.data.snippet ?? ''

          items.push({
            id: msg.id!,
            connectionId,
            dataType: 'email',
            title: subject,
            summary: snippet,
            content: null,
            metadata: {
              from,
              threadId: msg.threadId,
              labelIds: detail.data.labelIds ?? [],
            },
            externalUrl: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
            occurredAt,
            isRead: false,
            isActionable: true,
            actionStatus: 'pending',
          })
        } catch (e) {
          errors.push(`Failed to fetch email ${msg.id}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } catch (e) {
      errors.push(`Gmail sync failed: ${e instanceof Error ? e.message : String(e)}`)
    }

    // ── Sync calendar ────────────────────────────────────────────────────
    try {
      const calendar = google.calendar({ version: 'v3', auth })
      const now = new Date()
      const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

      const eventsRes = await calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: twoWeeksLater.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      })

      for (const event of eventsRes.data.items ?? []) {
        if (!event.id) continue

        const startTime = event.start?.dateTime ?? event.start?.date
        const endTime = event.end?.dateTime ?? event.end?.date
        const isAllDay = !event.start?.dateTime
        const occurredAt = startTime ? Math.floor(new Date(startTime).getTime() / 1000) : null

        items.push({
          id: event.id,
          connectionId,
          dataType: 'calendar_event',
          title: event.summary ?? '(no title)',
          summary: event.description?.slice(0, 200) ?? null,
          content: event.description ?? null,
          metadata: {
            location: event.location ?? null,
            startTime,
            endTime,
            isAllDay,
            attendees: (event.attendees ?? []).map((a) => ({
              email: a.email,
              displayName: a.displayName,
              responseStatus: a.responseStatus,
            })),
            hangoutLink: event.hangoutLink ?? null,
            conferenceLink: event.conferenceData?.entryPoints?.[0]?.uri ?? null,
            recurringEventId: event.recurringEventId ?? null,
            status: event.status,
            organizer: event.organizer?.email ?? null,
          },
          externalUrl: event.htmlLink ?? null,
          occurredAt,
          isRead: false,
          isActionable: false,
          actionStatus: 'pending',
        })
      }
    } catch (e) {
      errors.push(`Calendar sync failed: ${e instanceof Error ? e.message : String(e)}`)
    }

    return { items, errors: errors.length > 0 ? errors : undefined }
  },

  async execute(tokens, action) {
    const config: OAuthConfig = {
      scopes: [],
      endpoints: { authorize: '', token: '' },
      clientIdEnvVar: 'GOOGLE_CLIENT_ID',
      clientSecretEnvVar: 'GOOGLE_CLIENT_SECRET',
    }
    const auth = getAuthedClient(config, tokens)
    const { google } = require('googleapis') as typeof import('googleapis')

    switch (action.actionType) {
      case 'email.send': {
        const gmail = google.gmail({ version: 'v1', auth })
        const { to, subject, body, html, inReplyTo, threadId } = action.payload as {
          to: string; subject: string; body: string; html?: string; inReplyTo?: string; threadId?: string
        }

        let raw: string
        if (html) {
          // Multipart/alternative: plain text + HTML
          const { buildBriefingMime } = require('../email-template') as typeof import('../email-template')
          const mime = buildBriefingMime({ to, subject, plainText: body, html, inReplyTo })
          raw = Buffer.from(mime).toString('base64url')
        } else {
          const headers = [
            `To: ${to}`,
            `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`,
            'Content-Type: text/plain; charset=utf-8',
          ]
          if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`)
          raw = Buffer.from(headers.join('\r\n') + '\r\n\r\n' + body).toString('base64url')
        }

        const res = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw, threadId: threadId ?? undefined },
        })

        return { success: true, externalId: res.data.id ?? undefined }
      }

      case 'email.briefing': {
        // Auto-approved briefing email — resolves user's own email and sends
        const gmail = google.gmail({ version: 'v1', auth })
        const { subject, body, html } = action.payload as {
          subject: string; body: string; html?: string
        }

        // Get the authenticated user's email address
        const profile = await gmail.users.getProfile({ userId: 'me' })
        const userEmail = profile.data.emailAddress
        if (!userEmail) return { success: false, error: 'Could not resolve user email' }

        let raw: string
        if (html) {
          const { buildBriefingMime } = require('../email-template') as typeof import('../email-template')
          const mime = buildBriefingMime({ to: userEmail, subject, plainText: body, html })
          raw = Buffer.from(mime).toString('base64url')
        } else {
          const headers = [
            `To: ${userEmail}`,
            `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`,
            'Content-Type: text/plain; charset=utf-8',
          ]
          raw = Buffer.from(headers.join('\r\n') + '\r\n\r\n' + body).toString('base64url')
        }

        const res = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw },
        })

        return { success: true, externalId: res.data.id ?? undefined }
      }

      case 'email.draft': {
        const gmail = google.gmail({ version: 'v1', auth })
        const { to, subject, body } = action.payload as { to: string; subject: string; body: string }

        const raw = Buffer.from(
          `To: ${to}\r\nSubject: =?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
        ).toString('base64url')

        const res = await gmail.users.drafts.create({
          userId: 'me',
          requestBody: { message: { raw } },
        })

        return { success: true, externalId: res.data.id ?? undefined }
      }

      case 'calendar.create': {
        const calendar = google.calendar({ version: 'v3', auth })
        const { title, start, end, attendees, description, location } = action.payload as {
          title: string; start: string; end: string; attendees?: string[]
          description?: string; location?: string
        }

        const isAllDay = !start.includes('T')
        const event: Record<string, unknown> = {
          summary: title,
          description,
          location,
        }

        if (isAllDay) {
          event.start = { date: start }
          event.end = { date: end }
        } else {
          event.start = { dateTime: start }
          event.end = { dateTime: end }
        }

        if (attendees?.length) {
          event.attendees = attendees.map((email) => ({ email }))
        }

        const res = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: event,
        })

        return { success: true, externalId: res.data.id ?? undefined }
      }

      case 'calendar.respond': {
        const calendar = google.calendar({ version: 'v3', auth })
        const { eventId, response } = action.payload as { eventId: string; response: 'accept' | 'decline' | 'tentative' }

        // Get current event, update self's responseStatus
        const event = await calendar.events.get({ calendarId: 'primary', eventId })
        const attendees = event.data.attendees ?? []
        // Find self (organizer email as fallback)
        for (const a of attendees) {
          if (a.self) {
            a.responseStatus = response === 'accept' ? 'accepted' : response === 'decline' ? 'declined' : 'tentative'
          }
        }

        await calendar.events.patch({
          calendarId: 'primary',
          eventId,
          requestBody: { attendees },
        })

        return { success: true, externalId: eventId }
      }

      case 'calendar.update': {
        const { eventId, title, start, end, description, location } = action.payload as {
          eventId: string; title?: string; start?: string; end?: string; description?: string; location?: string
        }
        const updated = await patchCalendarEvent(tokens, eventId, { title, start, end, description, location })
        return { success: true, externalId: eventId }
      }

      default:
        return { success: false, error: `Unknown action type: ${action.actionType}` }
    }
  },

  buildContext(db, connectionId, dataType, opts = {}) {
    const { limit = 10, daysAhead = 2, tz = 'UTC' } = opts

    if (dataType === 'email') {
      return buildEmailContextFromDb(db, connectionId, limit)
    }
    if (dataType === 'calendar_event') {
      return buildCalendarContextFromDb(db, connectionId, daysAhead, tz)
    }
    return null
  },
}

// ─── Context builders ───────────────────────────────────────────────────────

function buildEmailContextFromDb(db: Database, connectionId: string, limit: number): string | null {
  const emails = getConnectionData(db, { dataType: 'email', connectionId, isRead: false, limit })
  if (emails.length === 0) return null

  const lines = [`**${emails.length} unread email${emails.length !== 1 ? 's' : ''}:**`]
  for (const e of emails) {
    const from = (e.metadata.from as string) ?? 'unknown'
    const shortFrom = from.includes('<') ? from.split('<')[0].trim() : from
    const ago = formatTimeAgo(e.occurredAt)
    lines.push(`- [${e.title}](${e.externalUrl ?? '#'}) from ${shortFrom} — ${e.summary?.slice(0, 80) ?? 'no preview'}${ago ? ` (${ago})` : ''}`)
  }
  lines.push('> When referencing emails, use the provided links. To draft a reply, use a `<myway:connection>` action block.')
  return lines.join('\n')
}

function buildCalendarContextFromDb(db: Database, connectionId: string, daysAhead: number, tz: string): string | null {
  const now = Math.floor(Date.now() / 1000)
  const until = now + daysAhead * 86400

  const events = db.prepare(`
    SELECT * FROM connection_data
    WHERE data_type = 'calendar_event'
      AND connection_id = ?
      AND occurred_at >= ?
      AND occurred_at <= ?
    ORDER BY occurred_at ASC
    LIMIT 30
  `).all(connectionId, now, until) as Record<string, unknown>[]

  if (events.length === 0) return null

  const parsed = events.map((row) => {
    let metadata: Record<string, unknown> = {}
    try { metadata = JSON.parse(row.metadata as string) } catch { /* empty */ }
    return {
      title: row.title as string,
      occurredAt: row.occurred_at as number,
      metadata,
      externalUrl: row.external_url as string | null,
    }
  })

  const label = daysAhead <= 1 ? "Today's schedule" : `Next ${daysAhead} days`
  const lines = [`**${label}:**`]

  for (const evt of parsed) {
    const time = formatEventTime(evt.occurredAt, evt.metadata, tz)
    const location = evt.metadata.location ? ` (${evt.metadata.location})` : ''
    const link = evt.metadata.hangoutLink ?? evt.metadata.conferenceLink
    const meetingLink = link ? ` — [Join](${link})` : ''
    lines.push(`- ${time} — ${evt.title}${location}${meetingLink}`)
  }
  lines.push('> When referencing events, include times. To create events, use a `<myway:connection>` action block.')
  return lines.join('\n')
}

function formatTimeAgo(epochSeconds: number | null): string | null {
  if (!epochSeconds) return null
  const diff = Math.floor(Date.now() / 1000) - epochSeconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function formatEventTime(epochSeconds: number, metadata: Record<string, unknown>, tz: string): string {
  const isAllDay = metadata.isAllDay as boolean
  if (isAllDay) return 'All day'

  const dt = new Date(epochSeconds * 1000)
  return dt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  })
}
