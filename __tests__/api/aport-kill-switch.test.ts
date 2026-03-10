/**
 * API route tests — /api/aport/kill-switch
 *
 * Tests GET (read state) and POST (activate/deactivate) against
 * a temp passport.json. Uses _resetConfigCache() to inject env per-test.
 *
 * Kill switch now works by setting passport.json status to "suspended" (activate)
 * or "active" (deactivate). No separate sentinel file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/aport/kill-switch/route'
import { _resetConfigCache } from '@/lib/aport/config'

const tmpDir = join(tmpdir(), 'myway-api-ks-' + Math.random().toString(36).slice(2))
const passportFile = join(tmpDir, 'passport.json')

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/aport/kill-switch')
}

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/aport/kill-switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function writePassport(status: string) {
  writeFileSync(passportFile, JSON.stringify({
    passport_id: 'test-id',
    status,
    capabilities: [],
  }, null, 2))
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
  process.env.APORT_PASSPORT_FILE = passportFile
  _resetConfigCache()
})

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  delete process.env.APORT_PASSPORT_FILE
  _resetConfigCache()
})

describe('GET /api/aport/kill-switch', () => {
  it('returns active:false when passport has status "active"', async () => {
    writePassport('active')

    const res = await GET(makeGetRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.active).toBe(false)
    expect(body.passportStatus).toBe('active')
  })

  it('returns active:true when passport has status "suspended"', async () => {
    writePassport('suspended')

    const res = await GET(makeGetRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.active).toBe(true)
    expect(body.passportStatus).toBe('suspended')
  })
})

describe('POST /api/aport/kill-switch', () => {
  it('activate — sets passport status to "suspended"', async () => {
    writePassport('active')

    const res = await POST(makePostRequest({ action: 'activate' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.active).toBe(true)
    expect(body.passportStatus).toBe('suspended')

    // Verify file was actually mutated
    const raw = JSON.parse(readFileSync(passportFile, 'utf8'))
    expect(raw.status).toBe('suspended')
  })

  it('deactivate — sets passport status to "active"', async () => {
    writePassport('suspended')

    const res = await POST(makePostRequest({ action: 'deactivate' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.active).toBe(false)
    expect(body.passportStatus).toBe('active')

    const raw = JSON.parse(readFileSync(passportFile, 'utf8'))
    expect(raw.status).toBe('active')
  })

  it('returns 400 for missing action', async () => {
    const res = await POST(makePostRequest({}))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('action')
  })

  it('returns 400 for unknown action', async () => {
    const res = await POST(makePostRequest({ action: 'explode' }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('action')
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/aport/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json {]',
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('JSON')
  })

  it('deactivate is idempotent — works even when passport is already active', async () => {
    writePassport('active')

    const res = await POST(makePostRequest({ action: 'deactivate' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.active).toBe(false)
  })
})
