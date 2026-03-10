/**
 * Tests for the onboarding module — name extraction, timezone resolution,
 * step processors, and onboarding status checks.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  extractName,
  resolveTimezone,
  isOnboardingComplete,
  getOnboardingResumeState,
  GREETING_TEXT,
  NAME_RETRY_TEXT,
} from '@/lib/onboarding'

// ─── Test DB helper ──────────────────────────────────────────────────────────

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_by TEXT NOT NULL DEFAULT 'user'
    );
  `)
  return db
}

// ─── extractName ─────────────────────────────────────────────────────────────

describe('extractName', () => {
  it('returns null for empty input', () => {
    expect(extractName('')).toBeNull()
    expect(extractName('   ')).toBeNull()
  })

  it('treats 1-word input as name (title-cased)', () => {
    expect(extractName('john')).toBe('John')
    expect(extractName('SARAH')).toBe('Sarah')
  })

  it('treats 2-word input as name', () => {
    expect(extractName('john smith')).toBe('John Smith')
  })

  it('treats 3-word input as name', () => {
    expect(extractName('mary jane watson')).toBe('Mary Jane Watson')
  })

  it('extracts name from "my name is ..." pattern (4+ words)', () => {
    expect(extractName('my name is John Smith')).toBe('John Smith')
    expect(extractName("Hi, I'm Sarah Connor please")).toBe('Sarah Connor Please')
    expect(extractName("Hello, my name is David Lee")).toBe('David Lee')
  })

  it('treats short patterns as full name (1-3 words)', () => {
    // "call me Alex" is 3 words — treated as name directly
    expect(extractName('call me Alex')).toBe('Call Me Alex')
    expect(extractName("I am David")).toBe('I Am David')
  })

  it('returns null for long unmatched input', () => {
    expect(extractName('I would like to tell you about my day and how things went')).toBeNull()
  })

  it('extracts from "hey, I am ..." pattern (4+ words)', () => {
    expect(extractName("hey, I'm Marcus Aurelius")).toBe('Marcus Aurelius')
  })

  it('treats short "hey I\'m X" as full name (3 words)', () => {
    // 3 words → treated as name directly
    expect(extractName("hey I'm Marcus")).toBe("Hey I'm Marcus")
  })

  it('limits extracted name to 3 words', () => {
    const result = extractName("my name is Jean-Luc Picard Enterprise Captain")
    expect(result).toBe('Jean-luc Picard Enterprise')
  })
})

// ─── resolveTimezone ─────────────────────────────────────────────────────────

describe('resolveTimezone', () => {
  it('returns null for empty input', () => {
    expect(resolveTimezone('')).toBeNull()
    expect(resolveTimezone('  ')).toBeNull()
  })

  it('resolves city names', () => {
    expect(resolveTimezone('Toronto')).toBe('America/Toronto')
    expect(resolveTimezone('new york')).toBe('America/New_York')
    expect(resolveTimezone('london')).toBe('Europe/London')
    expect(resolveTimezone('Lagos')).toBe('Africa/Lagos')
    expect(resolveTimezone('tokyo')).toBe('Asia/Tokyo')
  })

  it('resolves abbreviations', () => {
    expect(resolveTimezone('EST')).toBe('America/New_York')
    expect(resolveTimezone('pst')).toBe('America/Los_Angeles')
    expect(resolveTimezone('eastern')).toBe('America/New_York')
    expect(resolveTimezone('gmt')).toBe('Europe/London')
  })

  it('validates IANA timezone strings', () => {
    expect(resolveTimezone('America/Chicago')).toBe('America/Chicago')
    expect(resolveTimezone('Europe/Berlin')).toBe('Europe/Berlin')
  })

  it('returns null for invalid IANA strings', () => {
    expect(resolveTimezone('America/Nowhere')).toBeNull()
  })

  it('fuzzy-matches cities in longer input', () => {
    expect(resolveTimezone("I'm in toronto")).toBe('America/Toronto')
  })

  it('returns null for unrecognizable input', () => {
    expect(resolveTimezone('middle of nowhere')).toBeNull()
  })
})

// ─── isOnboardingComplete ────────────────────────────────────────────────────

describe('isOnboardingComplete', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = createTestDb()
  })

  it('returns false for empty database', () => {
    expect(isOnboardingComplete(db)).toBe(false)
  })

  it('returns false when onboarding_completed_at is not set', () => {
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('name', 'Alice')`).run()
    expect(isOnboardingComplete(db)).toBe(false)
  })

  it('returns true when onboarding_completed_at is set', () => {
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('onboarding_completed_at', '2026-01-01T00:00:00.000Z')`).run()
    expect(isOnboardingComplete(db)).toBe(true)
  })
})

// ─── getOnboardingResumeState ────────────────────────────────────────────────

describe('getOnboardingResumeState', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = createTestDb()
  })

  it('returns null step for brand new user', () => {
    const state = getOnboardingResumeState(db)
    expect(state.step).toBeNull()
    expect(state.name).toBeNull()
  })

  it('returns null step when onboarding is complete', () => {
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('onboarding_started_at', '2026-01-01T00:00:00.000Z')`).run()
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('onboarding_completed_at', '2026-01-01T00:01:00.000Z')`).run()
    const state = getOnboardingResumeState(db)
    expect(state.step).toBeNull()
  })

  it('returns name step when started but no name yet', () => {
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('onboarding_started_at', '2026-01-01T00:00:00.000Z')`).run()
    const state = getOnboardingResumeState(db)
    expect(state.step).toBe('name')
    expect(state.name).toBeNull()
  })

  it('returns goal step when name is saved', () => {
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('onboarding_started_at', '2026-01-01T00:00:00.000Z')`).run()
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('name', 'Alice')`).run()
    const state = getOnboardingResumeState(db)
    expect(state.step).toBe('goal')
    expect(state.name).toBe('Alice')
  })

  it('returns plans step when goal is saved', () => {
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('onboarding_started_at', '2026-01-01T00:00:00.000Z')`).run()
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('name', 'Bob')`).run()
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('primary_goal', 'Ship my app')`).run()
    const state = getOnboardingResumeState(db)
    expect(state.step).toBe('plans')
    expect(state.name).toBe('Bob')
  })
})

// ─── Constants ───────────────────────────────────────────────────────────────

describe('onboarding constants', () => {
  it('exports greeting text', () => {
    expect(GREETING_TEXT).toContain("what's your name")
  })

  it('exports name retry text', () => {
    expect(NAME_RETRY_TEXT).toContain('name')
  })
})
