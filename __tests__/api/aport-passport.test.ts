/**
 * API route tests -- /api/aport/passport
 *
 * Strategy: override APORT_PASSPORT_FILE via env + call _resetConfigCache()
 * before each test so getAportConfig() picks up the new value. No mocking
 * framework needed -- the config module was designed for this (see config.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/aport/passport/route'
import { _resetConfigCache } from '@/lib/aport/config'

const tmpDir = join(tmpdir(), 'myway-api-passport-' + Math.random().toString(36).slice(2))

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/api/aport/passport')
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
  _resetConfigCache()
  // Stub global fetch so tests never hit external APIs (e.g. api.aport.io/api/verify)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
})

afterEach(() => {
  vi.restoreAllMocks()
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  delete process.env.APORT_PASSPORT_FILE
  _resetConfigCache()
})

describe('GET /api/aport/passport', () => {
  it('returns configured:false when passport file does not exist', async () => {
    process.env.APORT_PASSPORT_FILE = join(tmpDir, 'nonexistent.json')

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.current.configured).toBe(false)
    expect(body.passports).toEqual([])
  })

  it('returns passport metadata for a valid passport', async () => {
    const passportPath = join(tmpDir, 'passport.json')
    writeFileSync(
      passportPath,
      JSON.stringify({
        passport_id: 'test-passport-id',
        owner_id: 'user@example.com',
        status: 'active',
        assurance_level: 'L1',
        spec_version: 'oap/1.0',
        capabilities: [
          { id: 'system.command.execute' },
          { id: 'repo.pr.create' },
        ],
      }),
    )
    process.env.APORT_PASSPORT_FILE = passportPath

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.current.configured).toBe(true)
    expect(body.current.passportId).toBe('test-passport-id')
    expect(body.current.ownerId).toBe('user@example.com')
    expect(body.current.status).toBe('active')
    expect(body.current.assuranceLevel).toBe('L1')
    expect(body.current.capabilities).toHaveLength(2)
    expect(body.current.capabilities[0].id).toBe('system.command.execute')
  })

  it('returns error field for malformed passport JSON', async () => {
    const passportPath = join(tmpDir, 'bad.json')
    writeFileSync(passportPath, '{not valid json')
    process.env.APORT_PASSPORT_FILE = passportPath

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.current.configured).toBe(true)
    expect(typeof body.current.error).toBe('string')
    expect(body.current.passportId).toBeUndefined()
  })

  it('returns error field for array passport JSON', async () => {
    const passportPath = join(tmpDir, 'array.json')
    writeFileSync(passportPath, '[{"id":"should-be-object"}]')
    process.env.APORT_PASSPORT_FILE = passportPath

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.current.error).toContain('object')
  })
})
