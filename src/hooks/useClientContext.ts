'use client'

/**
 * useClientContext — captures device time, timezone, and time-of-day band.
 *
 * Returned on every render (no subscription needed — shells call this on
 * mount and pass it with each AI request). If time-of-day matters for
 * long-lived components, combine with a 60-second interval update.
 *
 * TimeOfDay bands drive:
 *   - Quick-action filtering (Mise: no dinner at 7am)
 *   - AI temporal grounding ("It is currently afternoon on Feb 19 2026")
 */

export type TimeOfDay =
  | 'early_morning'  // 4–7am
  | 'morning'        // 7am–12pm
  | 'midday'         // 12–2pm
  | 'afternoon'      // 2–6pm
  | 'evening'        // 6–10pm
  | 'night'          // 10pm–4am

export type ClientContext = {
  /** ISO 8601 with local offset: "2026-02-19T14:32:00.000-05:00" */
  isoTimestamp: string
  /** IANA timezone: "America/Toronto" */
  timezone: string
  /** Semantic time band for filtering and context injection */
  timeOfDay: TimeOfDay
  /** Human-readable date: "Thursday, February 19, 2026" */
  dateLabel: string
  /** Human-readable time: "2:32 PM" */
  timeLabel: string
}

function deriveTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 4  && hour < 7)  return 'early_morning'
  if (hour >= 7  && hour < 12) return 'morning'
  if (hour >= 12 && hour < 14) return 'midday'
  if (hour >= 14 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 22) return 'evening'
  return 'night'
}

export function useClientContext(): ClientContext {
  const now = new Date()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  // Construct ISO 8601 with local offset (not UTC Z suffix)
  const offset = -now.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const isoTimestamp =
    now.getFullYear() + '-' +
    pad(now.getMonth() + 1) + '-' +
    pad(now.getDate()) + 'T' +
    pad(now.getHours()) + ':' +
    pad(now.getMinutes()) + ':' +
    pad(now.getSeconds()) +
    sign + pad(Math.floor(Math.abs(offset) / 60)) + ':' + pad(Math.abs(offset) % 60)

  return {
    isoTimestamp,
    timezone,
    timeOfDay: deriveTimeOfDay(now.getHours()),
    dateLabel: now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }),
    timeLabel: now.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    }),
  }
}
