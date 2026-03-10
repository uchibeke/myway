import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  readKillSwitch,
  activateKillSwitch,
  deactivateKillSwitch,
  readKillSwitchHosted,
  toggleKillSwitchHosted,
} from '@/lib/aport/kill-switch'
import type { AportConfig } from '@/lib/aport/config'

const tmpDir = join(tmpdir(), 'myway-ks-ext-test-' + Math.random().toString(36).slice(2))
const passportFile = join(tmpDir, 'passport.json')

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  vi.restoreAllMocks()
})

describe('readKillSwitch — edge cases', () => {
  it('fail-closed on invalid JSON (active:true)', () => {
    writeFileSync(passportFile, 'not valid json{')
    const state = readKillSwitch(passportFile)

    expect(state.active).toBe(true)
    expect(state.passportStatus).toBe('unknown')
    expect(state.mode).toBe('local')
  })

  it('treats missing status field as active', () => {
    writeFileSync(passportFile, JSON.stringify({ passport_id: 'test' }))
    const state = readKillSwitch(passportFile)

    expect(state.active).toBe(false)
    expect(state.passportStatus).toBe('active')
  })

  it('treats non-string status as active', () => {
    writeFileSync(passportFile, JSON.stringify({ status: 123 }))
    const state = readKillSwitch(passportFile)

    expect(state.active).toBe(false)
    expect(state.passportStatus).toBe('active')
  })
})

describe('activateKillSwitch — edge cases', () => {
  it('returns active:false for non-object JSON', () => {
    writeFileSync(passportFile, '"just a string"')
    const state = activateKillSwitch(passportFile)

    expect(state.active).toBe(false)
  })

  it('returns active:false for null JSON', () => {
    writeFileSync(passportFile, 'null')
    const state = activateKillSwitch(passportFile)

    expect(state.active).toBe(false)
  })
})

describe('deactivateKillSwitch — edge cases', () => {
  it('returns active:false for non-object JSON', () => {
    writeFileSync(passportFile, '42')
    const state = deactivateKillSwitch(passportFile)

    expect(state.active).toBe(false)
  })
})

describe('readKillSwitchHosted', () => {
  const config: AportConfig = {
    mode: 'api',
    hosted: true,
    passportFile: '',
    auditLog: '',
    decisionFile: '',
    openclawDir: '',
    apiUrl: 'https://api.aport.io',
    apiKey: 'test-key',
    agentId: 'ap_test123',
  }

  it('returns active:false for active passport', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'active' }), { status: 200 })
    )

    const state = await readKillSwitchHosted(config)

    expect(state.active).toBe(false)
    expect(state.passportStatus).toBe('active')
    expect(state.mode).toBe('hosted')
  })

  it('returns active:true for suspended passport', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'suspended' }), { status: 200 })
    )

    const state = await readKillSwitchHosted(config)

    expect(state.active).toBe(true)
    expect(state.passportStatus).toBe('suspended')
  })

  it('fail-closed on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Server Error', { status: 500 })
    )

    const state = await readKillSwitchHosted(config)

    expect(state.active).toBe(true)
    expect(state.passportStatus).toBe('unknown')
  })

  it('fail-closed on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network unreachable'))

    const state = await readKillSwitchHosted(config)

    expect(state.active).toBe(true)
    expect(state.passportStatus).toBe('unreachable')
  })

  it('fail-closed on unknown status field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ no_status: true }), { status: 200 })
    )

    const state = await readKillSwitchHosted(config)

    expect(state.active).toBe(true)
    expect(state.passportStatus).toBe('unknown')
  })
})

describe('toggleKillSwitchHosted', () => {
  const config: AportConfig = {
    mode: 'api',
    hosted: true,
    passportFile: '',
    auditLog: '',
    decisionFile: '',
    openclawDir: '',
    apiUrl: 'https://api.aport.io',
    apiKey: 'test-key',
    agentId: 'ap_test123',
  }

  it('activates (suspends) via API then reads status', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    // First call: POST to suspend
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    // Second call: GET passport status (readKillSwitchHosted)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'suspended' }), { status: 200 })
    )

    const state = await toggleKillSwitchHosted(config, 'activate')

    expect(state.active).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('/suspend')
  })

  it('deactivates (reactivates) via API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'active' }), { status: 200 })
    )

    const state = await toggleKillSwitchHosted(config, 'deactivate')

    expect(state.active).toBe(false)
    expect(fetchMock.mock.calls[0][0]).toContain('/reactivate')
  })

  it('throws on HTTP error from toggle endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    )

    await expect(toggleKillSwitchHosted(config, 'activate'))
      .rejects.toThrow('Failed to activate kill switch')
  })

  it('throws on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'))

    await expect(toggleKillSwitchHosted(config, 'deactivate'))
      .rejects.toThrow('Failed to deactivate kill switch')
  })
})
