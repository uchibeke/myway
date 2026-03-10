/**
 * Tests for hosted storage — artifact-backed file storage with quota enforcement.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isAllowedType,
  checkQuota,
  getStorageUsage,
  HOSTED_MAX_TOTAL_BYTES,
  HOSTED_MAX_FILE_BYTES,
  HOSTED_MAX_FILES,
  isHostedMode,
  useArtifactStorage,
} from '@/lib/hosted-storage'

// ─── Mock DB ─────────────────────────────────────────────────────────────────

function mockDb(totalBytes = 0, fileCount = 0) {
  return {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ total_bytes: totalBytes, file_count: fileCount }),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    }),
  } as any
}

// ─── isAllowedType ───────────────────────────────────────────────────────────

describe('isAllowedType', () => {
  it('allows images', () => {
    expect(isAllowedType('photo.jpg')).toBe(true)
    expect(isAllowedType('icon.png')).toBe(true)
    expect(isAllowedType('logo.svg')).toBe(true)
    expect(isAllowedType('photo.webp')).toBe(true)
  })

  it('allows documents and text', () => {
    expect(isAllowedType('readme.md')).toBe(true)
    expect(isAllowedType('report.pdf')).toBe(true)
    expect(isAllowedType('data.json')).toBe(true)
    expect(isAllowedType('notes.txt')).toBe(true)
    expect(isAllowedType('sheet.csv')).toBe(true)
  })

  it('allows code files', () => {
    expect(isAllowedType('app.ts')).toBe(true)
    expect(isAllowedType('style.css')).toBe(true)
    expect(isAllowedType('index.html')).toBe(true)
  })

  it('allows audio', () => {
    expect(isAllowedType('voice.mp3')).toBe(true)
    expect(isAllowedType('note.wav')).toBe(true)
  })

  it('blocks archives', () => {
    expect(isAllowedType('backup.zip')).toBe(false)
    expect(isAllowedType('data.tar')).toBe(false)
    expect(isAllowedType('pkg.gz')).toBe(false)
    expect(isAllowedType('files.7z')).toBe(false)
    expect(isAllowedType('stuff.rar')).toBe(false)
  })

  it('blocks video', () => {
    expect(isAllowedType('movie.mp4')).toBe(false)
    expect(isAllowedType('clip.mov')).toBe(false)
    expect(isAllowedType('stream.webm')).toBe(false)
  })

  it('blocks binary/unknown', () => {
    expect(isAllowedType('program.exe')).toBe(false)
    expect(isAllowedType('library.dll')).toBe(false)
  })

  it('blocks files with no extension', () => {
    expect(isAllowedType('Makefile')).toBe(false)
  })
})

// ─── checkQuota ──────────────────────────────────────────────────────────────

describe('checkQuota', () => {
  it('allows a small file within quota', () => {
    const db = mockDb(0, 0)
    const result = checkQuota(db, 1024, 'test.txt')
    expect(result.allowed).toBe(true)
  })

  it('rejects file exceeding per-file limit', () => {
    const db = mockDb(0, 0)
    const result = checkQuota(db, HOSTED_MAX_FILE_BYTES + 1, 'huge.pdf')
    expect(result.allowed).toBe(false)
    expect(result).toHaveProperty('reason')
    expect((result as any).reason).toContain('10 MB')
  })

  it('rejects blocked file types before checking quota', () => {
    const db = mockDb(0, 0)
    const result = checkQuota(db, 100, 'backup.zip')
    expect(result.allowed).toBe(false)
    expect((result as any).reason).toContain('archive')
  })

  it('rejects when file count limit reached', () => {
    const db = mockDb(1024, HOSTED_MAX_FILES)
    const result = checkQuota(db, 100, 'test.txt')
    expect(result.allowed).toBe(false)
    expect((result as any).reason).toContain('File limit reached')
  })

  it('rejects when total storage quota would be exceeded', () => {
    const remaining = 1024 // 1 KB remaining
    const db = mockDb(HOSTED_MAX_TOTAL_BYTES - remaining, 10)
    const result = checkQuota(db, remaining + 1, 'test.txt')
    expect(result.allowed).toBe(false)
    expect((result as any).reason).toContain('Storage quota exceeded')
  })

  it('allows file that exactly fills remaining quota', () => {
    const remaining = 5 * 1024 * 1024 // 5 MB remaining
    const db = mockDb(HOSTED_MAX_TOTAL_BYTES - remaining, 10)
    const result = checkQuota(db, remaining, 'test.pdf')
    expect(result.allowed).toBe(true)
  })
})

// ─── getStorageUsage ─────────────────────────────────────────────────────────

describe('getStorageUsage', () => {
  it('returns zero usage for empty store', () => {
    const db = mockDb(0, 0)
    const usage = getStorageUsage(db)
    expect(usage.totalBytes).toBe(0)
    expect(usage.fileCount).toBe(0)
    expect(usage.remainingBytes).toBe(HOSTED_MAX_TOTAL_BYTES)
    expect(usage.remainingFiles).toBe(HOSTED_MAX_FILES)
    expect(usage.percentUsed).toBe(0)
  })

  it('computes correct remaining values', () => {
    const used = 50 * 1024 * 1024 // 50 MB
    const db = mockDb(used, 100)
    const usage = getStorageUsage(db)
    expect(usage.totalBytes).toBe(used)
    expect(usage.fileCount).toBe(100)
    expect(usage.remainingBytes).toBe(HOSTED_MAX_TOTAL_BYTES - used)
    expect(usage.remainingFiles).toBe(HOSTED_MAX_FILES - 100)
    expect(usage.percentUsed).toBe(50)
  })

  it('floors remaining at zero when over quota', () => {
    const db = mockDb(HOSTED_MAX_TOTAL_BYTES + 1000, HOSTED_MAX_FILES + 10)
    const usage = getStorageUsage(db)
    expect(usage.remainingBytes).toBe(0)
    expect(usage.remainingFiles).toBe(0)
  })
})

// ─── Mode detection ──────────────────────────────────────────────────────────

describe('isHostedMode', () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.MYWAY_PARTNER_APPROOM_SECRET
    delete process.env.MYWAY_API_TOKEN
    delete process.env.MYWAY_BASE_DOMAIN
    delete process.env.MYWAY_ROOT
  })

  afterEach(() => {
    process.env = { ...origEnv }
  })

  it('returns false when no hosted env vars set (self-hosted)', () => {
    expect(isHostedMode()).toBe(false)
  })

  it('returns true when MYWAY_PARTNER_APPROOM_SECRET is set', () => {
    process.env.MYWAY_PARTNER_APPROOM_SECRET = 'test-secret'
    expect(isHostedMode()).toBe(true)
  })

  it('returns true when MYWAY_API_TOKEN is set', () => {
    process.env.MYWAY_API_TOKEN = 'test-token'
    expect(isHostedMode()).toBe(true)
  })

  it('returns true when MYWAY_BASE_DOMAIN is set', () => {
    process.env.MYWAY_BASE_DOMAIN = 'myway.sh'
    expect(isHostedMode()).toBe(true)
  })

  it('returns false when MYWAY_BASE_DOMAIN is whitespace only', () => {
    process.env.MYWAY_BASE_DOMAIN = '  '
    expect(isHostedMode()).toBe(false)
  })
})

describe('useArtifactStorage', () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.MYWAY_PARTNER_APPROOM_SECRET
    delete process.env.MYWAY_API_TOKEN
    delete process.env.MYWAY_BASE_DOMAIN
    delete process.env.MYWAY_ROOT
  })

  afterEach(() => {
    process.env = { ...origEnv }
  })

  it('returns false for self-hosted (no auth)', () => {
    expect(useArtifactStorage()).toBe(false)
  })

  it('returns true for hosted without MYWAY_ROOT', () => {
    process.env.MYWAY_API_TOKEN = 'test-token'
    expect(useArtifactStorage()).toBe(true)
  })

  it('returns false for hosted WITH MYWAY_ROOT (hybrid)', () => {
    process.env.MYWAY_API_TOKEN = 'test-token'
    process.env.MYWAY_ROOT = '/some/path'
    expect(useArtifactStorage()).toBe(false)
  })
})

// ─── Constants ───────────────────────────────────────────────────────────────

describe('limits', () => {
  it('has correct values', () => {
    expect(HOSTED_MAX_TOTAL_BYTES).toBe(100 * 1024 * 1024)
    expect(HOSTED_MAX_FILE_BYTES).toBe(10 * 1024 * 1024)
    expect(HOSTED_MAX_FILES).toBe(500)
  })
})
