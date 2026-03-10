import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  getProfile,
  setProfile,
  deleteProfileKey,
  buildWorkspaceContext,
  formatProfileContext,
  hasWorkspaceFile,
  parseMdProfile,
  groupIntoSections,
  isProfileType,
  labelFromKey,
  PROFILE_TYPES,
} from '@/lib/profile-sync'

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
  `)
  return db
}

// ─── Mock filesystem ─────────────────────────────────────────────────────────

let mockFiles: Record<string, string> = {}

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn().mockImplementation((p: unknown) => {
      const path = String(p)
      return Object.keys(mockFiles).some(k => path.endsWith(k))
    }),
    readFileSync: vi.fn().mockImplementation((p: unknown) => {
      const path = String(p)
      for (const [k, v] of Object.entries(mockFiles)) {
        if (path.endsWith(k)) return v
      }
      throw new Error(`ENOENT: ${path}`)
    }),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
  }
})

import { writeFileSync, renameSync } from 'fs'

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('profile-sync', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = createTestDb()
    mockFiles = {}
    vi.clearAllMocks()
  })

  afterEach(() => {
    db.close()
  })

  describe('PROFILE_TYPES', () => {
    it('contains user and ai', () => {
      expect(PROFILE_TYPES).toContain('user')
      expect(PROFILE_TYPES).toContain('ai')
    })
  })

  // ─── parseMdProfile ─────────────────────────────────────────────────────

  describe('parseMdProfile', () => {
    it('extracts name from heading', () => {
      const result = parseMdProfile('## Uchi\n\n- **Email:** test@test.com')
      expect(result.get('name')).toBe('Uchi')
    })

    it('extracts key-value fields', () => {
      const result = parseMdProfile('## User\n- **Timezone:** EST\n- **Email:** a@b.com')
      expect(result.get('timezone')).toBe('EST')
      expect(result.get('email')).toBe('a@b.com')
    })

    it('"Call them" overrides name', () => {
      const result = parseMdProfile('## Uchi Uchibeke\n- **Call them:** Uchi')
      expect(result.get('name')).toBe('Uchi')
    })

    it('parses sections with prefixed keys', () => {
      const md = '## User\n\n### Spouse — Jennifer\n- **Email:** jen@test.com\n- **Birthday:** May 10'
      const result = parseMdProfile(md)
      expect(result.get('spouse._subtitle')).toBe('Jennifer')
      expect(result.get('spouse.email')).toBe('jen@test.com')
      expect(result.get('spouse.birthday')).toBe('May 10')
    })

    it('captures plain text sections as _text', () => {
      const md = '## User\n\n### Founded\nChimoney, APort, WorldInnovationLeague.com'
      const result = parseMdProfile(md)
      expect(result.get('founded._text')).toBe('Chimoney, APort, WorldInnovationLeague.com')
    })

    it('captures list items in text sections', () => {
      const md = '## User\n\n### Notes\n- Completed payment on Feb 20.\n- Also likes pizza.'
      const result = parseMdProfile(md)
      expect(result.get('notes._text')).toContain('Completed payment')
      expect(result.get('notes._text')).toContain('Also likes pizza')
    })

    it('handles multiple sections', () => {
      const md = [
        '## User',
        '- **Name:** Test',
        '',
        '### Founded',
        'CompanyA, CompanyB',
        '',
        '### Spouse — Jane',
        '- **Birthday:** Jan 1',
        '',
        '### Notes',
        '- Some note',
      ].join('\n')
      const result = parseMdProfile(md)
      expect(result.get('name')).toBe('Test')
      expect(result.get('founded._text')).toBe('CompanyA, CompanyB')
      expect(result.get('spouse._subtitle')).toBe('Jane')
      expect(result.get('spouse.birthday')).toBe('Jan 1')
      expect(result.get('notes._text')).toContain('Some note')
    })

    it('handles IDENTITY.md format', () => {
      const md = '## Chief of Staff\n\n- **Name:** Chief of Staff\n- **Personality:** Witty'
      const result = parseMdProfile(md)
      expect(result.get('name')).toBe('Chief of Staff')
      expect(result.get('personality')).toBe('Witty')
    })

    // ── Placeholder filtering ──────────────────────────────────────────

    it('skips template heading with .md file name', () => {
      const md = '## IDENTITY.md - Who Am I?\n\n- **Name:** Chief of Staff'
      const result = parseMdProfile(md)
      // heading should NOT set name to "IDENTITY.md - Who Am I?"
      // the key-value "Name" field should be used instead
      expect(result.get('name')).toBe('Chief of Staff')
    })

    it('skips placeholder values like _(optional)_', () => {
      const md = '## Uchi\n- **Pronouns:** _(optional)_\n- **Email:** real@test.com'
      const result = parseMdProfile(md)
      expect(result.has('pronouns')).toBe(false)
      expect(result.get('email')).toBe('real@test.com')
    })

    it('skips italic placeholder values like _your name_', () => {
      const md = '## Uchi\n- **Nickname:** _your nickname_'
      const result = parseMdProfile(md)
      expect(result.has('nickname')).toBe(false)
    })

    it('skips bracketed placeholders', () => {
      const md = '## User\n- **Location:** [your city]\n- **Phone:** <phone>'
      const result = parseMdProfile(md)
      expect(result.has('location')).toBe(false)
      expect(result.has('phone')).toBe(false)
    })

    it('skips ellipsis and common filler tokens', () => {
      const md = '## User\n- **Bio:** ...\n- **Status:** TBD\n- **Goal:** N/A'
      const result = parseMdProfile(md)
      expect(result.has('bio')).toBe(false)
      expect(result.has('status')).toBe(false)
      expect(result.has('goal')).toBe(false)
    })

    it('skips placeholder in section subtitles', () => {
      const md = '## User\n\n### Spouse — _(optional)_\n- **Birthday:** May 10'
      const result = parseMdProfile(md)
      expect(result.has('spouse._subtitle')).toBe(false)
      expect(result.get('spouse.birthday')).toBe('May 10')
    })

    it('keeps real values that happen to contain underscores', () => {
      const md = '## User\n- **Handle:** _real_handle_'
      const result = parseMdProfile(md)
      // _real_handle_ has inner underscores — not a simple placeholder
      expect(result.get('handle')).toBe('_real_handle_')
    })
  })

  // ─── getProfile — DB only ──────────────────────────────────────────────

  describe('getProfile — DB only (no OpenClaw files)', () => {
    it('returns empty map when no data', () => {
      expect(getProfile(db, 'user').size).toBe(0)
    })

    it('returns DB fields', () => {
      setProfile(db, 'user', { name: 'Oliver', timezone: 'America/Toronto' })
      const result = getProfile(db, 'user')
      expect(result.get('name')).toBe('Oliver')
      expect(result.get('timezone')).toBe('America/Toronto')
    })

    it('works for ai profile type', () => {
      setProfile(db, 'ai', { name: 'Chief of Staff', personality: 'witty' })
      const result = getProfile(db, 'ai')
      expect(result.get('name')).toBe('Chief of Staff')
      expect(result.get('personality')).toBe('witty')
    })
  })

  // ─── getProfile — merge ────────────────────────────────────────────────

  describe('getProfile — merge with OpenClaw files', () => {
    it('reads USER.md fields when DB is empty', () => {
      mockFiles['USER.md'] = '## Uchi\n\n- **Call them:** Uchi\n- **Timezone:** Eastern Time\n- **Email:** test@example.com'
      const result = getProfile(db, 'user')
      expect(result.get('name')).toBe('Uchi')
      expect(result.get('timezone')).toBe('Eastern Time')
      expect(result.get('email')).toBe('test@example.com')
    })

    it('reads IDENTITY.md fields when DB is empty', () => {
      mockFiles['IDENTITY.md'] = '## Chief of Staff\n\n- **Name:** Chief of Staff\n- **Personality:** Excellence'
      const result = getProfile(db, 'ai')
      expect(result.get('name')).toBe('Chief of Staff')
      expect(result.get('personality')).toBe('Excellence')
    })

    it('DB fields override OpenClaw file fields', () => {
      mockFiles['USER.md'] = '## FileUser\n\n- **Call them:** FileUser\n- **Timezone:** UTC'
      setProfile(db, 'user', { name: 'DbUser' })
      const result = getProfile(db, 'user')
      expect(result.get('name')).toBe('DbUser')  // DB wins
      expect(result.get('timezone')).toBe('UTC')  // file fills gap
    })

    it('OpenClaw file fills gaps not in DB', () => {
      mockFiles['USER.md'] = '## Uchi\n\n- **Email:** uchi@example.com\n- **Phone:** 555-1234'
      setProfile(db, 'user', { name: 'Uchi', interests: 'coding' })
      const result = getProfile(db, 'user')
      expect(result.get('name')).toBe('Uchi')
      expect(result.get('interests')).toBe('coding')
      expect(result.get('email')).toBe('uchi@example.com')
      expect(result.get('phone')).toBe('555-1234')
    })

    it('preserves section fields from file', () => {
      mockFiles['USER.md'] = '## User\n\n### Spouse — Jennifer\n- **Birthday:** May 10'
      const result = getProfile(db, 'user')
      expect(result.get('spouse._subtitle')).toBe('Jennifer')
      expect(result.get('spouse.birthday')).toBe('May 10')
    })

    it('preserves _text sections from file', () => {
      mockFiles['USER.md'] = '## User\n\n### Founded\nChimoney, APort'
      const result = getProfile(db, 'user')
      expect(result.get('founded._text')).toBe('Chimoney, APort')
    })
  })

  // ─── setProfile ────────────────────────────────────────────────────────

  describe('setProfile', () => {
    it('inserts new fields', () => {
      setProfile(db, 'user', { name: 'Oliver', location: 'Toronto' })
      const rows = db.prepare('SELECT * FROM user_profile').all() as { key: string; value: string }[]
      expect(rows).toHaveLength(2)
      expect(rows.find(r => r.key === 'name')?.value).toBe('Oliver')
    })

    it('upserts existing fields', () => {
      setProfile(db, 'user', { name: 'Oliver' })
      setProfile(db, 'user', { name: 'Ollie' })
      const rows = db.prepare('SELECT * FROM user_profile').all() as { key: string; value: string }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].value).toBe('Ollie')
    })

    it('deletes fields with empty value', () => {
      setProfile(db, 'user', { name: 'Oliver', location: 'Toronto' })
      setProfile(db, 'user', { location: '' })
      const rows = db.prepare('SELECT * FROM user_profile').all() as { key: string; value: string }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].key).toBe('name')
    })

    it('syncs name to identity table for user profile', () => {
      setProfile(db, 'user', { name: 'Oliver' })
      const row = db.prepare("SELECT value FROM identity WHERE key = 'user.name'").get() as { value: string } | undefined
      expect(row?.value).toBe('Oliver')
    })

    it('syncs timezone to identity table for user profile', () => {
      setProfile(db, 'user', { timezone: 'America/Toronto' })
      const row = db.prepare("SELECT value FROM identity WHERE key = 'user.timezone'").get() as { value: string } | undefined
      expect(row?.value).toBe('America/Toronto')
    })

    it('does NOT sync to identity for ai profile', () => {
      setProfile(db, 'ai', { name: 'Chief' })
      const row = db.prepare("SELECT value FROM identity WHERE key = 'user.name'").get() as { value: string } | undefined
      expect(row).toBeUndefined()
    })

    it('writes to ai_profile table for ai type', () => {
      setProfile(db, 'ai', { name: 'Chief', personality: 'witty' })
      const rows = db.prepare('SELECT * FROM ai_profile').all() as { key: string; value: string }[]
      expect(rows).toHaveLength(2)
    })
  })

  // ─── File sync-back ────────────────────────────────────────────────────

  describe('setProfile — file sync-back', () => {
    it('updates existing field in-place in the file', () => {
      mockFiles['USER.md'] = '## Uchi\n\n- **Timezone:** UTC\n- **Email:** old@test.com'
      setProfile(db, 'user', { timezone: 'America/Toronto' })
      // writeFileSync should have been called with the tmp file
      expect(writeFileSync).toHaveBeenCalled()
      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string
      expect(written).toContain('**Timezone:** America/Toronto')
      expect(written).toContain('**Email:** old@test.com')  // unchanged
    })

    it('appends new field to top section when not in file', () => {
      mockFiles['USER.md'] = '## Uchi\n\n- **Name:** Uchi\n\n### Notes\n- stuff'
      setProfile(db, 'user', { interests: 'coding, AI' })
      expect(writeFileSync).toHaveBeenCalled()
      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string
      expect(written).toContain('**Interests:** coding, AI')
    })

    it('does NOT sync back if workspace file does not exist', () => {
      mockFiles = {}  // no files
      setProfile(db, 'user', { name: 'Oliver' })
      expect(writeFileSync).not.toHaveBeenCalled()
    })

    it('does NOT sync internal keys (_subtitle, _text, name)', () => {
      mockFiles['USER.md'] = '## Uchi\n\n- **Email:** a@b.com'
      setProfile(db, 'user', { name: 'New Name', 'spouse._subtitle': 'Jane' })
      // Should not try to write "name" or "_subtitle" as field lines
      if (vi.mocked(writeFileSync).mock.calls.length > 0) {
        const written = vi.mocked(writeFileSync).mock.calls[0][1] as string
        expect(written).not.toContain('**Name:** New Name')  // "name" key is skipped
        expect(written).not.toContain('**_subtitle:**')
      }
    })
  })

  // ─── deleteProfileKey ──────────────────────────────────────────────────

  describe('deleteProfileKey', () => {
    it('removes a key from the table', () => {
      setProfile(db, 'user', { name: 'Oliver', location: 'Toronto' })
      deleteProfileKey(db, 'user', 'location')
      const result = getProfile(db, 'user')
      expect(result.has('location')).toBe(false)
      expect(result.get('name')).toBe('Oliver')
    })
  })

  // ─── formatProfileContext ──────────────────────────────────────────────

  describe('formatProfileContext', () => {
    it('returns null for empty map', () => {
      expect(formatProfileContext(new Map(), 'Test')).toBeNull()
    })

    it('formats top-level fields as markdown', () => {
      const fields = new Map([['name', 'Oliver'], ['timezone', 'EST']])
      const result = formatProfileContext(fields, 'User Profile')!
      expect(result).toContain('### User Profile')
      expect(result).toContain('**Name:** Oliver')
      expect(result).toContain('**Timezone:** EST')
    })

    it('groups section fields under #### headers', () => {
      const fields = new Map([
        ['name', 'Test'],
        ['spouse._subtitle', 'Jennifer'],
        ['spouse.email', 'jen@test.com'],
        ['spouse.birthday', 'May 10'],
      ])
      const result = formatProfileContext(fields, 'User Profile')!
      expect(result).toContain('#### Spouse — Jennifer')
      expect(result).toContain('**Email:** jen@test.com')
      expect(result).toContain('**Birthday:** May 10')
    })

    it('includes _text sections', () => {
      const fields = new Map([
        ['name', 'Test'],
        ['founded._text', 'CompanyA, CompanyB'],
      ])
      const result = formatProfileContext(fields, 'User Profile')!
      expect(result).toContain('#### Founded')
      expect(result).toContain('CompanyA, CompanyB')
    })

    it('converts underscored keys to readable labels', () => {
      const fields = new Map([['communication_style', 'casual']])
      const result = formatProfileContext(fields, 'Test')!
      expect(result).toContain('**Communication style:** casual')
    })
  })

  // ─── buildWorkspaceContext ─────────────────────────────────────────────

  describe('buildWorkspaceContext', () => {
    it('returns null when no data from either source', () => {
      expect(buildWorkspaceContext(db)).toBeNull()
    })

    it('returns formatted context from DB data', () => {
      setProfile(db, 'user', { name: 'Oliver' })
      setProfile(db, 'ai', { name: 'Chief' })
      const result = buildWorkspaceContext(db)!
      expect(result).toContain('### User Profile')
      expect(result).toContain('Oliver')
      expect(result).toContain('### AI Identity')
      expect(result).toContain('Chief')
    })

    it('returns user-only context when ai is empty', () => {
      setProfile(db, 'user', { name: 'Oliver' })
      const result = buildWorkspaceContext(db)!
      expect(result).toContain('Oliver')
      expect(result).not.toContain('AI Identity')
    })

    it('includes OpenClaw file content merged with DB', () => {
      mockFiles['USER.md'] = '## FileUser\n\n- **Email:** file@test.com'
      setProfile(db, 'user', { name: 'DbUser' })
      const result = buildWorkspaceContext(db)!
      expect(result).toContain('DbUser')
      expect(result).toContain('file@test.com')
    })

    it('includes section data from file in context', () => {
      mockFiles['USER.md'] = '## User\n\n### Spouse — Jennifer\n- **Birthday:** May 10\n\n### Founded\nChimoney'
      const result = buildWorkspaceContext(db)!
      expect(result).toContain('Spouse')
      expect(result).toContain('Jennifer')
      expect(result).toContain('May 10')
      expect(result).toContain('Founded')
      expect(result).toContain('Chimoney')
    })
  })

  // ─── hasWorkspaceFile ──────────────────────────────────────────────────

  describe('hasWorkspaceFile', () => {
    it('returns false when file does not exist', () => {
      expect(hasWorkspaceFile('user')).toBe(false)
    })

    it('returns true when file exists', () => {
      mockFiles['USER.md'] = '## User'
      expect(hasWorkspaceFile('user')).toBe(true)
    })
  })

  // ─── OpenClaw regression ───────────────────────────────────────────────

  describe('OpenClaw regression — no DB tables', () => {
    it('getProfile still works if tables do not exist', () => {
      const bareDb = new Database(':memory:')
      mockFiles['USER.md'] = '## Uchi\n\n- **Call them:** Uchi'
      const result = getProfile(bareDb, 'user')
      expect(result.get('name')).toBe('Uchi')
      bareDb.close()
    })

    it('buildWorkspaceContext works with file-only data', () => {
      const bareDb = new Database(':memory:')
      mockFiles['USER.md'] = '## Uchi\n\n- **Call them:** Uchi\n- **Timezone:** EST'
      const result = buildWorkspaceContext(bareDb)!
      expect(result).toContain('Uchi')
      expect(result).toContain('EST')
      bareDb.close()
    })

    it('full USER.md with sections works without DB tables', () => {
      const bareDb = new Database(':memory:')
      mockFiles['USER.md'] = [
        '## Uchi',
        '- **Full Name:** Uchi Uchibeke',
        '- **Call them:** Uchi',
        '',
        '### Spouse — Jennifer',
        '- **Email:** jen@test.com',
        '',
        '### Founded',
        'Chimoney, APort',
        '',
        '### Notes',
        '- Completed payment.',
      ].join('\n')
      const result = getProfile(bareDb, 'user')
      expect(result.get('name')).toBe('Uchi')
      expect(result.get('full_name')).toBe('Uchi Uchibeke')
      expect(result.get('spouse._subtitle')).toBe('Jennifer')
      expect(result.get('spouse.email')).toBe('jen@test.com')
      expect(result.get('founded._text')).toBe('Chimoney, APort')
      expect(result.get('notes._text')).toContain('Completed payment')
      bareDb.close()
    })
  })

  // ── Shared helpers ───────────────────────────────────────────────────────

  describe('labelFromKey', () => {
    it('converts snake_case to title case', () => {
      expect(labelFromKey('call_them')).toBe('Call them')
    })

    it('capitalises single word', () => {
      expect(labelFromKey('name')).toBe('Name')
    })

    it('handles empty string', () => {
      expect(labelFromKey('')).toBe('')
    })
  })

  describe('isProfileType', () => {
    it('accepts valid types', () => {
      expect(isProfileType('user')).toBe(true)
      expect(isProfileType('ai')).toBe(true)
    })

    it('rejects invalid types', () => {
      expect(isProfileType('admin')).toBe(false)
      expect(isProfileType('')).toBe(false)
      expect(isProfileType('USER')).toBe(false)
    })
  })

  describe('groupIntoSections', () => {
    it('groups top-level fields into main section', () => {
      const fields = new Map([['name', 'Uchi'], ['email', 'test@test.com']])
      const sections = groupIntoSections(fields)
      expect(sections).toHaveLength(1)
      expect(sections[0].title).toBeNull()
      expect(sections[0].fields).toHaveLength(2)
      expect(sections[0].fields[0].key).toBe('Name')
    })

    it('groups dotted keys into named sections', () => {
      const fields = new Map([
        ['spouse.email', 'jen@test.com'],
        ['spouse._subtitle', 'Jennifer'],
        ['founded._text', 'Chimoney'],
      ])
      const sections = groupIntoSections(fields)
      expect(sections).toHaveLength(2)
      expect(sections[0].title).toBe('Spouse')
      expect(sections[0].subtitle).toBe('Jennifer')
      expect(sections[0].fields[0].key).toBe('Email')
      expect(sections[1].title).toBe('Founded')
      expect(sections[1].text).toBe('Chimoney')
    })

    it('returns empty array for empty map', () => {
      expect(groupIntoSections(new Map())).toEqual([])
    })
  })
})
