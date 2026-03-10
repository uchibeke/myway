import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readKillSwitch, activateKillSwitch, deactivateKillSwitch } from '@/lib/aport/kill-switch'

const tmpDir = join(tmpdir(), 'myway-killswitch-test-' + Math.random().toString(36).slice(2))
const passportFile = join(tmpDir, 'passport.json')

/** Write a minimal passport.json with given status */
function writePassport(status: string) {
  writeFileSync(passportFile, JSON.stringify({ status, passport_id: 'test-id' }, null, 2))
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('readKillSwitch', () => {
  it('returns active:false for nonexistent passport file', () => {
    const state = readKillSwitch(passportFile)

    expect(state.active).toBe(false)
    expect(state.path).toBe(passportFile)
    expect(state.mode).toBe('local')
  })

  it('returns active:false for passport with status "active"', () => {
    writePassport('active')
    const state = readKillSwitch(passportFile)

    expect(state.active).toBe(false)
    expect(state.passportStatus).toBe('active')
  })

  it('returns active:true for passport with status "suspended"', () => {
    writePassport('suspended')
    const state = readKillSwitch(passportFile)

    expect(state.active).toBe(true)
    expect(state.passportStatus).toBe('suspended')
  })

  it('returns active:true for passport with status "revoked"', () => {
    writePassport('revoked')
    const state = readKillSwitch(passportFile)

    expect(state.active).toBe(true)
    expect(state.passportStatus).toBe('revoked')
  })
})

describe('activateKillSwitch', () => {
  it('sets passport status to "suspended"', () => {
    writePassport('active')

    const state = activateKillSwitch(passportFile)

    expect(state.active).toBe(true)
    expect(state.passportStatus).toBe('suspended')

    // Verify the file was actually mutated
    const raw = JSON.parse(readFileSync(passportFile, 'utf8'))
    expect(raw.status).toBe('suspended')
  })

  it('preserves other passport fields', () => {
    writeFileSync(passportFile, JSON.stringify({
      status: 'active',
      passport_id: 'test-id-123',
      owner_id: 'user@example.com',
      capabilities: [{ id: 'repo.pr.create' }],
    }, null, 2))

    activateKillSwitch(passportFile)

    const raw = JSON.parse(readFileSync(passportFile, 'utf8'))
    expect(raw.status).toBe('suspended')
    expect(raw.passport_id).toBe('test-id-123')
    expect(raw.owner_id).toBe('user@example.com')
    expect(raw.capabilities).toHaveLength(1)
  })

  it('returns active:false for nonexistent passport', () => {
    const state = activateKillSwitch(passportFile)
    expect(state.active).toBe(false)
  })
})

describe('deactivateKillSwitch', () => {
  it('sets passport status to "active"', () => {
    writePassport('suspended')

    const state = deactivateKillSwitch(passportFile)

    expect(state.active).toBe(false)
    expect(state.passportStatus).toBe('active')

    const raw = JSON.parse(readFileSync(passportFile, 'utf8'))
    expect(raw.status).toBe('active')
  })

  it('handles already-active passport gracefully', () => {
    writePassport('active')

    const state = deactivateKillSwitch(passportFile)

    expect(state.active).toBe(false)
    expect(state.passportStatus).toBe('active')
  })

  it('returns active:false for nonexistent passport', () => {
    const state = deactivateKillSwitch(passportFile)
    expect(state.active).toBe(false)
  })
})
