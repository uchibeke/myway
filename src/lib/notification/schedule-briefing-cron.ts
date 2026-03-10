/**
 * Auto-schedule system cron jobs (daily briefing, weekly debrief).
 *
 * Called after onboarding completes (when we know the user's timezone).
 * Each function creates a system cron job that:
 *   1. Generates content using the AI with full user context
 *   2. Delivers via notification.sendBriefing (email + sms)
 *
 * All functions are idempotent — safe to call on every login.
 *
 * SERVER ONLY.
 */

import type { Database } from 'better-sqlite3'

// ─── Cron definitions ───────────────────────────────────────────────────────

type SystemCronDef = {
  id: string
  name: string
  description: string
  schedule: string
  message: string
}

const DAILY_BRIEFING: SystemCronDef = {
  id: 'daily_morning_briefing',
  name: 'Morning Briefing',
  description: 'Daily morning brief — auto-scheduled during onboarding',
  schedule: '15 8 * * *', // 8:15am daily — ready before 8:30 notification
  message: `Briefing time. Using full context — tasks, memories, cross-app activity, and any signals you have — give me a rich, personalized brief. Include: (1) warm greeting with today's full date and day, (2) my MIT and today's task picture, (3) what's been happening across my apps recently and any patterns worth noting, (4) one reflection question. Be concise, specific, and warm.

After generating the briefing, deliver it via email.briefing (subject: "Your Morning Brief — [Day, Month Date]") AND message send with a concise summary.`,
}

const WEEKLY_DEBRIEF: SystemCronDef = {
  id: 'weekly_sunday_debrief',
  name: 'Weekly Debrief',
  description: 'Sunday evening debrief — auto-scheduled during onboarding',
  schedule: '0 18 * * 0', // Sunday 6pm
  message: `You are the user's chief of staff. Generate a weekly debrief using all available context — tasks completed and open, memories, cross-app activity, personality signals, recipes tried, notes written, and any patterns from the week.

Include: (1) one thing worth reflecting on from this week, (2) one priority for the coming week based on open tasks and goals, (3) one optional challenge to keep momentum. Keep total length under 150 words. Tone: calm, direct, executive.

After generating the debrief, deliver it via email.briefing (subject: "Your Weekly Debrief — Week of [Date]") AND message send with a concise summary.`,
}

// ─── Core scheduling function ───────────────────────────────────────────────

/**
 * Ensure a system cron job exists. Idempotent — skips if already present.
 * Returns true if a new job was created.
 */
function ensureSystemCron(db: Database, def: SystemCronDef, timezone: string): boolean {
  try {
    const existing = db.prepare('SELECT id FROM cron_jobs WHERE id = ?').get(def.id)
    if (existing) {
      console.log(`[system-cron] ${def.id} already exists, skipping`)
      return false
    }
  } catch {
    console.warn(`[system-cron] cron_jobs table not ready`)
    return false
  }

  const tz = timezone || 'UTC'
  const { computeNextRun } = require('@/lib/cron-engine') as typeof import('@/lib/cron-engine')

  const nextRun = computeNextRun('cron', def.schedule, tz)
  if (nextRun === null) {
    console.error(`[system-cron] Failed to compute next run for ${def.id}`)
    return false
  }

  try {
    db.prepare(`
      INSERT INTO cron_jobs (id, name, description, message, schedule_type, schedule_value, tz, enabled, next_run_at, is_system)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
    `).run(
      def.id,
      def.name,
      def.description,
      def.message,
      'cron',
      def.schedule,
      tz,
      nextRun,
    )

    console.log(`[system-cron] Created ${def.id} (tz: ${tz}, next: ${new Date(nextRun * 1000).toISOString()})`)
    return true
  } catch (err) {
    console.error(`[system-cron] Failed to create ${def.id}:`, err instanceof Error ? err.message : err)
    return false
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Ensure the daily morning briefing cron exists. */
export function ensureBriefingCron(db: Database, timezone: string): boolean {
  return ensureSystemCron(db, DAILY_BRIEFING, timezone)
}

/** Ensure the weekly Sunday debrief cron exists. */
export function ensureWeeklyDebriefCron(db: Database, timezone: string): boolean {
  return ensureSystemCron(db, WEEKLY_DEBRIEF, timezone)
}
