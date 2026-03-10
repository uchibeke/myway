import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readLocalPassport } from '@/lib/aport/passport-reader'

const tmpDir = join(tmpdir(), 'myway-passport-test-' + Math.random().toString(36).slice(2))

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('readLocalPassport', () => {
  it('returns configured:false for missing file', () => {
    const filePath = join(tmpDir, 'nonexistent.json')
    const status = readLocalPassport(filePath)

    expect(status.configured).toBe(false)
    expect(status.filePath).toBe(filePath)
  })

  it('parses a valid passport file', () => {
    const filePath = join(tmpDir, 'passport.json')
    const passport = {
      passport_id: 'test-id-123',
      owner_id: 'user@example.com',
      status: 'active',
      assurance_level: 'L1',
      spec_version: 'oap/1.0',
      kind: 'instance',
      capabilities: [
        { id: 'repo.pr.create' },
        { id: 'system.command.execute' },
      ],
    }
    writeFileSync(filePath, JSON.stringify(passport))

    const status = readLocalPassport(filePath)

    expect(status.configured).toBe(true)
    expect(status.passportId).toBe('test-id-123')
    expect(status.ownerId).toBe('user@example.com')
    expect(status.status).toBe('active')
    expect(status.assuranceLevel).toBe('L1')
    expect(status.capabilities).toHaveLength(2)
  })

  it('returns error for malformed JSON', () => {
    const filePath = join(tmpDir, 'bad.json')
    writeFileSync(filePath, 'not valid json {]')

    const status = readLocalPassport(filePath)

    expect(status.configured).toBe(true)
    expect(status.error).toContain('JSON')
    expect(status.passportId).toBeUndefined()
  })

  it('returns error for non-object JSON', () => {
    const filePath = join(tmpDir, 'array.json')
    writeFileSync(filePath, '["not", "an", "object"]')

    const status = readLocalPassport(filePath)

    expect(status.configured).toBe(true)
    expect(status.error).toContain('object')
  })

  it('handles missing optional fields', () => {
    const filePath = join(tmpDir, 'minimal.json')
    writeFileSync(filePath, '{}')

    const status = readLocalPassport(filePath)

    expect(status.configured).toBe(true)
    expect(status.error).toBeUndefined()
    expect(status.passportId).toBeUndefined()
    expect(status.status).toBe('active')  // default
    expect(status.assuranceLevel).toBe('L0')  // default
  })

  it('filters non-capability objects from capabilities array', () => {
    const filePath = join(tmpDir, 'mixed.json')
    writeFileSync(
      filePath,
      JSON.stringify({
        capabilities: [
          { id: 'good1' },
          'not an object',
          null,
          { id: 'good2' },
          { noIdField: 'bad' },
        ],
      }),
    )

    const status = readLocalPassport(filePath)

    expect(status.capabilities).toHaveLength(2)
    expect(status.capabilities?.[0].id).toBe('good1')
    expect(status.capabilities?.[1].id).toBe('good2')
  })
})
