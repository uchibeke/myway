/**
 * GET /api/openclaw/context
 *
 * Live agent context endpoint — designed to be called by OpenClaw's heartbeat
 * via web_fetch("http://localhost:48291/api/openclaw/context") for real-time
 * data instead of reading stale workspace markdown files.
 *
 * Returns a single JSON payload with everything the heartbeat needs:
 *   - Tasks (live from DB, timezone-aware, with rich context)
 *   - Calendar (upcoming events, imminent alerts)
 *   - Email (unread count, last sync, new unknown contacts)
 *   - Personality signals (cross-app state)
 *   - Workspace metadata
 *
 * Why this beats reading TASKS.md / CALENDAR.md:
 *   - Real-time: no 5-minute staleness from file snapshots
 *   - Vector-ready: DB has sqlite-vec; semantic task search happens server-side
 *   - Rich context: task.context JSON (people, companies, deliverables) available
 *   - Single HTTP call replaces 5+ file reads
 *   - Timezone-correct: all dates formatted in user's IANA timezone
 *
 * APort integration point: this endpoint could require a valid agent passport
 * for access — ensuring only authorized agents (with the right OAP scope) can
 * read the user's live context. See https://www.npmjs.com/package/@aporthq/aport-agent-guardrails
 *
 * Auth: accepts OPENCLAW_GATEWAY_TOKEN via Authorization: Bearer header.
 * No auth required when called from localhost (loopback trust).
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { getOpenTasks, getTaskSummary } from '@/lib/store/tasks'
import { getAllSignals } from '@/lib/store/personality'
import { getUserTimezone } from '@/lib/timezone'
import { getUnreadEmails, getUpcomingEvents, listConnections } from '@/lib/connections/store'
import { hasTodaysBriefing, hasThisWeeksBriefing, getLatestBriefing } from '@/lib/store/briefings'

// 30-second cache — fresh enough for heartbeat, light on DB
let _cache: { data: unknown; ts: number } | null = null
const CACHE_MS = 30_000

/** Safe call — returns fallback if table doesn't exist yet (pre-migration). */
function safeCall<T>(fn: () => T, fallback: T): T {
  try { return fn() } catch { return fallback }
}

export async function GET(req: NextRequest) {
  // Auth: always require bearer token (OPENCLAW_GATEWAY_TOKEN or MYWAY_AI_TOKEN)
  const expected = process.env.OPENCLAW_GATEWAY_TOKEN ?? process.env.MYWAY_AI_TOKEN ?? ''
  if (expected) {
    const authHeader = req.headers.get('authorization') ?? ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Timing-safe comparison
    const a = Buffer.from(token)
    const b = Buffer.from(expected)
    const { timingSafeEqual } = await import('crypto')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Serve from cache if fresh
  if (_cache && Date.now() - _cache.ts < CACHE_MS) {
    return Response.json(_cache.data, {
      headers: { 'X-Cache': 'HIT', 'Cache-Control': 'no-store' }
    })
  }

  try {
    const db = getDb(getTenantId(req))
    const tz = getUserTimezone(db)
    const now = Math.floor(Date.now() / 1000)

    // ── Tasks ──────────────────────────────────────────────────────────────
    const taskSummary = getTaskSummary(db, tz)
    const openTasks = getOpenTasks(db, 20, tz)
    const overdueTasks = openTasks.filter(t => t.dueAt && t.dueAt < now)
    const dueTodayTasks = openTasks.filter(t => {
      if (!t.dueAt) return false
      const d = new Date(t.dueAt * 1000).toLocaleDateString('en-CA', { timeZone: tz })
      const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
      return d === today
    })

    // ── Calendar ───────────────────────────────────────────────────────────
    const upcomingEvents = getUpcomingEvents(db, 10)
    const thirtyMinFromNow = now + 30 * 60
    const imminentEvents = upcomingEvents.filter(e => e.occurredAt && e.occurredAt <= thirtyMinFromNow && e.occurredAt > now)
    const nextEvent = upcomingEvents.find(e => e.occurredAt && e.occurredAt > now)

    // ── Email ──────────────────────────────────────────────────────────────
    const unreadEmails = getUnreadEmails(db, 5)
    const connections = listConnections(db)
    const googleConn = connections.find(c => c.provider === 'google')
    const lastEmailSyncAt = googleConn?.lastSyncAt
      ? new Date(googleConn.lastSyncAt * 1000).toISOString()
      : null

    // ── Signals ────────────────────────────────────────────────────────────
    const signals = getAllSignals(db, 'user.')
    const signalMap = Object.fromEntries(signals.map(s => [s.key, s.value]))

    // ── Compose response ───────────────────────────────────────────────────
    const data = {
      timestamp: new Date().toISOString(),
      tz,
      tasks: {
        openCount: taskSummary.totalOpen,
        dueTodayCount: taskSummary.dueToday,
        completedToday: taskSummary.doneToday,
        mit: taskSummary.mit ? {
          id: taskSummary.mit.id,
          title: taskSummary.mit.title,
          dueAt: taskSummary.mit.dueAt,
          priority: taskSummary.mit.priority,
          context: taskSummary.mit.context,
        } : null,
        overdue: overdueTasks.slice(0, 5).map(t => ({
          id: t.id,
          title: t.title,
          dueAt: t.dueAt,
          priority: t.priority,
          daysPastDue: t.dueAt ? Math.floor((now - t.dueAt) / 86400) : 0,
          context: t.context,
        })),
        dueToday: dueTodayTasks.slice(0, 5).map(t => ({
          id: t.id,
          title: t.title,
          dueAt: t.dueAt,
          dueAtHasTime: t.dueAtHasTime,
          priority: t.priority,
        })),
      },
      calendar: {
        nextEvent: nextEvent ? {
          title: nextEvent.title,
          startsAt: nextEvent.occurredAt,
          minutesUntil: nextEvent.occurredAt ? Math.floor((nextEvent.occurredAt - now) / 60) : null,
          link: (nextEvent.metadata as Record<string, unknown>)?.hangoutLink as string | null ?? nextEvent.externalUrl ?? null,
          location: (nextEvent.metadata as Record<string, unknown>)?.location as string | null ?? null,
        } : null,
        imminentEvents: imminentEvents.map(e => ({
          title: e.title,
          startsAt: e.occurredAt,
          minutesUntil: e.occurredAt ? Math.floor((e.occurredAt - now) / 60) : null,
          link: (e.metadata as Record<string, unknown>)?.hangoutLink as string | null ?? e.externalUrl ?? null,
        })),
        upcomingCount: upcomingEvents.length,
      },
      email: {
        unreadCount: signalMap['connection.email.unread_count']
          ? parseInt(signalMap['connection.email.unread_count'], 10)
          : unreadEmails.length,
        lastSyncAt: lastEmailSyncAt,
        connectionStatus: googleConn?.status ?? 'disconnected',
        recentSubjects: unreadEmails.slice(0, 3).map(e => ({
          title: e.title,
          from: (e.metadata as Record<string, unknown>)?.from as string | null ?? null,
        })),
      },
      signals: signalMap,
      briefings: {
        morningDone: safeCall(() => hasTodaysBriefing(db, 'morning'), false),
        eveningDone: safeCall(() => hasTodaysBriefing(db, 'evening'), false),
        weeklyDone: safeCall(() => hasThisWeeksBriefing(db), false),
        lastMorning: safeCall(() => { const b = getLatestBriefing(db, 'morning'); return b ? b.sentAt : null }, null),
        lastEvening: safeCall(() => { const b = getLatestBriefing(db, 'evening'); return b ? b.sentAt : null }, null),
        lastWeekly: safeCall(() => { const b = getLatestBriefing(db, 'weekly'); return b ? b.sentAt : null }, null),
      },
    }

    _cache = { data, ts: Date.now() }
    return Response.json(data, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'no-store' }
    })
  } catch (err) {
    console.error('[openclaw/context] Error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
