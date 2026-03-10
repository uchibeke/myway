/**
 * Briefings store — structured archive of all sent briefings (morning, evening, weekly, update).
 *
 * Each briefing captures the full structured sections data at time of send,
 * enabling historical lookup, dedup, and rollup queries.
 */

import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { startOfDayInTz, getUserTimezone } from '@/lib/timezone'

// ── Types ────────────────────────────────────────────────────────────────────

export type BriefingType = 'morning' | 'evening' | 'weekly' | 'update'

export type BriefingSection = {
  title: string
  items: string[]
  callout?: { text: string; style?: 'neutral' | 'highlight' | 'warm' }
}

export type Briefing = {
  id: string
  type: BriefingType
  subject: string
  greeting: string | null
  dateLabel: string | null
  sections: BriefingSection[]
  signoff: string | null
  sentTo: string
  externalId: string | null
  metadata: Record<string, unknown>
  sentAt: number
  createdAt: number
}

export type AddBriefingOpts = {
  type: BriefingType
  subject: string
  greeting?: string
  dateLabel?: string
  sections: BriefingSection[]
  signoff?: string
  sentTo: string
  externalId?: string
  metadata?: Record<string, unknown>
}

// ── Internal ─────────────────────────────────────────────────────────────────

interface RawBriefing {
  id: string
  type: string
  subject: string
  greeting: string | null
  date_label: string | null
  sections: string
  signoff: string | null
  sent_to: string
  external_id: string | null
  metadata: string
  sent_at: number
  created_at: number
}

function toBriefing(r: RawBriefing): Briefing {
  return {
    id: r.id,
    type: r.type as BriefingType,
    subject: r.subject,
    greeting: r.greeting,
    dateLabel: r.date_label,
    sections: JSON.parse(r.sections ?? '[]'),
    signoff: r.signoff,
    sentTo: r.sent_to,
    externalId: r.external_id,
    metadata: JSON.parse(r.metadata ?? '{}'),
    sentAt: r.sent_at,
    createdAt: r.created_at,
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Get a single briefing by ID. */
export function getBriefing(db: Database, id: string): Briefing | null {
  const row = db.prepare(
    'SELECT * FROM briefings WHERE id = ? AND is_deleted = 0'
  ).get(id) as RawBriefing | undefined
  return row ? toBriefing(row) : null
}

/** List briefings, newest first. Optionally filter by type. */
export function listBriefings(
  db: Database,
  opts?: { type?: BriefingType; limit?: number; offset?: number },
): Briefing[] {
  const limit = opts?.limit ?? 20
  const offset = opts?.offset ?? 0

  if (opts?.type) {
    const rows = db.prepare(`
      SELECT * FROM briefings
      WHERE type = ? AND is_deleted = 0
      ORDER BY sent_at DESC
      LIMIT ? OFFSET ?
    `).all(opts.type, limit, offset) as RawBriefing[]
    return rows.map(toBriefing)
  }

  const rows = db.prepare(`
    SELECT * FROM briefings
    WHERE is_deleted = 0
    ORDER BY sent_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as RawBriefing[]
  return rows.map(toBriefing)
}

/** Get the most recent briefing of a given type. */
export function getLatestBriefing(db: Database, type: BriefingType): Briefing | null {
  const row = db.prepare(`
    SELECT * FROM briefings
    WHERE type = ? AND is_deleted = 0
    ORDER BY sent_at DESC
    LIMIT 1
  `).get(type) as RawBriefing | undefined
  return row ? toBriefing(row) : null
}

/**
 * Check if a briefing of the given type was already sent today.
 * Used for dedup — prevents duplicate morning/evening/weekly briefs.
 */
export function hasTodaysBriefing(db: Database, type: BriefingType): boolean {
  const tz = getUserTimezone(db)
  const start = startOfDayInTz(tz)
  const row = db.prepare(`
    SELECT id FROM briefings
    WHERE type = ? AND sent_at >= ? AND is_deleted = 0
    LIMIT 1
  `).get(type, start)
  return row != null
}

/**
 * Check if a weekly briefing was already sent this week (Mon–Sun).
 */
export function hasThisWeeksBriefing(db: Database): boolean {
  const tz = getUserTimezone(db)
  // Find start of current week (Monday) in user's timezone
  const nowInTz = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  const [y, m, d] = nowInTz.split('-').map(Number)
  const localDate = new Date(y, m - 1, d)
  const dayOfWeek = localDate.getDay() // 0=Sun, 1=Mon, ...
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  // Calculate Monday's Unix timestamp at start of day in user's TZ
  const mondayEpoch = startOfDayInTz(tz) - daysToMonday * 86400
  const row = db.prepare(`
    SELECT id FROM briefings
    WHERE type = 'weekly' AND sent_at >= ? AND is_deleted = 0
    LIMIT 1
  `).get(mondayEpoch)
  return row != null
}

/**
 * Get briefings within a date range (for rollups / dashboard).
 */
export function getBriefingsInRange(
  db: Database,
  from: number,
  to: number,
  type?: BriefingType,
): Briefing[] {
  if (type) {
    const rows = db.prepare(`
      SELECT * FROM briefings
      WHERE type = ? AND sent_at >= ? AND sent_at < ? AND is_deleted = 0
      ORDER BY sent_at ASC
    `).all(type, from, to) as RawBriefing[]
    return rows.map(toBriefing)
  }
  const rows = db.prepare(`
    SELECT * FROM briefings
    WHERE sent_at >= ? AND sent_at < ? AND is_deleted = 0
    ORDER BY sent_at ASC
  `).all(from, to) as RawBriefing[]
  return rows.map(toBriefing)
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Save a sent briefing. Returns the new ID. */
export function addBriefing(db: Database, opts: AddBriefingOpts): string {
  const id = randomUUID()
  db.prepare(`
    INSERT INTO briefings (id, type, subject, greeting, date_label, sections, signoff, sent_to, external_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.type,
    opts.subject,
    opts.greeting ?? null,
    opts.dateLabel ?? null,
    JSON.stringify(opts.sections),
    opts.signoff ?? null,
    opts.sentTo,
    opts.externalId ?? null,
    JSON.stringify(opts.metadata ?? {}),
  )
  return id
}

/** Soft-delete a briefing. */
export function softDelete(db: Database, id: string): void {
  db.prepare('UPDATE briefings SET is_deleted = 1 WHERE id = ?').run(id)
}
