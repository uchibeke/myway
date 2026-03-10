/**
 * POST /api/onboarding/live/extract — extract and save facts from a Gemini Live
 * onboarding conversation transcript.
 *
 * Auth-exempt (visitors need it). Rate-limited via /api/onboarding/live prefix.
 *
 * Accepts: { transcript: string, browserTimezone: string }
 * Returns: { ok: true, facts: ExtractedFacts }
 *
 * The full conversation transcript is sent to an LLM which extracts structured
 * data (name, goals, memories, tasks, etc.) — no client-side parsing needed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import {
  extractConversationFacts,
  saveFacts,
  generateContextCallback,
  signVisitorCookie,
  verifyVisitorCookie,
  visitorCookieOptions,
  VISITOR_COOKIE_NAME,
  type ExtractedFacts,
  type VisitorOnboardingData,
} from '@/lib/onboarding'

export async function POST(req: NextRequest) {
  let body: { transcript?: string; browserTimezone?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const transcript = body.transcript?.trim()
  if (!transcript) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
  }

  const tz = body.browserTimezone || 'UTC'

  // ── Extract facts from full conversation (LLM does all the work) ──────
  let facts: ExtractedFacts
  try {
    facts = await extractConversationFacts(transcript, tz)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[onboarding/extract] extraction failed:', msg)
    return NextResponse.json({ error: `Extraction failed: ${msg}` }, { status: 502 })
  }

  console.log('[onboarding/extract] profile:', JSON.stringify(facts.profile))
  console.log('[onboarding/extract] memories:', facts.memories.length, '| signals:', facts.signals.length,
    '| tasks:', facts.tasks?.length ?? 0, '| aiIdentity:', Object.keys(facts.aiIdentity ?? {}).length)

  // ── Save: authenticated vs visitor ────────────────────────────────────
  const tenantId = getTenantId(req)
  const isAuthenticated = !!tenantId || !process.env.MYWAY_API_TOKEN?.trim()

  if (isAuthenticated) {
    try {
      const db = getDb(tenantId)
      saveFacts(db, facts)

      // Trigger APort passport provisioning (async, non-blocking)
      if (facts.profile.name) {
        import('@/lib/aport/provision').then(({ provisionPassportIfNeeded }) => {
          provisionPassportIfNeeded(db, { name: facts.profile.name }).catch((err) => {
            console.error('[onboarding] passport provisioning failed:', err)
          })
        }).catch(() => { /* provision module not available */ })
      }

      // Generate context callback for first return visit (fire-and-forget)
      generateContextCallback(db).catch(() => {})

      return NextResponse.json({ ok: true, facts })
    } catch (err) {
      console.error('[onboarding/extract] DB save failed:', err)
      return NextResponse.json({ error: 'Failed to save facts' }, { status: 500 })
    }
  }

  // ── Visitor path: signed cookie ───────────────────────────────────────
  try {
    const cookieValue = req.cookies.get(VISITOR_COOKIE_NAME)?.value
    const existing: VisitorOnboardingData = cookieValue
      ? verifyVisitorCookie(cookieValue) ?? { facts: { profile: {}, memories: [], signals: [] } }
      : { facts: { profile: {}, memories: [], signals: [] } }

    existing.name = facts.profile.name || existing.name
    existing.goal = facts.profile.primary_goal || existing.goal
    existing.timezone = tz
    existing.facts = mergeFacts(existing.facts, facts)
    existing.completedAt = new Date().toISOString()

    const response = NextResponse.json({ ok: true, facts })
    const opts = visitorCookieOptions()
    response.cookies.set(opts.name, signVisitorCookie(existing), {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      maxAge: opts.maxAge,
      path: opts.path,
    })

    console.log('[onboarding/live/extract] Saved to visitor cookie')
    return response
  } catch (err) {
    console.error('[onboarding/live/extract] visitor save failed:', err)
    return NextResponse.json({ error: 'Failed to save facts' }, { status: 500 })
  }
}

function mergeFacts(a: ExtractedFacts, b: ExtractedFacts): ExtractedFacts {
  return {
    profile: { ...a.profile, ...b.profile },
    memories: [...a.memories, ...b.memories],
    signals: [...a.signals, ...b.signals],
    tasks: [...(a.tasks ?? []), ...(b.tasks ?? [])],
    aiIdentity: { ...(a.aiIdentity ?? {}), ...(b.aiIdentity ?? {}) },
  }
}
