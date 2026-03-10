/**
 * Tests for Gemini Live onboarding — full-conversation extraction, saveFacts,
 * visitor cookie helpers, friendlyTimezone, and the live API routes.
 *
 * Covers the data capture path end-to-end: transcript → extractConversationFacts
 * → saveFacts → DB (user_profile, memories, personality_state).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

// ─── Mock model-registry (controls LLM calls) ──────────────────────────────

let mockLLMResponse = '{}'

vi.mock('@/lib/model-registry', () => ({
  resolveModelForApp: vi.fn(() => ({
    model: 'test-model',
    baseUrl: 'http://localhost:9999',
    token: 'test-token',
  })),
}))

// ─── Mock fetch (for LLM HTTP calls) ────────────────────────────────────────

const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: mockLLMResponse } }],
    }),
    text: async () => mockLLMResponse,
  })) as any
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

// ─── Mock workspace-context ─────────────────────────────────────────────────

vi.mock('@/lib/workspace-context', () => ({
  invalidateWorkspaceCache: vi.fn(),
}))

// ─── Mock fs (profile-sync reads workspace files) ───────────────────────────

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => { throw new Error('ENOENT') }),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
  }
})

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import {
  extractConversationFacts,
  extractFacts,
  extractName,
  extractNameWithLLM,
  saveFacts,
  friendlyTimezone,
  signVisitorCookie,
  verifyVisitorCookie,
  visitorCookieOptions,
  VISITOR_COOKIE_NAME,
  type ExtractedFacts,
  type VisitorOnboardingData,
} from '@/lib/onboarding'

// ─── Test DB helper ─────────────────────────────────────────────────────────

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_by TEXT NOT NULL DEFAULT 'user'
    );
    CREATE TABLE IF NOT EXISTS ai_profile (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_by TEXT NOT NULL DEFAULT 'user'
    );
    CREATE TABLE IF NOT EXISTS identity (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'system'
    );
    CREATE TABLE IF NOT EXISTS memories (
      id           TEXT PRIMARY KEY,
      app_id       TEXT,
      type         TEXT NOT NULL CHECK(type IN (
                     'preference','fact','event','personality',
                     'skill_event','chat_summary','artifact_ref'
                   )),
      content      TEXT NOT NULL,
      metadata     TEXT NOT NULL DEFAULT '{}',
      embedding_id TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      is_deleted   INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS personality_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      updated_by TEXT NOT NULL DEFAULT 'system',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `)
  return db
}

// ─── friendlyTimezone ───────────────────────────────────────────────────────

describe('friendlyTimezone', () => {
  it('extracts city from IANA timezone', () => {
    expect(friendlyTimezone('America/New_York')).toBe('New York')
    expect(friendlyTimezone('Europe/London')).toBe('London')
    expect(friendlyTimezone('Asia/Kolkata')).toBe('Kolkata')
  })

  it('replaces underscores with spaces', () => {
    expect(friendlyTimezone('America/Los_Angeles')).toBe('Los Angeles')
    expect(friendlyTimezone('America/St_Johns')).toBe('St Johns')
  })

  it('handles UTC', () => {
    expect(friendlyTimezone('UTC')).toBe('UTC')
  })

  it('handles single-part timezone', () => {
    expect(friendlyTimezone('GMT')).toBe('GMT')
  })
})

// ─── extractConversationFacts ───────────────────────────────────────────────

describe('extractConversationFacts', () => {
  it('extracts profile, memories, and signals from transcript', async () => {
    mockLLMResponse = JSON.stringify({
      profile: { name: 'Sarah', occupation: 'teacher' },
      memories: [{ type: 'fact', content: 'Works as a teacher' }],
      signals: [{ key: 'user.occupation', value: 'teacher', confidence: 1.0 }],
    })

    const facts = await extractConversationFacts(
      'User: My name is Sarah, I am a teacher\nMyway: Nice to meet you!',
      'America/Toronto',
    )

    expect(facts.profile.name).toBe('Sarah')
    expect(facts.profile.occupation).toBe('teacher')
    expect(facts.profile.timezone).toBe('America/Toronto')
    expect(facts.profile.onboarding_completed_at).toBeDefined()
    expect(facts.profile.onboarding_started_at).toBeDefined()
    expect(facts.memories).toHaveLength(1)
    expect(facts.memories[0].type).toBe('fact')
    expect(facts.signals).toHaveLength(1)
    expect(facts.signals[0].key).toBe('user.occupation')
  })

  it('always overrides timezone with browser timezone', async () => {
    mockLLMResponse = JSON.stringify({
      profile: { name: 'Test', timezone: 'Wrong/Timezone' },
      memories: [],
      signals: [],
    })

    const facts = await extractConversationFacts('User: Hi', 'America/Chicago')
    expect(facts.profile.timezone).toBe('America/Chicago')
  })

  it('always sets onboarding timestamps', async () => {
    mockLLMResponse = JSON.stringify({ profile: { name: 'Test' }, memories: [], signals: [] })

    const facts = await extractConversationFacts('User: Hi', 'UTC')
    expect(facts.profile.onboarding_completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(facts.profile.onboarding_started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('throws on LLM failure', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, text: async () => 'error' })) as any

    await expect(extractConversationFacts('User: Hi', 'UTC')).rejects.toThrow('LLM call failed')
  })

  it('throws on completely malformed JSON from LLM', async () => {
    mockLLMResponse = 'not json at all'

    await expect(extractConversationFacts('User: Hi', 'UTC')).rejects.toThrow()
  })

  it('strips markdown fences from LLM response', async () => {
    mockLLMResponse = '```json\n{"profile":{"name":"Fenced"},"memories":[],"signals":[]}\n```'

    const facts = await extractConversationFacts('User: Hi', 'UTC')
    expect(facts.profile.name).toBe('Fenced')
  })

  it('handles partial LLM response (missing fields)', async () => {
    mockLLMResponse = JSON.stringify({ profile: { name: 'Partial' } })

    const facts = await extractConversationFacts('User: Hi', 'UTC')
    expect(facts.profile.name).toBe('Partial')
    expect(facts.memories).toEqual([])
    expect(facts.signals).toEqual([])
  })

  it('repairs truncated JSON from LLM', async () => {
    // Simulate a response cut off mid-string (like the real error)
    mockLLMResponse = '{"profile":{"name":"Uchi","primary_goal":"cook fries"},"memories":[{"type":"fact","content":"loves wife Jen'

    const facts = await extractConversationFacts('User: Hi', 'UTC')
    expect(facts.profile.name).toBe('Uchi')
    expect(facts.profile.primary_goal).toBe('cook fries')
    // Truncated memory may or may not survive, but extraction shouldn't throw
  })
})

// ─── extractFacts (per-step extraction) ─────────────────────────────────────

describe('extractFacts', () => {
  it('extracts facts from user input', async () => {
    mockLLMResponse = JSON.stringify({
      profile: { name: 'Alice' },
      memories: [{ type: 'fact', content: 'Introduced herself as Alice' }],
      signals: [],
    })

    const facts = await extractFacts('name — the user was asked their name', 'My name is Alice')
    expect(facts.profile.name).toBe('Alice')
    expect(facts.memories).toHaveLength(1)
  })

  it('returns empty facts on LLM error', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('Network error') }) as any

    const facts = await extractFacts('name', 'test')
    expect(facts.profile).toEqual({})
    expect(facts.memories).toEqual([])
    expect(facts.signals).toEqual([])
  })
})

// ─── extractNameWithLLM ─────────────────────────────────────────────────────

describe('extractNameWithLLM', () => {
  it('returns extracted name from LLM', async () => {
    mockLLMResponse = 'Sarah'

    const name = await extractNameWithLLM('My name is Sarah and I love coding')
    expect(name).toBe('Sarah')
  })

  it('strips punctuation from LLM response', async () => {
    mockLLMResponse = '"Sarah."'

    const name = await extractNameWithLLM('I am Sarah')
    expect(name).toBe('Sarah')
  })

  it('returns null on LLM failure', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('fail') }) as any

    const name = await extractNameWithLLM('test')
    expect(name).toBeNull()
  })

  it('returns null on empty LLM response', async () => {
    mockLLMResponse = '   '

    const name = await extractNameWithLLM('some long input with no clear name')
    expect(name).toBeNull()
  })
})

// ─── saveFacts ──────────────────────────────────────────────────────────────

describe('saveFacts', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('saves profile fields to user_profile table', () => {
    const facts: ExtractedFacts = {
      profile: { name: 'Sarah', timezone: 'America/Toronto', primary_goal: 'Ship my app' },
      memories: [],
      signals: [],
    }

    saveFacts(db, facts)

    const rows = db.prepare('SELECT key, value FROM user_profile ORDER BY key').all() as { key: string; value: string }[]
    const map = new Map(rows.map(r => [r.key, r.value]))
    expect(map.get('name')).toBe('Sarah')
    expect(map.get('timezone')).toBe('America/Toronto')
    expect(map.get('primary_goal')).toBe('Ship my app')
  })

  it('saves valid memories to memories table', () => {
    const facts: ExtractedFacts = {
      profile: {},
      memories: [
        { type: 'fact', content: 'Works as an engineer' },
        { type: 'preference', content: 'Prefers morning routines' },
        { type: 'event', content: 'Has a meeting tomorrow' },
        { type: 'personality', content: 'Very enthusiastic' },
      ],
      signals: [],
    }

    saveFacts(db, facts)

    const rows = db.prepare('SELECT type, content FROM memories WHERE is_deleted = 0').all() as { type: string; content: string }[]
    expect(rows).toHaveLength(4)
    expect(rows.map(r => r.type)).toEqual(['fact', 'preference', 'event', 'personality'])
  })

  it('filters out invalid memory types', () => {
    const facts: ExtractedFacts = {
      profile: {},
      memories: [
        { type: 'fact', content: 'Valid memory' },
        { type: 'invalid_type' as any, content: 'Should be dropped' },
      ],
      signals: [],
    }

    saveFacts(db, facts)

    const rows = db.prepare('SELECT type FROM memories WHERE is_deleted = 0').all() as { type: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('fact')
  })

  it('filters out memories with empty content', () => {
    const facts: ExtractedFacts = {
      profile: {},
      memories: [
        { type: 'fact', content: '' },
        { type: 'fact', content: '   ' },
        { type: 'fact', content: 'Valid' },
      ],
      signals: [],
    }

    saveFacts(db, facts)

    const rows = db.prepare('SELECT content FROM memories WHERE is_deleted = 0').all() as { content: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('Valid')
  })

  it('trims memory content whitespace', () => {
    const facts: ExtractedFacts = {
      profile: {},
      memories: [{ type: 'fact', content: '  Works as an engineer  ' }],
      signals: [],
    }

    saveFacts(db, facts)

    const row = db.prepare('SELECT content FROM memories').get() as { content: string }
    expect(row.content).toBe('Works as an engineer')
  })

  it('saves memories with appId = null (global)', () => {
    const facts: ExtractedFacts = {
      profile: {},
      memories: [{ type: 'fact', content: 'Global memory' }],
      signals: [],
    }

    saveFacts(db, facts)

    const row = db.prepare('SELECT app_id FROM memories').get() as { app_id: string | null }
    expect(row.app_id).toBeNull()
  })

  it('saves valid signals to personality_state table', () => {
    const facts: ExtractedFacts = {
      profile: {},
      memories: [],
      signals: [
        { key: 'user.mood', value: 'excited', confidence: 0.8 },
        { key: 'user.occupation', value: 'engineer', confidence: 1.0 },
        { key: 'user.energy', value: 'high' },
      ],
    }

    saveFacts(db, facts)

    const rows = db.prepare('SELECT key, value, confidence, updated_by FROM personality_state ORDER BY key').all() as {
      key: string; value: string; confidence: number; updated_by: string
    }[]
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ key: 'user.energy', value: 'high', confidence: 1.0, updated_by: 'onboarding' })
    expect(rows[1]).toMatchObject({ key: 'user.mood', value: 'excited', confidence: 0.8, updated_by: 'onboarding' })
    expect(rows[2]).toMatchObject({ key: 'user.occupation', value: 'engineer', confidence: 1.0, updated_by: 'onboarding' })
  })

  it('defaults signal confidence to 1.0 when not provided', () => {
    const facts: ExtractedFacts = {
      profile: {},
      memories: [],
      signals: [{ key: 'user.mood', value: 'happy' }],
    }

    saveFacts(db, facts)

    const row = db.prepare('SELECT confidence FROM personality_state WHERE key = ?').get('user.mood') as { confidence: number }
    expect(row.confidence).toBe(1.0)
  })

  it('filters out signals without domain.key format', () => {
    const facts: ExtractedFacts = {
      profile: {},
      memories: [],
      signals: [
        { key: 'user.mood', value: 'happy' },
        { key: 'user.energy', value: 'high' },
        { key: 'mood', value: 'sad' },         // no dot → filtered
        { key: 'justvalue', value: 'nope' },    // no dot → filtered
      ],
    }

    saveFacts(db, facts)

    const rows = db.prepare('SELECT key FROM personality_state ORDER BY key').all() as { key: string }[]
    expect(rows).toHaveLength(2)
    expect(rows[0].key).toBe('user.energy')
    expect(rows[1].key).toBe('user.mood')
  })

  it('filters out signals with empty values', () => {
    const facts: ExtractedFacts = {
      profile: {},
      memories: [],
      signals: [
        { key: 'user.mood', value: '' },
        { key: 'user.energy', value: '   ' },
        { key: 'user.occupation', value: 'engineer' },
      ],
    }

    saveFacts(db, facts)

    const rows = db.prepare('SELECT key FROM personality_state').all() as { key: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('user.occupation')
  })

  it('trims signal values', () => {
    const facts: ExtractedFacts = {
      profile: {},
      memories: [],
      signals: [{ key: 'user.mood', value: '  happy  ' }],
    }

    saveFacts(db, facts)

    const row = db.prepare('SELECT value FROM personality_state WHERE key = ?').get('user.mood') as { value: string }
    expect(row.value).toBe('happy')
  })

  it('does nothing with empty facts', () => {
    const facts: ExtractedFacts = { profile: {}, memories: [], signals: [] }

    saveFacts(db, facts)

    expect(db.prepare('SELECT COUNT(*) as c FROM user_profile').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) as c FROM memories').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) as c FROM personality_state').get()).toEqual({ c: 0 })
  })

  it('handles full end-to-end extraction and save', () => {
    const facts: ExtractedFacts = {
      profile: {
        name: 'Uchi',
        timezone: 'America/Toronto',
        primary_goal: 'Ship Myway Phase 1',
        occupation: 'founder',
        onboarding_completed_at: '2026-03-08T10:00:00.000Z',
      },
      memories: [
        { type: 'fact', content: 'Founder of LiftRails' },
        { type: 'event', content: 'Working on Phase 1 launch' },
        { type: 'personality', content: 'Driven and focused' },
      ],
      signals: [
        { key: 'user.occupation', value: 'founder', confidence: 1.0 },
        { key: 'user.mood', value: 'determined', confidence: 0.7 },
        { key: 'user.energy', value: 'high', confidence: 0.8 },
      ],
    }

    saveFacts(db, facts)

    // Verify profile
    const profileRows = db.prepare('SELECT key, value FROM user_profile ORDER BY key').all() as { key: string; value: string }[]
    expect(profileRows.length).toBeGreaterThanOrEqual(4)
    const profileMap = new Map(profileRows.map(r => [r.key, r.value]))
    expect(profileMap.get('name')).toBe('Uchi')
    expect(profileMap.get('timezone')).toBe('America/Toronto')
    expect(profileMap.get('primary_goal')).toBe('Ship Myway Phase 1')

    // Verify memories
    const memRows = db.prepare('SELECT type, content FROM memories ORDER BY created_at').all() as { type: string; content: string }[]
    expect(memRows).toHaveLength(3)

    // Verify signals
    const sigRows = db.prepare('SELECT key, value, confidence FROM personality_state ORDER BY key').all() as {
      key: string; value: string; confidence: number
    }[]
    expect(sigRows).toHaveLength(3)
    expect(sigRows.find(s => s.key === 'user.mood')?.confidence).toBe(0.7)
  })
})

// ─── Visitor cookie helpers ─────────────────────────────────────────────────

describe('signVisitorCookie / verifyVisitorCookie', () => {
  const testData: VisitorOnboardingData = {
    name: 'Sarah',
    goal: 'Learn to code',
    timezone: 'America/New_York',
    facts: {
      profile: { name: 'Sarah' },
      memories: [{ type: 'fact', content: 'Wants to learn coding' }],
      signals: [{ key: 'user.mood', value: 'excited', confidence: 0.8 }],
    },
    completedAt: '2026-03-08T10:00:00.000Z',
  }

  it('signs and verifies cookie data roundtrip', () => {
    const signed = signVisitorCookie(testData)
    const verified = verifyVisitorCookie(signed)
    expect(verified).toEqual(testData)
  })

  it('returns null for tampered cookie', () => {
    const signed = signVisitorCookie(testData)
    const tampered = 'X' + signed.slice(1)
    expect(verifyVisitorCookie(tampered)).toBeNull()
  })

  it('returns null for cookie without dot separator', () => {
    expect(verifyVisitorCookie('nodothere')).toBeNull()
  })

  it('returns null for corrupted payload', () => {
    const signed = signVisitorCookie(testData)
    const sig = signed.split('.')[1]
    expect(verifyVisitorCookie(`invalidbase64.${sig}`)).toBeNull()
  })

  it('preserves all visitor data fields', () => {
    const data: VisitorOnboardingData = {
      name: 'Test',
      goal: 'Test goal',
      plans: 'Test plans',
      timezone: 'UTC',
      facts: { profile: {}, memories: [], signals: [] },
    }
    const verified = verifyVisitorCookie(signVisitorCookie(data))
    expect(verified?.name).toBe('Test')
    expect(verified?.goal).toBe('Test goal')
    expect(verified?.plans).toBe('Test plans')
    expect(verified?.timezone).toBe('UTC')
  })

  it('handles empty facts', () => {
    const data: VisitorOnboardingData = {
      facts: { profile: {}, memories: [], signals: [] },
    }
    const verified = verifyVisitorCookie(signVisitorCookie(data))
    expect(verified?.facts.profile).toEqual({})
    expect(verified?.facts.memories).toEqual([])
    expect(verified?.facts.signals).toEqual([])
  })
})

describe('visitorCookieOptions', () => {
  it('returns secure HttpOnly cookie config', () => {
    const opts = visitorCookieOptions()
    expect(opts.httpOnly).toBe(true)
    expect(opts.secure).toBe(true)
    expect(opts.sameSite).toBe('lax')
    expect(opts.path).toBe('/')
  })

  it('sets 7-day maxAge', () => {
    const opts = visitorCookieOptions()
    expect(opts.maxAge).toBe(7 * 24 * 60 * 60)
  })

  it('uses correct cookie name', () => {
    const opts = visitorCookieOptions()
    expect(opts.name).toBe(VISITOR_COOKIE_NAME)
  })
})

// ─── VISITOR_COOKIE_NAME constant ───────────────────────────────────────────

describe('VISITOR_COOKIE_NAME', () => {
  it('is a non-empty string', () => {
    expect(typeof VISITOR_COOKIE_NAME).toBe('string')
    expect(VISITOR_COOKIE_NAME.length).toBeGreaterThan(0)
  })
})

// ─── Gemini Live session route ──────────────────────────────────────────────

describe('POST /api/onboarding/live/session', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns 503 when no Gemini API key configured', async () => {
    process.env.GEMINI_API_KEY = ''
    process.env.MYWAY_AI_TOKEN = ''

    // Re-import to pick up env change — use dynamic import
    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/session/route')

    const req = new Request('http://localhost/api/onboarding/live/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.error).toContain('API key')
  })

  it('returns config with API key, model, and system instruction', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key-123'

    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/session/route')

    const req = new Request('http://localhost/api/onboarding/live/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserTimezone: 'America/Toronto' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.apiKey).toBe('test-gemini-key-123')
    expect(data.model).toContain('gemini')
    expect(data.systemInstruction).toContain("what's your name")
    expect(data.voiceName).toBeDefined()
  })

  it('includes timezone in system instruction', async () => {
    process.env.GEMINI_API_KEY = 'test-key'

    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/session/route')

    const req = new Request('http://localhost/api/onboarding/live/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserTimezone: 'America/New_York' }),
    })

    const res = await POST(req as any)
    const data = await res.json()
    expect(data.systemInstruction).toContain('New York')
  })

  it('defaults to UTC when no timezone provided', async () => {
    process.env.GEMINI_API_KEY = 'test-key'

    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/session/route')

    const req = new Request('http://localhost/api/onboarding/live/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await POST(req as any)
    const data = await res.json()
    expect(data.systemInstruction).toContain('UTC')
  })

  it('handles empty request body gracefully', async () => {
    process.env.GEMINI_API_KEY = 'test-key'

    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/session/route')

    // Body that fails JSON.parse
    const req = new Request('http://localhost/api/onboarding/live/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })

    const res = await POST(req as any)
    // Should not crash — falls back to empty body
    expect(res.status).toBe(200)
  })
})

// ─── Gemini Live extract route ──────────────────────────────────────────────

describe('POST /api/onboarding/live/extract', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Ensure unauthenticated mode (no API token = self-hosted)
    process.env.MYWAY_API_TOKEN = ''
    mockLLMResponse = JSON.stringify({
      profile: { name: 'Sarah', primary_goal: 'Learn piano' },
      memories: [{ type: 'fact', content: 'Wants to learn piano' }],
      signals: [{ key: 'user.mood', value: 'curious', confidence: 0.7 }],
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns 400 for missing transcript', async () => {
    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/extract/route')

    const req = new Request('http://localhost/api/onboarding/live/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty transcript', async () => {
    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/extract/route')

    const req = new Request('http://localhost/api/onboarding/live/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: '   ' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON body', async () => {
    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/extract/route')

    const req = new Request('http://localhost/api/onboarding/live/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })

    const res = await POST(req as any)
    expect(res.status).toBe(400)
  })
})

// ─── Data capture flow verification ─────────────────────────────────────────

describe('E1 data capture — end-to-end flow', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('captures name from conversation and saves to user_profile', async () => {
    mockLLMResponse = JSON.stringify({
      profile: { name: 'Uchi', occupation: 'founder' },
      memories: [{ type: 'fact', content: 'Founder and CEO' }],
      signals: [{ key: 'user.occupation', value: 'founder', confidence: 1.0 }],
    })

    const facts = await extractConversationFacts(
      'Myway: Hey, what\'s your name?\nUser: I\'m Uchi, founder of LiftRails\nMyway: Nice to meet you!',
      'America/Toronto',
    )

    saveFacts(db, facts)

    // Verify user_profile has name
    const nameRow = db.prepare("SELECT value FROM user_profile WHERE key = 'name'").get() as { value: string }
    expect(nameRow.value).toBe('Uchi')

    // Verify timezone was auto-set
    const tzRow = db.prepare("SELECT value FROM user_profile WHERE key = 'timezone'").get() as { value: string }
    expect(tzRow.value).toBe('America/Toronto')

    // Verify onboarding_completed_at was set
    const completedRow = db.prepare("SELECT value FROM user_profile WHERE key = 'onboarding_completed_at'").get() as { value: string }
    expect(completedRow.value).toMatch(/^\d{4}-/)

    // Verify memories were saved
    const memRows = db.prepare('SELECT type, content FROM memories WHERE is_deleted = 0').all() as { type: string; content: string }[]
    expect(memRows).toHaveLength(1)
    expect(memRows[0].content).toBe('Founder and CEO')

    // Verify personality_state was saved
    const sigRow = db.prepare("SELECT value, confidence FROM personality_state WHERE key = 'user.occupation'").get() as { value: string; confidence: number }
    expect(sigRow.value).toBe('founder')
    expect(sigRow.confidence).toBe(1.0)
  })

  it('captures goal from conversation', async () => {
    mockLLMResponse = JSON.stringify({
      profile: { name: 'Sarah', primary_goal: 'Ship my app this week' },
      memories: [
        { type: 'fact', content: 'Building a mobile app' },
        { type: 'event', content: 'Deadline is this week' },
      ],
      signals: [
        { key: 'user.mood', value: 'focused', confidence: 0.8 },
        { key: 'user.energy', value: 'high', confidence: 0.7 },
      ],
    })

    const facts = await extractConversationFacts(
      'User: Sarah\nMyway: Hi Sarah!\nUser: I need to ship my app this week\nMyway: Let\'s do it!',
      'America/Chicago',
    )

    saveFacts(db, facts)

    const goalRow = db.prepare("SELECT value FROM user_profile WHERE key = 'primary_goal'").get() as { value: string }
    expect(goalRow.value).toBe('Ship my app this week')

    const memCount = db.prepare('SELECT COUNT(*) as c FROM memories WHERE is_deleted = 0').get() as { c: number }
    expect(memCount.c).toBe(2)

    const sigCount = db.prepare('SELECT COUNT(*) as c FROM personality_state').get() as { c: number }
    expect(sigCount.c).toBe(2)
  })

  it('extraction happens at processing step with full transcript', async () => {
    // Simulate what OnboardingGeminiLive does: accumulate transcript
    // across turns, then call extract once at finishOnboarding()
    const transcript = [
      'Myway: Hey, I\'m Myway. What\'s your name?',
      'User: I\'m Marcus, I work in finance',
      'Myway: Nice to meet you Marcus! What\'s on your mind today?',
      'User: I want to build a personal budget tracker',
      'Myway: Great goal! Let me help you with that.',
    ].join('\n')

    const userResponses = [
      { step: 'name', value: 'I\'m Marcus, I work in finance' },
      { step: 'goal', value: 'I want to build a personal budget tracker' },
    ]

    mockLLMResponse = JSON.stringify({
      profile: { name: 'Marcus', occupation: 'finance professional', primary_goal: 'Build a personal budget tracker' },
      memories: [
        { type: 'fact', content: 'Works in finance' },
        { type: 'preference', content: 'Interested in personal budgeting' },
      ],
      signals: [
        { key: 'user.occupation', value: 'finance', confidence: 1.0 },
        { key: 'user.interests', value: 'personal finance, budgeting', confidence: 0.8 },
      ],
    })

    // This is what the extract endpoint does
    const facts = await extractConversationFacts(transcript, 'America/New_York')
    saveFacts(db, facts)

    // Verify all three DB tables populated
    const profileCount = db.prepare('SELECT COUNT(*) as c FROM user_profile').get() as { c: number }
    expect(profileCount.c).toBeGreaterThanOrEqual(5) // name, occupation, primary_goal, timezone, onboarding_completed_at, onboarding_started_at

    const memCount = db.prepare('SELECT COUNT(*) as c FROM memories WHERE is_deleted = 0').get() as { c: number }
    expect(memCount.c).toBe(2)

    const sigCount = db.prepare('SELECT COUNT(*) as c FROM personality_state').get() as { c: number }
    expect(sigCount.c).toBe(2)

    // Verify fallback: if extract failed, raw responses provide name/goal
    // (tested via the extract route handler, not here — this tests the lib layer)
  })

  it('handles transcript fallback from userResponses when transcription fails', async () => {
    // Simulate empty transcription — userResponses used as fallback
    const fallbackTranscript = [
      'name: Marcus',
      'goal: Build a budget app',
    ].join('\n')

    mockLLMResponse = JSON.stringify({
      profile: { name: 'Marcus', primary_goal: 'Build a budget app' },
      memories: [],
      signals: [],
    })

    const facts = await extractConversationFacts(fallbackTranscript, 'UTC')
    saveFacts(db, facts)

    const nameRow = db.prepare("SELECT value FROM user_profile WHERE key = 'name'").get() as { value: string }
    expect(nameRow.value).toBe('Marcus')
  })
})

// ─── System prompt content verification ─────────────────────────────────────

describe('Gemini Live system prompt — E1 PRD alignment', () => {
  it('contains the welcome greeting and name question', async () => {
    process.env.GEMINI_API_KEY = 'test-key'

    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/session/route')

    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserTimezone: 'UTC' }),
    })

    const res = await POST(req as any)
    const data = await res.json()
    const instruction = data.systemInstruction

    expect(instruction).toContain('welcome to your Personalized World')
    expect(instruction).toContain("what's your name")
  })

  it('asks about what is on the user\'s mind (US-003)', async () => {
    process.env.GEMINI_API_KEY = 'test-key'

    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/session/route')

    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserTimezone: 'UTC' }),
    })

    const res = await POST(req as any)
    const data = await res.json()

    // US-003: asks goal/thought
    expect(data.systemInstruction).toContain('on your mind')
  })

  it('includes magic moment and capabilities pitch (US-004)', async () => {
    process.env.GEMINI_API_KEY = 'test-key'

    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/session/route')

    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserTimezone: 'UTC' }),
    })

    const res = await POST(req as any)
    const data = await res.json()

    // US-004: magic moment — personalized response
    expect(data.systemInstruction).toContain('MAGIC MOMENT')
    // Capabilities pitch
    expect(data.systemInstruction.toLowerCase()).toContain('morning briefing')
  })

  it('enforces 2-question limit (PRD: 3 questions max, we use 2)', async () => {
    process.env.GEMINI_API_KEY = 'test-key'

    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/session/route')

    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserTimezone: 'UTC' }),
    })

    const res = await POST(req as any)
    const data = await res.json()

    expect(data.systemInstruction).toContain('2-question conversation')
  })

  it('instructs model to wait for user to finish speaking', async () => {
    process.env.GEMINI_API_KEY = 'test-key'

    vi.resetModules()
    const { POST } = await import('@/app/api/onboarding/live/session/route')

    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserTimezone: 'UTC' }),
    })

    const res = await POST(req as any)
    const data = await res.json()

    expect(data.systemInstruction.toLowerCase()).toContain('wait for the user')
  })
})
