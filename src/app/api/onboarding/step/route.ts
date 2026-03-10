/**
 * POST /api/onboarding/step — process an onboarding step.
 *
 * Auth-exempt: works for both authenticated users (saves to tenant DB)
 * and visitors (saves to HMAC-signed HttpOnly cookie).
 *
 * Accepts: { step: 'name' | 'goal' | 'plans', value: string, browserTimezone?: string }
 * Returns: { text: string, step: string, name?: string, facts?: ExtractedFacts }
 *
 * At each step, user input is sent through fact extraction (LLM) to build
 * a structured dataset matching the DB schema. Facts are persisted immediately.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import {
  extractName,
  extractNameWithLLM,
  extractFacts,
  saveFacts,
  processNameStep,
  processGoalStep,
  processPlansStep,
  NAME_RETRY_TEXT,
  STEP2_TEXT,
  friendlyTimezone,
  signVisitorCookie,
  verifyVisitorCookie,
  visitorCookieOptions,
  VISITOR_COOKIE_NAME,
  type OnboardingStep,
  type VisitorOnboardingData,
  type ExtractedFacts,
} from '@/lib/onboarding'

const VALID_STEPS: OnboardingStep[] = ['name', 'goal', 'plans']

export async function POST(req: NextRequest) {
  let body: { step?: string; value?: string; browserTimezone?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { step, value, browserTimezone } = body

  if (!step || !VALID_STEPS.includes(step as OnboardingStep)) {
    return NextResponse.json(
      { error: `Invalid step. Must be one of: ${VALID_STEPS.join(', ')}` },
      { status: 400 },
    )
  }

  if (!value?.trim()) {
    return NextResponse.json({ error: 'value is required' }, { status: 400 })
  }

  const tenantId = getTenantId(req)
  const isAuthenticated = !!tenantId || !process.env.MYWAY_API_TOKEN?.trim()

  // ── Authenticated path: use tenant DB ─────────────────────────────────────
  if (isAuthenticated) {
    try {
      const db = getDb(tenantId)
      return await handleStepWithDb(db, step as OnboardingStep, value.trim(), browserTimezone)
    } catch (err) {
      console.error('[POST /api/onboarding/step]', err)
      return NextResponse.json(
        { error: 'Failed to process onboarding step' },
        { status: 500 },
      )
    }
  }

  // ── Visitor path: HMAC-signed HttpOnly cookie ─────────────────────────────
  try {
    return await handleStepVisitor(req, step as OnboardingStep, value.trim(), browserTimezone)
  } catch (err) {
    console.error('[POST /api/onboarding/step] visitor:', err)
    return NextResponse.json(
      { error: 'Failed to process onboarding step' },
      { status: 500 },
    )
  }
}

// ── Authenticated handler ───────────────────────────────────────────────────

async function handleStepWithDb(
  db: ReturnType<typeof getDb>,
  step: OnboardingStep,
  value: string,
  browserTimezone?: string,
): Promise<NextResponse> {
  switch (step) {
    case 'name': {
      let name = extractName(value)
      if (!name) {
        name = await extractNameWithLLM(value)
      }
      if (!name) {
        return NextResponse.json({ text: NAME_RETRY_TEXT, step: 'name' })
      }

      const result = await processNameStep(db, value, name)

      // Trigger APort passport provisioning (async, non-blocking)
      import('@/lib/aport/provision').then(({ provisionPassportIfNeeded }) => {
        provisionPassportIfNeeded(db, { name }).catch((err) => {
          console.error('[onboarding] passport provisioning failed:', err)
        })
      }).catch(() => { /* provision module not available */ })

      return NextResponse.json(result)
    }

    case 'goal': {
      const tz = browserTimezone || 'UTC'
      const result = await processGoalStep(db, value, tz)
      return NextResponse.json(result)
    }

    case 'plans': {
      const result = await processPlansStep(db, value)
      return NextResponse.json(result)
    }
  }
}

// ── Visitor handler (signed cookie) ─────────────────────────────────────────

async function handleStepVisitor(
  req: NextRequest,
  step: OnboardingStep,
  value: string,
  browserTimezone?: string,
): Promise<NextResponse> {
  // Read existing cookie data
  const cookieValue = req.cookies.get(VISITOR_COOKIE_NAME)?.value
  const existing: VisitorOnboardingData = cookieValue
    ? verifyVisitorCookie(cookieValue) ?? { facts: { profile: {}, memories: [], signals: [] } }
    : { facts: { profile: {}, memories: [], signals: [] } }

  let responseData: Record<string, unknown>

  switch (step) {
    case 'name': {
      let name = extractName(value)
      if (!name) {
        name = await extractNameWithLLM(value)
      }
      if (!name) {
        return NextResponse.json({ text: NAME_RETRY_TEXT, step: 'name' })
      }

      const facts = await extractFacts('name — the user was asked their name', value)
      facts.profile.name = name
      existing.name = name
      existing.facts = mergeFacts(existing.facts, facts)

      responseData = { text: STEP2_TEXT, step: 'goal', name, facts }
      break
    }

    case 'goal': {
      const tz = browserTimezone || 'UTC'
      const facts = await extractFacts(
        'goal — the user was asked "what\'s one thing on your mind today?"',
        value,
      )
      facts.profile.primary_goal = value

      existing.goal = value
      existing.timezone = tz
      existing.facts = mergeFacts(existing.facts, facts)

      const friendlyTz = friendlyTimezone(tz)
      const text = `I see you're in ${friendlyTz}. Hope I'm right? What do you have planned for today?`

      responseData = { text, step: 'plans', facts }
      break
    }

    case 'plans': {
      const facts = await extractFacts(
        'plans — the user was asked "what do you have planned for today?"',
        value,
      )
      existing.plans = value
      existing.facts = mergeFacts(existing.facts, facts)
      existing.completedAt = new Date().toISOString()

      // Generate magic moment for visitor
      const name = existing.name || 'friend'
      const goal = existing.goal || ''
      const fallback = `Welcome home, ${name}. I'm here whenever you need me — let's make something happen.`

      responseData = { text: fallback, step: 'complete', name, facts }
      break
    }
  }

  // Set signed cookie
  const response = NextResponse.json(responseData!)
  const opts = visitorCookieOptions()
  response.cookies.set(opts.name, signVisitorCookie(existing), {
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
    maxAge: opts.maxAge,
    path: opts.path,
  })

  return response
}

function mergeFacts(a: ExtractedFacts, b: ExtractedFacts): ExtractedFacts {
  return {
    profile: { ...a.profile, ...b.profile },
    memories: [...a.memories, ...b.memories],
    signals: [...a.signals, ...b.signals],
  }
}
