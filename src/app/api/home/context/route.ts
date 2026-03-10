/**
 * GET /api/home/context — live context data for the home screen.
 *
 * Two modes:
 *   1. Authenticated: full context (tasks, activity, profile, setup status)
 *   2. Visitor: IP-derived hints (city, country, timezone) for the landing page
 *
 * All queries are fast: indexed reads, small LIMIT caps, no joins.
 * Wrapped in try/catch — returns sensible defaults if DB is empty or not ready.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { getTaskSummary } from '@/lib/store/tasks'
import { getProfile } from '@/lib/profile-sync'
import { getUserTimezone } from '@/lib/timezone'
import { getActiveNotifications, addNotification, getPendingNotifications } from '@/lib/store/notifications'
import { getApp, isPersistentApp, getLiveApps } from '@/lib/apps'
import { isConfigured as isAppRoomConfigured } from '@/lib/approom/client'
import { isHostedMode } from '@/lib/hosted-storage'
import { validateSessionToken } from '@/lib/partners'
import type { SetupStatus, VisitorHints } from '@/lib/home-proposals'
import { isOnboardingComplete, getOnboardingResumeState } from '@/lib/onboarding'
import { setProfile } from '@/lib/profile-sync'

// ─── Types ──────────────────────────────────────────────────────────────────

type ActivityItem = {
  appId: string
  appIcon: string
  text: string
  ago: string
  route: string
  /** Optional auto-send prompt — appended as ?q= for chat apps. */
  prompt?: string
}

type AppQuotaStatus = {
  appId: string
  appName: string
  remaining: number
  total: number
  outcomeId: string
}

type HomeContext = {
  tasks: {
    totalOpen: number
    dueToday: number
    mit: string | null
  }
  activity: ActivityItem[]
  userName: string
  notificationCount: number
  setup: SetupStatus
  /** True when no authenticated user — home page is in landing/visitor mode */
  visitor?: boolean
  /** IP-derived hints for visitors (city, region, timezone) */
  visitorHints?: VisitorHints
  connections?: {
    unreadEmails: number
    eventsToday: number
    connected: boolean
  }
  /** Quota status for paid apps — only present for hosted users with AppRoom. */
  quotas?: AppQuotaStatus[]
  /** AppRoom base URL — for "Discover more apps" link. */
  appRoomUrl?: string
  /** Whether voice onboarding has been completed */
  onboardingCompleted?: boolean
  /** Resume state for incomplete onboarding */
  onboardingResume?: { step: 'name' | 'goal' | 'plans' | 'timezone'; name: string | null } | null
  /** US-012: Context callback message for first return visit after onboarding */
  contextCallback?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(epochSeconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - epochSeconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 172800) return 'Yesterday'
  const days = Math.floor(diff / 86400)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function truncateContent(content: string, maxLen = 80): string {
  let text = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_~`#]+/g, '')
    .replace(/\n+/g, ' ')
    .trim()

  const sentenceEnd = text.search(/[.!?]\s/)
  if (sentenceEnd > 0 && sentenceEnd < maxLen) {
    text = text.slice(0, sentenceEnd + 1)
  } else if (text.length > maxLen) {
    text = text.slice(0, maxLen).trimEnd() + '...'
  }

  return text
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const EMPTY_SETUP: SetupStatus = {
  hasProfile: false,
  hasConnections: false,
  hasNotes: false,
  hasUsedChat: false,
  hasTasks: false,
}

const EMPTY_CONTEXT: HomeContext = {
  tasks: { totalOpen: 0, dueToday: 0, mit: null },
  activity: [],
  userName: 'User',
  notificationCount: 0,
  setup: EMPTY_SETUP,
}

// ─── Visitor hints from request headers ──────────────────────────────────────
// CDN/platform headers provide geo data without external API calls.
// Vercel: x-vercel-ip-city, x-vercel-ip-country, x-vercel-ip-timezone
// Cloudflare: cf-ipcountry, cf-ipcity, cf-iptimezone
// Fallback: none (hints are optional)

function extractVisitorHints(req: NextRequest): VisitorHints {
  const hints: VisitorHints = {}

  // Try Vercel headers first, then Cloudflare
  hints.city = req.headers.get('x-vercel-ip-city')
    ?? req.headers.get('cf-ipcity')
    ?? undefined
  hints.region = req.headers.get('x-vercel-ip-country-region')
    ?? undefined
  hints.country = req.headers.get('x-vercel-ip-country')
    ?? req.headers.get('cf-ipcountry')
    ?? undefined
  hints.timezone = req.headers.get('x-vercel-ip-timezone')
    ?? req.headers.get('cf-iptimezone')
    ?? undefined

  // Decode URL-encoded city names (e.g. "San%20Francisco" → "San Francisco")
  if (hints.city) {
    try { hints.city = decodeURIComponent(hints.city) } catch { /* keep as-is */ }
  }

  return hints
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Soft auth: this endpoint is auth-exempt (visitors need it), but we still
  // try to extract the tenant ID from the session cookie for authenticated users.
  let tenantId = getTenantId(req)
  if (!tenantId && isHostedMode()) {
    const cookieToken = req.cookies.get('myway_session')?.value
    if (cookieToken?.includes('.')) {
      const session = validateSessionToken(cookieToken)
      if (session?.userId) tenantId = session.userId
    }
  }

  // Visitor = hosted mode + no tenant session + no existing data in default DB.
  // The default DB check catches self-hosted owners who happen to have hosted
  // env vars set — they have data in the default DB and are NOT visitors.
  let isVisitor = isHostedMode() && !tenantId
  if (isVisitor) {
    try {
      const defaultDb = getDb(undefined)
      if (isOnboardingComplete(defaultDb)) {
        // Default DB has real user data — treat as self-hosted owner, not visitor
        isVisitor = false
      }
    } catch { /* DB not ready — treat as visitor */ }
  }

  if (isVisitor) {
    const hints = extractVisitorHints(req)

    // Derive day/month from visitor's timezone (if available) or server time.
    // This lets proposals be weekend-aware and season-aware without any DB.
    const visitorNow = hints.timezone
      ? (() => { try { return new Date(new Date().toLocaleString('en-US', { timeZone: hints.timezone })) } catch { return new Date() } })()
      : new Date()
    hints.dayOfWeek = visitorNow.getDay()
    hints.month = visitorNow.getMonth()

    return NextResponse.json({
      ...EMPTY_CONTEXT,
      visitor: true,
      visitorHints: hints,
    })
  }

  try {
    const db = getDb(tenantId)

    // ── Tasks summary ───────────────────────────────────────────────────
    const tz = getUserTimezone(db)
    let tasks = EMPTY_CONTEXT.tasks
    try {
      const summary = getTaskSummary(db, tz)
      tasks = {
        totalOpen: summary.totalOpen,
        dueToday: summary.dueToday,
        mit: summary.mit?.title ?? null,
      }
    } catch { /* tasks table might not exist yet */ }

    // ── Recent activity — last 10 assistant messages across all apps ───
    let activity: ActivityItem[] = []
    try {
      const rows = db.prepare(`
        SELECT m.app_id, m.content, m.created_at
        FROM messages m
        WHERE m.role = 'assistant'
          AND m.is_deleted = 0
        ORDER BY m.created_at DESC
        LIMIT 10
      `).all() as { app_id: string; content: string; created_at: number }[]

      const seen = new Set<string>()
      for (const row of rows) {
        if (seen.has(row.app_id)) continue
        seen.add(row.app_id)

        const app = getApp(row.app_id)
        const snippet = truncateContent(row.content)

        // For persistent chat apps, generate a follow-up prompt so tapping
        // an activity item resumes the conversation with context.
        let prompt: string | undefined
        if (app && isPersistentApp(app)) {
          prompt = `Continue from where we left off. Last time you said: "${snippet}"`
        }

        activity.push({
          appId: row.app_id,
          appIcon: app?.icon ?? '🤖',
          text: snippet,
          ago: timeAgo(row.created_at),
          route: app?.route ?? `/apps/${row.app_id}`,
          prompt,
        })

        if (activity.length >= 8) break
      }
    } catch { /* messages table might not exist yet */ }

    // ── User name — merged from DB profile + USER.md (DB wins)
    let userName = EMPTY_CONTEXT.userName
    try {
      const userProfile = getProfile(db, 'user')
      const profileName = userProfile.get('name') ?? userProfile.get('call_them')
      if (profileName) {
        userName = profileName
      } else {
        // Final fallback: identity table
        const row = db.prepare(
          `SELECT value FROM identity WHERE key = 'user.name'`
        ).get() as { value: string } | undefined
        if (row?.value) userName = row.value
      }
    } catch { /* profile not available yet */ }

    // ── Notification count ──────────────────────────────────────────────
    let notificationCount = 0
    try {
      notificationCount = getActiveNotifications(db).length
    } catch { /* notifications table might not exist yet */ }

    // ── Connection awareness ─────────────────────────────────────────────
    let connections: HomeContext['connections'] = undefined
    try {
      const connRow = db.prepare(
        `SELECT COUNT(*) as cnt FROM connections WHERE status = 'connected'`
      ).get() as { cnt: number } | undefined

      if (connRow && connRow.cnt > 0) {
        const unread = db.prepare(
          `SELECT COUNT(*) as cnt FROM connection_data WHERE data_type = 'email' AND is_read = 0`
        ).get() as { cnt: number }

        const now = Math.floor(Date.now() / 1000)
        const endOfDay = now + 86400
        const events = db.prepare(
          `SELECT COUNT(*) as cnt FROM connection_data
           WHERE data_type = 'calendar_event' AND occurred_at >= ? AND occurred_at <= ?`
        ).get(now, endOfDay) as { cnt: number }

        connections = {
          unreadEmails: unread.cnt,
          eventsToday: events.cnt,
          connected: true,
        }
      }
    } catch { /* connections tables might not exist yet */ }

    // ── Connection health — surface token/sync errors as notifications ──
    try {
      const errConns = db.prepare(
        `SELECT id, provider, error FROM connections WHERE status IN ('error', 'disconnected') AND error IS NOT NULL`
      ).all() as { id: string; provider: string; error: string }[]

      for (const ec of errConns) {
        // One-shot: only create if no active notification exists for this connection
        const existing = db.prepare(
          `SELECT id FROM notifications WHERE app_id = 'connections' AND body LIKE ? AND status IN ('pending', 'shown')`
        ).get(`%${ec.id}%`)
        if (!existing) {
          addNotification(db, {
            appId: 'connections',
            title: 'Connection needs attention',
            body: `${ec.provider === 'google' ? 'Google Workspace' : ec.provider}: ${ec.error}. Tap to reconnect. [${ec.id}]`,
            type: 'alert',
            priority: 2,
            actionUrl: '/apps/settings?tab=connections',
            expiresAt: Math.floor(Date.now() / 1000) + 3 * 86400, // 3 days
          })
          notificationCount++
        }
      }
    } catch { /* non-critical */ }

    // ── Setup status — detect what the user has configured ──────────
    const setup: SetupStatus = { ...EMPTY_SETUP }
    try {
      // Profile: has name set (not the default 'User')
      setup.hasProfile = userName !== EMPTY_CONTEXT.userName

      // Connections: any connected service
      setup.hasConnections = connections?.connected === true

      // Notes: at least one message in the notes app
      try {
        const notesRow = db.prepare(
          `SELECT 1 FROM messages WHERE app_id = 'notes' AND is_deleted = 0 LIMIT 1`
        ).get()
        setup.hasNotes = !!notesRow
      } catch { /* table might not exist */ }

      // Chat: at least one user message in any chat-type app
      try {
        const chatRow = db.prepare(
          `SELECT 1 FROM messages WHERE role = 'user' AND is_deleted = 0 LIMIT 1`
        ).get()
        setup.hasUsedChat = !!chatRow
      } catch { /* table might not exist */ }

      // Tasks: has any tasks at all
      setup.hasTasks = tasks.totalOpen > 0
    } catch { /* setup detection failed — defaults are fine */ }

    // ── Seed welcome notification for brand-new users ─────────────────
    // One-shot: only if no notifications exist at all (truly new user).
    try {
      const isNewUser = !setup.hasProfile && !setup.hasUsedChat && !setup.hasNotes
      if (isNewUser) {
        const existing = getPendingNotifications(db, 1)
        if (existing.length === 0) {
          addNotification(db, {
            appId: 'system',
            title: 'Welcome to Myway',
            body: 'Set up your profile to get personalized suggestions. It takes 30 seconds.',
            type: 'info',
            priority: 3,
            actionUrl: '/apps/settings?tab=profile',
            expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400, // expires in 7 days
          })
          notificationCount = 1
        }
      }
    } catch { /* non-critical */ }

    // ── Quota status for paid apps (hosted only) ──────────────────────
    let quotas: AppQuotaStatus[] | undefined
    let appRoomUrl: string | undefined
    if (isAppRoomConfigured()) {
      appRoomUrl = process.env.NEXT_PUBLIC_APPROOM_URL?.trim()
        || process.env.MYWAY_APPROOM_URL?.trim()
        || undefined

      try {
        const allApps = getLiveApps(db)
        const paidApps = allApps.filter(a => a.pricing?.model === 'subscription' && a.pricing.outcomeTypes?.[0])
        if (paidApps.length > 0) {
          const rows = db.prepare(`
            SELECT app_id, outcome_id, quota, used, additional
            FROM app_quota_cache
          `).all() as { app_id: string; outcome_id: string; quota: number; used: number; additional: number }[]

          const cacheMap = new Map(rows.map(r => [r.app_id, r]))
          quotas = []
          for (const pa of paidApps) {
            const cached = cacheMap.get(pa.id)
            if (cached) {
              const total = cached.quota + cached.additional
              quotas.push({
                appId: pa.id,
                appName: pa.name,
                remaining: Math.max(0, total - cached.used),
                total,
                outcomeId: cached.outcome_id,
              })
            }
          }
          if (quotas.length === 0) quotas = undefined
        }
      } catch { /* table may not exist yet — non-critical */ }
    }

    // ── Onboarding status ────────────────────────────────────────────
    let onboardingCompleted = true
    let onboardingResume: HomeContext['onboardingResume'] = null
    try {
      onboardingCompleted = isOnboardingComplete(db)
      if (!onboardingCompleted) {
        const resume = getOnboardingResumeState(db)
        if (resume.step) {
          onboardingResume = { step: resume.step, name: resume.name }
        }
      }
    } catch { /* non-critical */ }

    // ── Ensure APort passport (logged-in users only — non-blocking catch-up) ──
    if (tenantId) {
      try {
        const { getPassportForApp } = await import('@/lib/aport/passport-store')
        if (!getPassportForApp(db, 'default')) {
          const { provisionPassportIfNeeded } = await import('@/lib/aport/provision')
          const email = (() => { try { const r = db.prepare(`SELECT value FROM user_profile WHERE key = 'email'`).get() as { value: string } | undefined; return r?.value } catch { return undefined } })()
          provisionPassportIfNeeded(db, { name: userName, email }).catch(e =>
            console.error('[home/context] Passport catch-up failed:', e instanceof Error ? e.message : e)
          )
        }
      } catch { /* non-critical */ }
    }

    // ── Context callback (US-012) — first return visit after onboarding ──
    let contextCallback: string | undefined
    try {
      if (onboardingCompleted) {
        const cbRows = db.prepare(
          `SELECT key, value FROM user_profile WHERE key IN ('context_callback_text', 'context_callback_shown_at')`,
        ).all() as { key: string; value: string }[]

        const cbFields = new Map(cbRows.map(r => [r.key, r.value]))
        const cbText = cbFields.get('context_callback_text')
        const cbShown = cbFields.get('context_callback_shown_at')

        if (cbText && !cbShown) {
          contextCallback = cbText
          // Mark as shown so it only fires once
          setProfile(db, 'user', { context_callback_shown_at: new Date().toISOString() }, 'system')
        }
      }
    } catch { /* non-critical */ }

    const response: HomeContext = {
      tasks,
      activity,
      userName,
      notificationCount,
      setup,
      ...(connections ? { connections } : {}),
      ...(quotas ? { quotas } : {}),
      ...(appRoomUrl ? { appRoomUrl } : {}),
      onboardingCompleted,
      ...(onboardingResume ? { onboardingResume } : {}),
      ...(contextCallback ? { contextCallback } : {}),
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error('[GET /api/home/context]', err)
    return NextResponse.json(EMPTY_CONTEXT)
  }
}
