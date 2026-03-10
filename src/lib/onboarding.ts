/**
 * Onboarding — server-side logic for the voice-first onboarding flow.
 *
 * Three steps, voice-first, under 90 seconds:
 *   1. "What's your name?" (pre-cached TTS)
 *   2. "What's one thing on your mind today?" (pre-cached TTS, no name)
 *   3. "I see you're in {tz}. Hope I'm right? What do you have planned?"
 *      (dynamic TTS — magic moment pre-generates while this plays)
 *
 * Then: magic moment — personalized first response using all extracted facts.
 *
 * Fact extraction: at every step, user input is sent to an LLM that extracts
 * structured facts matching the DB schema (user_profile, memories, personality_state).
 * Facts are saved immediately — no localStorage.
 *
 * SERVER ONLY.
 */

import type { Database } from 'better-sqlite3'
import { createHmac } from 'crypto'
import { setProfile } from '@/lib/profile-sync'
import { invalidateWorkspaceCache } from '@/lib/workspace-context'
import { resolveModelForApp } from '@/lib/model-registry'
import { chatCompletionsUrl } from '@/lib/ai-config'
import { addMemory, type MemoryType } from '@/lib/store/memories'
import { addTask } from '@/lib/store/tasks'
import { setSignals } from '@/lib/store/personality'

// ─── Fixed TTS texts ─────────────────────────────────────────────────────────

export const GREETING_TEXT =
  "Hey, I'm Myway. I'm going to be your personal AI — but first, what's your name?"

export const NAME_RETRY_TEXT =
  "Sorry, I didn't catch that — could you say your name again?"

export const STEP2_TEXT =
  "What's one thing on your mind today?"

// ─── Onboarding step types ──────────────────────────────────────────────────

export type OnboardingStep = 'name' | 'goal' | 'plans'

export type StepResult = {
  text: string
  step: OnboardingStep | 'complete'
  name?: string
  facts?: ExtractedFacts
}

// ─── Fact extraction ────────────────────────────────────────────────────────

/**
 * Structured facts extracted from user input at each onboarding step.
 * Maps directly to DB tables: user_profile, memories, personality_state, tasks, ai_profile.
 */
export interface ExtractedFacts {
  profile: Record<string, string>
  memories: { type: MemoryType; content: string }[]
  signals: { key: string; value: string; confidence?: number }[]
  tasks?: {
    title: string
    description?: string
    priority?: number
    dueAt?: string  // ISO 8601 date from LLM, parsed to epoch before saving
    context?: {
      when?: string
      where?: string
      why_it_matters?: string
      people?: string[]
      subtasks?: string[]
    }
  }[]
  aiIdentity?: Record<string, string>
}

const FACT_EXTRACTION_PROMPT = `You are a fact extractor for a personal AI assistant called Myway.
Extract structured facts from the user's spoken input during onboarding.

Return ONLY valid JSON with these three sections:

{
  "profile": {
    // Keys for the user_profile table. Only include fields with clear values:
    // "name" — first name or preferred name
    // "location" — city, region, or country
    // "occupation" — job, role, or profession
    // "primary_goal" — main goal or intention
  },
  "memories": [
    // Array of facts worth remembering long-term. Each has:
    // "type": one of "fact", "preference", "event", "personality"
    // "content": a concise sentence describing the fact
    // Examples: { "type": "fact", "content": "Works as a software engineer" }
    //           { "type": "preference", "content": "Prefers morning routines" }
    //           { "type": "event", "content": "Has a meeting at 3pm today" }
  ],
  "signals": [
    // Mutable personality signals. Each has:
    // "key": dotted key like "user.mood", "user.occupation", "user.location", "user.interests"
    // "value": the signal value
    // "confidence": 0.0-1.0 (1.0 = directly stated, 0.7 = strongly implied)
  ]
}

Rules:
- Be conservative. Only extract what is clearly stated or strongly implied.
- Omit empty arrays and objects with no fields.
- Do not infer beyond what's said.
- Keep memory content concise (one sentence each).
- Return valid JSON only, no markdown fences, no explanation.`

/**
 * Extract structured facts from user input using LLM.
 * Returns empty facts on failure — never throws.
 */
export async function extractFacts(
  stepContext: string,
  userInput: string,
): Promise<ExtractedFacts> {
  const empty: ExtractedFacts = { profile: {}, memories: [], signals: [] }
  try {
    const result = await callLLM(
      FACT_EXTRACTION_PROMPT,
      `Onboarding step: "${stepContext}"\nUser said: "${userInput}"`,
      300,
      0.3,
    )
    // Strip markdown fences if present
    const cleaned = result.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(cleaned) as Partial<ExtractedFacts>
    return {
      profile: parsed.profile && typeof parsed.profile === 'object' ? parsed.profile : {},
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
    }
  } catch {
    return empty
  }
}

// ─── Full-conversation extraction ────────────────────────────────────────────

const CONVERSATION_EXTRACTION_PROMPT = `You are a fact extractor for a personal AI assistant called Myway.
You will receive the FULL transcript of a voice onboarding conversation between Myway and a new user.
Extract ALL structured facts from the user's responses (ignore what Myway said — only extract from user turns).

Return ONLY valid JSON matching this schema:

{
  "profile": {
    // Key-value store for the user_profile table. Extract ANY of these if mentioned:
    // "name" — first name or preferred name (REQUIRED — always extract this)
    // "pronouns" — he/him, she/her, they/them, etc.
    // "email" — email address
    // "location" — city, region, or country
    // "occupation" — job title, role, field, or profession
    // "company" — employer or organization
    // "primary_goal" — the main thing on their mind / what they want to accomplish
    // "interests" — comma-separated interests or hobbies
    // "communication_style" — how they prefer to be communicated with
    // "notes" — anything else noteworthy that doesn't fit other fields
    //
    // This is a flexible key-value store. If the user mentions something that
    // maps to a clear profile field (e.g. "birthday", "spouse", "languages"),
    // include it using a descriptive snake_case key.
  },
  "memories": [
    // Long-term facts worth remembering. Be THOROUGH — extract everything the
    // user revealed: job details, hobbies, life situation, relationships, family,
    // projects, challenges, routines, preferences, opinions, and context.
    //
    // Each entry:
    // "type": one of "fact", "preference", "event", "personality"
    // "content": a concise sentence describing the fact
    //
    // Examples:
    //   { "type": "fact", "content": "Works as a software engineer at Google" }
    //   { "type": "fact", "content": "Has a 3-year-old daughter named Emma" }
    //   { "type": "preference", "content": "Prefers working in the morning" }
    //   { "type": "event", "content": "Has a product launch next week" }
    //   { "type": "personality", "content": "Comes across as ambitious and focused" }
  ],
  "signals": [
    // Mutable personality signals for the personality_state table.
    // Keys use "domain.signal" format. Common keys:
    //   "user.mood" — current emotional state
    //   "user.occupation" — job/role
    //   "user.location" — where they are
    //   "user.interests" — what they're into
    //   "user.energy" — energy level (high/medium/low)
    //   "user.communication_style" — brief/detailed/casual/formal
    //   "user.life_stage" — student/professional/retired/parent/etc.
    // You can create new domain.signal keys if needed (e.g. "user.industry").
    //
    // Each entry:
    // "key": dotted key (e.g. "user.mood")
    // "value": the signal value
    // "confidence": 0.0-1.0 (1.0 = directly stated, 0.7 = strongly implied, 0.5 = inferred)
  ],
  "tasks": [
    // Actionable items — things they want to do, plans, goals, to-dos, intentions.
    // Extract from ANY mention of plans, goals, deadlines, or things to get done.
    //
    // Each entry:
    // "title" — short task title (e.g. "Prepare product launch presentation")
    // "description" — optional, one sentence of context
    // "priority" — 1 (critical) to 10 (someday). Default 5. Use 1-3 only if user indicated urgency.
    // "dueAt" — optional, ISO 8601 date string if user mentioned a deadline (e.g. "2026-03-15")
    // "context" — optional object with any of:
    //   "when" — timing context (e.g. "tomorrow morning", "before Friday")
    //   "where" — location context (e.g. "at the office")
    //   "why_it_matters" — why this task is important
    //   "people" — array of people involved (e.g. ["Steve", "Sarah"])
    //   "subtasks" — array of sub-items if the user broke it down
    //
    // Examples:
    //   { "title": "Finish quarterly report", "priority": 2, "dueAt": "2026-03-14", "context": { "when": "by Friday", "why_it_matters": "Board review next week" } }
    //   { "title": "Go for a run", "priority": 7 }
    //   { "title": "Call dentist", "priority": 5, "context": { "people": ["Dr. Smith"] } }
  ],
  "aiIdentity": {
    // Preferences for how the AI should behave. Only include if user expressed them:
    // "name" — if user gave the AI a name or nickname
    // "personality" — desired AI personality (e.g. "direct", "supportive", "witty")
    // "communication_style" — how user wants AI to communicate
    // "tone" — desired tone (e.g. "warm", "professional", "playful")
  }
}

Rules:
- Extract primarily from the USER's words. Also extract facts from Myway's statements that the user confirms, agrees with, or does not dispute (e.g., if Myway says "looks like you're in Toronto" and the user continues without correcting, infer location=Toronto).
- Be thorough — capture EVERYTHING the user revealed. Small details matter. More data is always better.
- Be accurate — only extract what is clearly stated or strongly implied.
- The "name" field in profile is REQUIRED — always extract it. Parse it from natural speech like "my name is ...", "I'm ...", "call me ...".
- Create multiple memories for different facts — don't combine unrelated facts into one.
- For every person mentioned by the user, create a "fact" memory AND add them to relevant task contexts.
- Extract tasks from any mention of plans, goals, things to do, or intentions.
- Duplicate important facts across profile fields, memories, AND signals for maximum recall. E.g., if user mentions their spouse, set profile.spouse, create a fact memory, AND set user.relationship_status signal.
- Return valid JSON only, no markdown fences, no explanation.`

/**
 * Extract structured facts from a full onboarding conversation transcript.
 *
 * This is the primary extraction path for Gemini Live onboarding. Instead of
 * extracting per-step, we process the entire conversation at once — giving
 * the LLM full context to extract richer, more connected facts.
 *
 * @param transcript - Full conversation transcript (alternating user/model turns)
 * @param browserTimezone - IANA timezone from browser (saved directly to profile)
 * @returns ExtractedFacts ready for saveFacts()
 */
export async function extractConversationFacts(
  transcript: string,
  browserTimezone: string,
): Promise<ExtractedFacts> {
  const result = await callLLM(
    CONVERSATION_EXTRACTION_PROMPT,
    `Full onboarding conversation transcript:\n\n${transcript}`,
    4096,
    0.3,
  )

  if (!result) {
    throw new Error('LLM returned empty response')
  }

  const cleaned = result.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  let parsed: Partial<ExtractedFacts>
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    // LLM may return truncated JSON — try to repair by closing open structures
    console.warn(`[extractConversationFacts] JSON parse failed, attempting repair. Raw (first 500 chars): ${cleaned.slice(0, 500)}`)
    parsed = JSON.parse(repairJson(cleaned))
  }
  const facts: ExtractedFacts = {
    profile: parsed.profile && typeof parsed.profile === 'object' ? parsed.profile : {},
    memories: Array.isArray(parsed.memories) ? parsed.memories : [],
    signals: Array.isArray(parsed.signals) ? parsed.signals : [],
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    aiIdentity: parsed.aiIdentity && typeof parsed.aiIdentity === 'object' ? parsed.aiIdentity : {},
  }

  // Always set timezone from browser (most reliable source)
  facts.profile.timezone = browserTimezone

  // Always set onboarding timestamps
  facts.profile.onboarding_completed_at = new Date().toISOString()
  if (!facts.profile.onboarding_started_at) {
    facts.profile.onboarding_started_at = new Date().toISOString()
  }

  return facts
}

/**
 * Persist extracted facts to DB tables.
 * Wrapped in a transaction so all-or-nothing on failure.
 */
export function saveFacts(db: Database, facts: ExtractedFacts): void {
  db.transaction(() => {
    // user_profile
    if (Object.keys(facts.profile).length > 0) {
      setProfile(db, 'user', facts.profile)
    }

    // memories (global, readable by all apps)
    for (const mem of facts.memories) {
      const validTypes: MemoryType[] = ['fact', 'preference', 'event', 'personality']
      if (validTypes.includes(mem.type) && mem.content?.trim()) {
        addMemory(db, {
          type: mem.type,
          content: mem.content.trim(),
          appId: null,
          metadata: { source: 'onboarding' },
        })
      }
    }

    // personality_state
    const validSignals = facts.signals.filter(
      s => s.key?.includes('.') && s.value?.trim(),
    )
    if (validSignals.length > 0) {
      setSignals(
        db,
        validSignals.map(s => ({
          key: s.key,
          value: s.value.trim(),
          confidence: s.confidence ?? 1.0,
        })),
        'onboarding',
      )
    }

    // tasks (from goals/plans mentioned in conversation)
    if (facts.tasks && facts.tasks.length > 0) {
      for (const task of facts.tasks) {
        if (task.title?.trim()) {
          // Parse ISO date to unix epoch if provided
          let dueAt: number | undefined
          if (task.dueAt) {
            const parsed = new Date(task.dueAt).getTime()
            if (!isNaN(parsed)) dueAt = Math.floor(parsed / 1000)
          }
          addTask(db, {
            appId: 'tasks',
            title: task.title.trim(),
            description: task.description?.trim() || undefined,
            priority: task.priority ?? 5,
            dueAt: dueAt ?? undefined,
            context: task.context ?? undefined,
            source: 'system',
          })
        }
      }
    }

    // ai_profile (AI identity/personality preferences from conversation)
    if (facts.aiIdentity && Object.keys(facts.aiIdentity).length > 0) {
      const validFields: Record<string, string> = {}
      for (const [key, value] of Object.entries(facts.aiIdentity)) {
        if (typeof value === 'string' && value.trim()) {
          validFields[key] = value.trim()
        }
      }
      if (Object.keys(validFields).length > 0) {
        setProfile(db, 'ai', validFields, 'onboarding')
        console.log(`[onboarding] Saved AI identity preferences:`, Object.keys(validFields).join(', '))
      }
    }
  })()

  // Cache invalidation outside transaction (non-critical)
  if (Object.keys(facts.profile).length > 0) {
    invalidateWorkspaceCache()
  }
}

// ─── Visitor cookie helpers ─────────────────────────────────────────────────
// For visitors without auth, facts are stored in an HMAC-signed HttpOnly cookie.

export interface VisitorOnboardingData {
  name?: string
  goal?: string
  plans?: string
  timezone?: string
  facts: ExtractedFacts
  completedAt?: string
}

const COOKIE_NAME = 'myway_onboarding'
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 // 7 days

function getSecret(): string {
  return process.env.MYWAY_SECRET?.trim() || 'myway-default-secret'
}

export function signVisitorCookie(data: VisitorOnboardingData): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${sig}`
}

export function verifyVisitorCookie(cookie: string): VisitorOnboardingData | null {
  const dotIndex = cookie.indexOf('.')
  if (dotIndex === -1) return null
  const payload = cookie.slice(0, dotIndex)
  const sig = cookie.slice(dotIndex + 1)
  const expected = createHmac('sha256', getSecret()).update(payload).digest('hex')
  if (sig !== expected) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as VisitorOnboardingData
  } catch {
    return null
  }
}

export function visitorCookieOptions() {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  }
}

export { COOKIE_NAME as VISITOR_COOKIE_NAME }

// ─── Name extraction ────────────────────────────────────────────────────────

/**
 * Extract name from user input. Returns name or null if input is too complex.
 * Simple heuristic: 1–3 words → treat as name. Longer → pattern-match.
 * Caller should fall back to LLM extraction if null.
 */
export function extractName(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // 1–3 words: treat entire input as name
  const words = trimmed.split(/\s+/)
  if (words.length <= 3) {
    return words
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
  }

  // Longer: try common patterns
  const patterns = [
    /(?:my name is|i'm|i am|call me|it's|they call me)\s+(.+)/i,
    /^(?:hi|hey|hello),?\s*(?:i'm|i am|my name is)\s+(.+)/i,
  ]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match?.[1]) {
      const nameWords = match[1].trim().split(/\s+/).slice(0, 3)
      return nameWords
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
    }
  }

  return null
}

// ─── City → IANA timezone lookup ────────────────────────────────────────────

const CITY_TIMEZONES: Record<string, string> = {
  // Canada
  toronto: 'America/Toronto',
  vancouver: 'America/Vancouver',
  montreal: 'America/Toronto',
  ottawa: 'America/Toronto',
  calgary: 'America/Edmonton',
  edmonton: 'America/Edmonton',
  winnipeg: 'America/Winnipeg',
  halifax: 'America/Halifax',
  'st johns': 'America/St_Johns',
  regina: 'America/Regina',
  kitchener: 'America/Toronto',
  waterloo: 'America/Toronto',
  // US
  'new york': 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  chicago: 'America/Chicago',
  houston: 'America/Chicago',
  phoenix: 'America/Phoenix',
  'san francisco': 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  denver: 'America/Denver',
  miami: 'America/New_York',
  boston: 'America/New_York',
  dallas: 'America/Chicago',
  atlanta: 'America/New_York',
  detroit: 'America/Detroit',
  portland: 'America/Los_Angeles',
  austin: 'America/Chicago',
  nashville: 'America/Chicago',
  // International
  london: 'Europe/London',
  lagos: 'Africa/Lagos',
  nairobi: 'Africa/Nairobi',
  dubai: 'Asia/Dubai',
  singapore: 'Asia/Singapore',
  sydney: 'Australia/Sydney',
  tokyo: 'Asia/Tokyo',
  paris: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  'hong kong': 'Asia/Hong_Kong',
  'sao paulo': 'America/Sao_Paulo',
  'mexico city': 'America/Mexico_City',
  johannesburg: 'Africa/Johannesburg',
  cairo: 'Africa/Cairo',
  accra: 'Africa/Accra',
  bangkok: 'Asia/Bangkok',
  jakarta: 'Asia/Jakarta',
  istanbul: 'Europe/Istanbul',
  seoul: 'Asia/Seoul',
  amsterdam: 'Europe/Amsterdam',
  zurich: 'Europe/Zurich',
  rome: 'Europe/Rome',
  madrid: 'Europe/Madrid',
  lisbon: 'Europe/Lisbon',
  dublin: 'Europe/Dublin',
  'tel aviv': 'Asia/Jerusalem',
  auckland: 'Pacific/Auckland',
  melbourne: 'Australia/Melbourne',
  perth: 'Australia/Perth',
  brisbane: 'Australia/Brisbane',
  riyadh: 'Asia/Riyadh',
  doha: 'Asia/Qatar',
  'kuala lumpur': 'Asia/Kuala_Lumpur',
  manila: 'Asia/Manila',
  abuja: 'Africa/Lagos',
}

const TIMEZONE_ABBREVS: Record<string, string> = {
  est: 'America/New_York',
  eastern: 'America/New_York',
  cst: 'America/Chicago',
  central: 'America/Chicago',
  mst: 'America/Denver',
  mountain: 'America/Denver',
  pst: 'America/Los_Angeles',
  pacific: 'America/Los_Angeles',
  gmt: 'Europe/London',
  utc: 'UTC',
  bst: 'Europe/London',
  cet: 'Europe/Paris',
  ist: 'Asia/Kolkata',
  jst: 'Asia/Tokyo',
  aest: 'Australia/Sydney',
  wat: 'Africa/Lagos',
  eat: 'Africa/Nairobi',
  ast: 'America/Halifax',
}

/**
 * Resolve a city name, abbreviation, or IANA string to a valid IANA timezone.
 * Returns null if unrecognizable.
 */
export function resolveTimezone(input: string): string | null {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return null

  // Direct IANA timezone (contains "/")
  if (normalized.includes('/')) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: input.trim() })
      return input.trim()
    } catch {
      return null
    }
  }

  // City lookup (exact)
  if (CITY_TIMEZONES[normalized]) return CITY_TIMEZONES[normalized]

  // Abbreviation
  if (TIMEZONE_ABBREVS[normalized]) return TIMEZONE_ABBREVS[normalized]

  // Fuzzy: check if input contains a known city
  for (const [city, tz] of Object.entries(CITY_TIMEZONES)) {
    if (normalized.includes(city) || city.includes(normalized)) {
      return tz
    }
  }

  return null
}

/**
 * Format an IANA timezone for friendly display.
 * "America/New_York" → "New York", "Europe/London" → "London"
 */
export function friendlyTimezone(iana: string): string {
  const city = iana.split('/').pop() || iana
  return city.replace(/_/g, ' ')
}

// ─── LLM helper ─────────────────────────────────────────────────────────────

/**
 * Non-streaming LLM call using the fast model class (Gemini Flash).
 */
async function callLLM(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 200,
  temperature = 0.7,
): Promise<string> {
  const { model, baseUrl, token } = resolveModelForApp(undefined, undefined, 'fast')

  const url = chatCompletionsUrl(baseUrl)
  console.log(`[callLLM] model=${model} url=${url} maxTokens=${maxTokens}`)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: false,
      max_completion_tokens: maxTokens,
      temperature,
    }),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => 'Unknown error')
    throw new Error(`LLM call failed (${res.status}): ${errBody}`)
  }

  const data = await res.json() as {
    choices: { message: { content: string }; finish_reason?: string }[]
  }

  const finishReason = data.choices?.[0]?.finish_reason
  const content = data.choices?.[0]?.message?.content?.trim() ?? ''

  if (finishReason === 'length') {
    console.warn(`[callLLM] Response truncated (finish_reason=length, ${content.length} chars). Consider increasing maxTokens.`)
  }

  return content
}

/**
 * Attempt to repair truncated JSON from LLM output.
 * Closes any open strings, arrays, and objects so JSON.parse can succeed.
 */
function repairJson(s: string): string {
  let inString = false
  let escape = false
  const stack: string[] = []

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{' || ch === '[') stack.push(ch)
    if (ch === '}' || ch === ']') stack.pop()
  }

  // Close open string
  let repaired = s
  if (inString) repaired += '"'

  // Close open structures in reverse order
  while (stack.length) {
    const open = stack.pop()
    // Trim trailing comma before closing
    repaired = repaired.replace(/,\s*$/, '')
    repaired += open === '{' ? '}' : ']'
  }

  return repaired
}

/**
 * Extract a name from longer input using LLM.
 * Only called when the heuristic extractName() returns null.
 */
export async function extractNameWithLLM(input: string): Promise<string | null> {
  try {
    const result = await callLLM(
      'You are a name extractor. Return only the first name, no punctuation, no explanation.',
      `Extract the person's first name from this input: ${input}`,
    )
    const name = result.trim().replace(/[."']/g, '')
    return name || null
  } catch {
    return null
  }
}

// ─── Step processors ────────────────────────────────────────────────────────

/**
 * Process the name step: extract name + bonus facts, save to DB.
 * Returns pre-cached step2 text (no name mention).
 */
export async function processNameStep(
  db: Database,
  rawInput: string,
  name: string,
): Promise<StepResult> {
  // Save name + start onboarding
  setProfile(db, 'user', {
    name,
    onboarding_started_at: new Date().toISOString(),
  })
  invalidateWorkspaceCache()

  // Extract any bonus facts from the name response
  // e.g. "I'm Sarah, a teacher from Denver" → location, occupation
  const facts = await extractFacts('name — the user was asked their name', rawInput)
  // Ensure name is in profile facts
  facts.profile.name = name
  saveFacts(db, facts)

  return { text: STEP2_TEXT, step: 'goal', name, facts }
}

/**
 * Process the goal step: extract facts, save goal, return step 3 text.
 * Also pre-generates the magic moment in the background.
 */
export async function processGoalStep(
  db: Database,
  goal: string,
  browserTimezone: string,
): Promise<StepResult> {
  // Save goal
  setProfile(db, 'user', { primary_goal: goal })

  // Save timezone from browser auto-detection
  const timezone = browserTimezone || 'UTC'
  setProfile(db, 'user', { timezone })
  invalidateWorkspaceCache()

  // Extract facts from goal response
  const facts = await extractFacts(
    'goal — the user was asked "what\'s one thing on your mind today?"',
    goal,
  )
  facts.profile.primary_goal = goal
  saveFacts(db, facts)

  // Build step 3 text with friendly timezone
  const friendlyTz = friendlyTimezone(timezone)
  const text = `I see you're in ${friendlyTz}. Hope I'm right? What do you have planned for today?`

  // Pre-generate magic moment in background (fire-and-forget)
  preGenerateMagicMoment(db)

  return { text, step: 'plans', facts }
}

/**
 * Process the plans step: extract facts, mark onboarding complete,
 * return the pre-generated magic moment.
 */
export async function processPlansStep(
  db: Database,
  plans: string,
): Promise<StepResult> {
  // Extract facts from plans response
  const facts = await extractFacts(
    'plans — the user was asked "what do you have planned for today?"',
    plans,
  )
  saveFacts(db, facts)

  // Mark onboarding complete
  setProfile(db, 'user', { onboarding_completed_at: new Date().toISOString() })
  invalidateWorkspaceCache()

  // Generate context callback for first return visit (US-012, fire-and-forget)
  generateContextCallback(db).catch(() => {})

  // Get the pre-generated magic moment (or generate now if not ready)
  const text = await awaitMagicMoment(db)

  // Read name for the result
  let name = 'friend'
  try {
    const row = db.prepare(
      `SELECT value FROM user_profile WHERE key = 'name'`,
    ).get() as { value: string } | undefined
    if (row?.value) name = row.value
  } catch { /* */ }

  return { text, step: 'complete', name, facts }
}

// ─── Magic moment pre-generation ────────────────────────────────────────────

/**
 * Module-level cache for pre-generated magic moments.
 * Key: DB path (unique per tenant). Value: Promise<string>.
 */
const magicMomentCache = new Map<string, Promise<string>>()

function dbKey(db: Database): string {
  return (db as unknown as { name: string }).name || 'default'
}

/**
 * Fire-and-forget magic moment generation. Called during goal step
 * so the result is ready by the time the user finishes step 3.
 */
function preGenerateMagicMoment(db: Database): void {
  const key = dbKey(db)
  if (magicMomentCache.has(key)) return
  magicMomentCache.set(key, generateMagicMoment(db))
}

/**
 * Await the pre-generated magic moment, with timeout + fallback.
 */
async function awaitMagicMoment(db: Database): Promise<string> {
  const key = dbKey(db)
  const cached = magicMomentCache.get(key)

  if (cached) {
    magicMomentCache.delete(key)
    try {
      // 10s timeout — if LLM is slow, fall back
      const result = await Promise.race([
        cached,
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 10_000),
        ),
      ])
      if (result) return result
    } catch { /* timeout or error */ }
  }

  // Not pre-generated or timed out — generate now
  return generateMagicMoment(db)
}

/**
 * Generate the personalized magic moment (US-004).
 * Reads all accumulated facts from DB to create a genuinely helpful response.
 */
async function generateMagicMoment(db: Database): Promise<string> {
  let name = 'friend'
  let goal = ''
  let timezone = ''
  try {
    const rows = db.prepare(
      `SELECT key, value FROM user_profile WHERE key IN ('name', 'primary_goal', 'timezone')`,
    ).all() as { key: string; value: string }[]
    for (const r of rows) {
      if (r.key === 'name') name = r.value
      if (r.key === 'primary_goal') goal = r.value
      if (r.key === 'timezone') timezone = r.value
    }
  } catch { /* */ }

  // Read any extracted memories for richer context
  let memoryContext = ''
  try {
    const memories = db.prepare(
      `SELECT type, content FROM memories
       WHERE app_id IS NULL AND is_deleted = 0
       ORDER BY created_at DESC LIMIT 10`,
    ).all() as { type: string; content: string }[]
    if (memories.length > 0) {
      memoryContext = '\n\nExtracted facts about this user:\n' +
        memories.map(m => `- [${m.type}] ${m.content}`).join('\n')
    }
  } catch { /* */ }

  const fallback = `Welcome home, ${name}. I'm here whenever you need me — let's make something happen.`

  try {
    const text = await callLLM(
      'You are Myway, a personal AI that knows this user. Be genuinely helpful. No preamble.',
      `The user just completed onboarding. Their name is ${name}, timezone is ${timezone}, and they mentioned: ${goal || 'nothing specific yet'}.${memoryContext}\n\nGenerate a single, genuinely helpful response about their goal — as if you already know them. Keep it under 60 words. No preamble. No "As your personal AI..." Just help them.`,
    )
    return text || fallback
  } catch {
    return fallback
  }
}

// ─── Context Callback (US-012) ──────────────────────────────────────────────

/**
 * Generate and store a context callback message for the user's first return visit.
 * Called at onboarding completion. Fire-and-forget — never blocks onboarding.
 *
 * The message references the user's primary_goal so the first return visit
 * feels personal ("How's that product launch prep going?").
 */
export async function generateContextCallback(db: Database): Promise<void> {
  try {
    const rows = db.prepare(
      `SELECT key, value FROM user_profile WHERE key IN ('name', 'primary_goal')`,
    ).all() as { key: string; value: string }[]

    const fields = new Map(rows.map(r => [r.key, r.value]))
    const name = fields.get('name') || 'friend'
    const goal = fields.get('primary_goal') || ''

    if (!goal) {
      // No goal captured — use a generic welcome-back
      setProfile(db, 'user', {
        context_callback_text: `Welcome back, ${name}. Ready to pick up where we left off?`,
      }, 'system')
      return
    }

    const message = await callLLM(
      'You are Myway, a warm personal AI assistant. Write a single check-in sentence for a user returning after onboarding. Max 15 words. Reference their goal naturally. No preamble, no quotes, no emojis.',
      `User's name: ${name}\nThey mentioned this was on their mind: "${goal}"\n\nWrite one warm check-in sentence.`,
      60,
      0.7,
    )

    setProfile(db, 'user', {
      context_callback_text: message || `Welcome back, ${name}. How's "${goal}" coming along?`,
    }, 'system')
  } catch (e) {
    console.error('[onboarding] Context callback generation failed:', e instanceof Error ? e.message : e)
  }
}

// ─── Onboarding status ─────────────────────────────────────────────────────

/**
 * Check if onboarding has been completed.
 *
 * Returns true if either:
 *  1. The explicit onboarding_completed_at flag is set, OR
 *  2. The user already has meaningful context (name + memories/messages)
 *     — covers OpenClaw users who skipped formal onboarding.
 */
export function isOnboardingComplete(db: Database): boolean {
  try {
    const row = db.prepare(
      `SELECT value FROM user_profile WHERE key = 'onboarding_completed_at'`,
    ).get() as { value: string } | undefined
    if (row?.value) return true

    // Heuristic: if user has a name AND any memories or messages, they've been
    // using the app and should not be forced through onboarding again.
    const name = db.prepare(
      `SELECT value FROM user_profile WHERE key = 'name'`,
    ).get() as { value: string } | undefined
    if (name?.value) {
      const hasContext = db.prepare(
        `SELECT 1 FROM memories WHERE is_deleted = 0 LIMIT 1`,
      ).get()
      if (hasContext) return true

      const hasMessages = db.prepare(
        `SELECT 1 FROM messages WHERE is_deleted = 0 LIMIT 1`,
      ).get()
      if (hasMessages) return true
    }

    return false
  } catch {
    return false
  }
}

/**
 * Get onboarding resume state (for users who started but didn't finish).
 */
export function getOnboardingResumeState(db: Database): {
  step: OnboardingStep | null
  name: string | null
} {
  try {
    const rows = db.prepare(
      `SELECT key, value FROM user_profile WHERE key IN ('name', 'onboarding_started_at', 'primary_goal', 'timezone', 'onboarding_completed_at')`,
    ).all() as { key: string; value: string }[]

    const fields = new Map(rows.map(r => [r.key, r.value]))

    if (fields.get('onboarding_completed_at')) return { step: null, name: null }
    if (!fields.get('onboarding_started_at')) return { step: null, name: null }

    const name = fields.get('name') || null

    // Determine where they left off
    if (fields.get('primary_goal')) return { step: 'plans', name }
    if (name) return { step: 'goal', name }

    return { step: 'name', name: null }
  } catch {
    return { step: null, name: null }
  }
}
