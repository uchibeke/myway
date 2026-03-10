/**
 * Tests for isOnboardingComplete — the single source of truth for
 * "should we show onboarding/self-demo?"
 *
 * Covers all scenarios:
 *   - Fresh DB (no tables, no data)
 *   - Explicit onboarding_completed_at flag
 *   - Heuristic: name + memories
 *   - Heuristic: name + messages
 *   - Name only (no content) → not complete
 *   - Messages only (no name) → not complete
 *   - Missing tables → graceful false
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/model-registry', () => ({
  resolveModelForApp: vi.fn(() => ({
    model: 'test-model',
    baseUrl: 'http://localhost:9999',
    token: 'test-token',
  })),
}))

vi.mock('@/lib/workspace-context', () => ({
  invalidateWorkspaceCache: vi.fn(),
}))

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

const originalFetch = globalThis.fetch
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{}' } }] }),
    text: async () => '{}',
  })) as any
})
afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

// ─── Import after mocks ────────────────────────────────────────────────────

import { isOnboardingComplete } from '@/lib/onboarding'

// ─── DB helper ─────────────────────────────────────────────────────────────

function createFullDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE user_profile (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_by TEXT NOT NULL DEFAULT 'user'
    );
    CREATE TABLE memories (
      id         TEXT PRIMARY KEY,
      app_id     TEXT,
      type       TEXT NOT NULL,
      content    TEXT NOT NULL,
      metadata   TEXT NOT NULL DEFAULT '{}',
      embedding_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE messages (
      id         TEXT PRIMARY KEY,
      app_id     TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
  `)
  return db
}

function createMinimalDb(): InstanceType<typeof Database> {
  // DB with only user_profile — no memories or messages tables
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE user_profile (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_by TEXT NOT NULL DEFAULT 'user'
    );
  `)
  return db
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('isOnboardingComplete', () => {
  it('returns false for a completely empty DB', () => {
    const db = createFullDb()
    expect(isOnboardingComplete(db)).toBe(false)
  })

  it('returns true when onboarding_completed_at is set', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('onboarding_completed_at', '2026-01-01T00:00:00Z')`).run()
    expect(isOnboardingComplete(db)).toBe(true)
  })

  it('returns true when user has name + memories', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('name', 'Uchi')`).run()
    db.prepare(`INSERT INTO memories (id, type, content) VALUES ('m1', 'fact', 'Works as engineer')`).run()
    expect(isOnboardingComplete(db)).toBe(true)
  })

  it('returns true when user has name + messages', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('name', 'Uchi')`).run()
    db.prepare(`INSERT INTO messages (id, app_id, role, content) VALUES ('msg1', 'chat', 'user', 'hello')`).run()
    expect(isOnboardingComplete(db)).toBe(true)
  })

  it('returns false when user has name only (no memories or messages)', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('name', 'Uchi')`).run()
    expect(isOnboardingComplete(db)).toBe(false)
  })

  it('returns false when user has memories but no name', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO memories (id, type, content) VALUES ('m1', 'fact', 'Some fact')`).run()
    expect(isOnboardingComplete(db)).toBe(false)
  })

  it('returns false when user has messages but no name', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO messages (id, app_id, role, content) VALUES ('msg1', 'chat', 'user', 'hello')`).run()
    expect(isOnboardingComplete(db)).toBe(false)
  })

  it('ignores deleted memories', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('name', 'Uchi')`).run()
    db.prepare(`INSERT INTO memories (id, type, content, is_deleted) VALUES ('m1', 'fact', 'deleted', 1)`).run()
    expect(isOnboardingComplete(db)).toBe(false)
  })

  it('ignores deleted messages', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('name', 'Uchi')`).run()
    db.prepare(`INSERT INTO messages (id, app_id, role, content, is_deleted) VALUES ('msg1', 'chat', 'user', 'deleted', 1)`).run()
    expect(isOnboardingComplete(db)).toBe(false)
  })

  it('returns false gracefully when tables do not exist', () => {
    const db = new Database(':memory:')
    expect(isOnboardingComplete(db)).toBe(false)
  })

  it('returns true with explicit flag even when memories/messages tables are missing', () => {
    const db = createMinimalDb()
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('onboarding_completed_at', '2026-01-01T00:00:00Z')`).run()
    expect(isOnboardingComplete(db)).toBe(true)
  })

  it('returns false when name exists but memories/messages tables are missing', () => {
    const db = createMinimalDb()
    db.prepare(`INSERT INTO user_profile (key, value) VALUES ('name', 'Uchi')`).run()
    // No memories or messages tables — should not throw, should return false
    expect(isOnboardingComplete(db)).toBe(false)
  })
})
