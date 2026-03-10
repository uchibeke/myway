import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseAuditLine, readAuditLog, getAuditLogSize } from '@/lib/aport/audit-parser'

const tmpDir = join(tmpdir(), 'myway-audit-test-' + Math.random().toString(36).slice(2))

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('parseAuditLine — synthetic IDs', () => {
  it('generates synthetic ID when decision_id is missing (v1.0.12+ format)', () => {
    const line = '[2026-03-02 09:38:24] tool=read allow=true policy=data.file.read.v1 code=oap.allowed context="test.txt"'
    const ev = parseAuditLine(line)

    expect(ev).not.toBeNull()
    expect(ev?.id).toMatch(/^syn-[a-f0-9]{12}$/)
    expect(ev?.tool).toBe('read')
  })

  it('generates stable synthetic ID (deterministic)', () => {
    const line = '[2026-03-02 09:38:24] tool=read allow=true policy=p1 code=c1 context="same"'
    const ev1 = parseAuditLine(line)
    const ev2 = parseAuditLine(line)

    expect(ev1?.id).toBe(ev2?.id)
  })

  it('uses real decision_id when present', () => {
    const line = '[2026-03-02 09:38:24] tool=exec decision_id=abc123 allow=true policy=p1 code=c1 context="ls"'
    const ev = parseAuditLine(line)

    expect(ev?.id).toBe('abc123')
  })

  it('defaults missing policy and code to empty string', () => {
    const line = '[2026-03-02 09:38:24] tool=exec decision_id=abc123 allow=true context="ls"'
    const ev = parseAuditLine(line)

    expect(ev?.policy).toBe('')
    expect(ev?.code).toBe('')
  })

  it('handles unquoted context value', () => {
    const line = '[2026-03-02 09:38:24] tool=exec decision_id=abc123 allow=true policy=p1 code=c1 context=simple'
    const ev = parseAuditLine(line)

    expect(ev?.context).toBe('simple')
  })

  it('handles missing context field', () => {
    const line = '[2026-03-02 09:38:24] tool=exec decision_id=abc123 allow=true policy=p1 code=c1'
    const ev = parseAuditLine(line)

    expect(ev).not.toBeNull()
    expect(ev?.context).toBe('')
  })
})

describe('readAuditLog', () => {
  it('returns empty array for nonexistent file', async () => {
    const events = await readAuditLog(join(tmpDir, 'nope.log'))
    expect(events).toEqual([])
  })

  it('reads and parses a log file', async () => {
    const logFile = join(tmpDir, 'audit.log')
    writeFileSync(logFile, [
      '[2026-03-01 10:00:00] tool=exec decision_id=id1 allow=true policy=p1 code=c1 context="ls"',
      '[2026-03-01 10:00:01] tool=read decision_id=id2 allow=false policy=p2 code=oap.denied context="secret.txt"',
      '[2026-03-01 10:00:02] tool=write decision_id=id3 allow=true policy=p3 code=c3 context="output.txt"',
    ].join('\n'))

    const events = await readAuditLog(logFile)

    expect(events).toHaveLength(3)
    // Newest first
    expect(events[0].id).toBe('id3')
    expect(events[2].id).toBe('id1')
  })

  it('respects limit option', async () => {
    const logFile = join(tmpDir, 'audit.log')
    const lines = Array.from({ length: 10 }, (_, i) =>
      `[2026-03-01 10:00:${String(i).padStart(2, '0')}] tool=exec decision_id=id${i} allow=true policy=p1 code=c1 context="cmd${i}"`
    )
    writeFileSync(logFile, lines.join('\n'))

    const events = await readAuditLog(logFile, { limit: 3 })

    expect(events).toHaveLength(3)
  })

  it('filters blocked-only events', async () => {
    const logFile = join(tmpDir, 'audit.log')
    writeFileSync(logFile, [
      '[2026-03-01 10:00:00] tool=exec decision_id=id1 allow=true policy=p1 code=c1 context="safe"',
      '[2026-03-01 10:00:01] tool=exec decision_id=id2 allow=false policy=p2 code=oap.denied context="blocked"',
      '[2026-03-01 10:00:02] tool=exec decision_id=id3 allow=true policy=p3 code=c3 context="also-safe"',
    ].join('\n'))

    const events = await readAuditLog(logFile, { blockedOnly: true })

    expect(events).toHaveLength(1)
    expect(events[0].allowed).toBe(false)
    expect(events[0].id).toBe('id2')
  })

  it('supports sinceId cursor pagination', async () => {
    const logFile = join(tmpDir, 'audit.log')
    writeFileSync(logFile, [
      '[2026-03-01 10:00:00] tool=exec decision_id=id1 allow=true policy=p1 code=c1 context="first"',
      '[2026-03-01 10:00:01] tool=exec decision_id=id2 allow=true policy=p1 code=c1 context="second"',
      '[2026-03-01 10:00:02] tool=exec decision_id=id3 allow=true policy=p1 code=c1 context="third"',
    ].join('\n'))

    // Events are sorted newest-first: id3, id2, id1
    // sinceId=id2 means "events newer than id2" → only id3
    const events = await readAuditLog(logFile, { sinceId: 'id2' })

    expect(events).toHaveLength(1)
    expect(events[0].id).toBe('id3')
  })

  it('returns all events when sinceId not found', async () => {
    const logFile = join(tmpDir, 'audit.log')
    writeFileSync(logFile, [
      '[2026-03-01 10:00:00] tool=exec decision_id=id1 allow=true policy=p1 code=c1 context="one"',
      '[2026-03-01 10:00:01] tool=exec decision_id=id2 allow=true policy=p1 code=c1 context="two"',
    ].join('\n'))

    const events = await readAuditLog(logFile, { sinceId: 'nonexistent' })

    expect(events).toHaveLength(2)
  })

  it('skips blank lines and malformed lines', async () => {
    const logFile = join(tmpDir, 'audit.log')
    writeFileSync(logFile, [
      '[2026-03-01 10:00:00] tool=exec decision_id=id1 allow=true policy=p1 code=c1 context="valid"',
      '',
      'garbage line no timestamp',
      '   ',
      '[2026-03-01 10:00:01] tool=read decision_id=id2 allow=true policy=p2 code=c2 context="also-valid"',
    ].join('\n'))

    const events = await readAuditLog(logFile)

    expect(events).toHaveLength(2)
  })

  it('supports fromByte offset', async () => {
    const logFile = join(tmpDir, 'audit.log')
    const line1 = '[2026-03-01 10:00:00] tool=exec decision_id=id1 allow=true policy=p1 code=c1 context="first"'
    const line2 = '[2026-03-01 10:00:01] tool=exec decision_id=id2 allow=true policy=p1 code=c1 context="second"'
    writeFileSync(logFile, line1 + '\n' + line2 + '\n')

    // Read from after the first line
    const events = await readAuditLog(logFile, { fromByte: line1.length + 1 })

    expect(events).toHaveLength(1)
    expect(events[0].id).toBe('id2')
  })
})

describe('getAuditLogSize', () => {
  it('returns 0 for nonexistent file', () => {
    expect(getAuditLogSize(join(tmpDir, 'nope.log'))).toBe(0)
  })

  it('returns file size for existing file', () => {
    const logFile = join(tmpDir, 'audit.log')
    const content = 'some log content here\n'
    writeFileSync(logFile, content)

    expect(getAuditLogSize(logFile)).toBe(Buffer.byteLength(content))
  })

  it('returns 0 for empty file', () => {
    const logFile = join(tmpDir, 'empty.log')
    writeFileSync(logFile, '')

    expect(getAuditLogSize(logFile)).toBe(0)
  })
})
