/**
 * Timezone-aware date utilities.
 *
 * All server-side date boundaries ("today", "start of day", due-date parsing)
 * must respect the user's IANA timezone — not the server's local time.
 *
 * These helpers use Intl.DateTimeFormat for offset computation, which works in
 * Node.js without any third-party date library.
 */

import type { Database } from 'better-sqlite3'

/**
 * Read the user's IANA timezone from the identity table.
 * Falls back to 'UTC' if not set or table doesn't exist.
 */
export function getUserTimezone(db: Database): string {
  try {
    const row = db.prepare(
      `SELECT value FROM identity WHERE key = 'user.timezone'`
    ).get() as { value: string } | undefined
    return row?.value || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Parse a "YYYY-MM-DD" date string as midnight in the given IANA timezone.
 * Returns unix seconds.
 *
 * Strategy: construct a UTC Date for noon on that date, then use
 * Intl.DateTimeFormat to find the UTC offset for the target timezone at
 * that moment, and shift to midnight in that timezone.
 */
export function parseDateInTz(dateStr: string, tz: string): number {
  // Parse components from "YYYY-MM-DD"
  const [yearStr, monthStr, dayStr] = dateStr.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr) - 1 // 0-indexed
  const day = Number(dayStr)

  // Create a UTC date at noon to avoid DST edge cases during offset lookup
  const noonUtc = Date.UTC(year, month, day, 12, 0, 0)

  // Find the UTC offset for the target timezone at that moment
  const offsetMs = getTimezoneOffsetMs(noonUtc, tz)

  // Midnight in the target timezone = midnight UTC minus the offset
  // offset is "tz time - UTC time", so UTC equivalent of midnight-in-tz = 00:00 - offset
  const midnightUtcMs = Date.UTC(year, month, day, 0, 0, 0) - offsetMs

  return Math.floor(midnightUtcMs / 1000)
}

/**
 * Returns unix seconds for the start of "today" in the given timezone.
 */
export function startOfDayInTz(tz: string): number {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  return parseDateInTz(todayStr, tz)
}

/**
 * Returns unix seconds for the end of "today" in the given timezone.
 * (23:59:59 = start of day + 86399 seconds)
 */
export function endOfDayInTz(tz: string): number {
  return startOfDayInTz(tz) + 86399
}

/**
 * Parse a "YYYY-MM-DDTHH:MM" datetime string as that wall-clock time
 * in the given IANA timezone. Returns unix seconds.
 */
export function parseDateTimeInTz(dateTimeStr: string, tz: string): number {
  const [datePart, timePart] = dateTimeStr.split('T')
  const [yearStr, monthStr, dayStr] = datePart.split('-')
  const [hourStr, minStr] = timePart.split(':')
  const year = Number(yearStr)
  const month = Number(monthStr) - 1
  const day = Number(dayStr)
  const hour = Number(hourStr)
  const minute = Number(minStr)

  // Use noon UTC on that date for offset lookup (avoids DST edge cases)
  const noonUtc = Date.UTC(year, month, day, 12, 0, 0)
  const offsetMs = getTimezoneOffsetMs(noonUtc, tz)

  const wallClockUtcMs = Date.UTC(year, month, day, hour, minute, 0) - offsetMs
  return Math.floor(wallClockUtcMs / 1000)
}

/**
 * Format unix seconds as "YYYY-MM-DD" in the given timezone.
 */
export function formatDateInTz(epochSeconds: number, tz: string): string {
  const dt = new Date(epochSeconds * 1000)
  return dt.toLocaleDateString('en-CA', { timeZone: tz })
}

/**
 * Format unix seconds as a human-friendly string in the given timezone.
 * Uses the explicit `hasTime` flag to decide whether to show time.
 * Date-only tasks always display as just the date, regardless of viewer timezone.
 *
 * Examples:
 *   date-only: "Thu, Feb 20"
 *   with time: "Thu, Feb 20 at 2:00 PM"
 */
export function formatDueDateInTz(epochSeconds: number, tz: string, hasTime = false): string {
  const dt = new Date(epochSeconds * 1000)
  const dateStr = dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  })

  if (!hasTime) return dateStr

  const timeStr = dt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  })
  return `${dateStr} at ${timeStr}`
}

/**
 * Re-interpret an epoch that was mistakenly stored as UTC but was meant to be
 * in the given timezone. Returns the corrected epoch.
 *
 * Example: user said "5:30 PM", AI produced "2026-02-23T17:30", old code parsed
 * as 17:30 UTC. User meant 17:30 EST. This function extracts the UTC wall-clock
 * (17:30) and re-parses it as 17:30 in the target timezone (= 22:30 UTC).
 */
export function reinterpretUtcAsTz(epochSeconds: number, tz: string): number {
  const dt = new Date(epochSeconds * 1000)
  // Extract wall-clock components as they appear in UTC
  const year = dt.getUTCFullYear()
  const month = dt.getUTCMonth()     // 0-indexed
  const day = dt.getUTCDate()
  const hour = dt.getUTCHours()
  const minute = dt.getUTCMinutes()

  // Re-parse those same wall-clock values in the target timezone
  const noonUtc = Date.UTC(year, month, day, 12, 0, 0)
  const offsetMs = getTimezoneOffsetMs(noonUtc, tz)
  const correctedMs = Date.UTC(year, month, day, hour, minute, 0) - offsetMs

  return Math.floor(correctedMs / 1000)
}

// ─── Internal ──────────────────────────────────────────────────────────────

/**
 * Compute the UTC offset (in milliseconds) for a given timezone at a specific instant.
 * Returns positive values for timezones east of UTC (e.g. +9h for Asia/Tokyo).
 *
 * Uses Intl.DateTimeFormat to extract the timezone's local date/time components
 * at the given instant, then compares to the UTC components.
 */
function getTimezoneOffsetMs(utcMs: number, tz: string): number {
  const dt = new Date(utcMs)

  // Get date components in the target timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(dt)

  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)

  // Reconstruct what UTC instant corresponds to "the same wall-clock in UTC"
  const tzAsUtcMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'), // midnight edge case
    get('minute'),
    get('second'),
  )

  return tzAsUtcMs - utcMs
}
