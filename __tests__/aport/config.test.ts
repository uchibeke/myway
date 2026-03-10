import { describe, it, expect, beforeEach } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'

// Reset module cache and env vars between tests
beforeEach(() => {
  // Clear the config cache by resetting the module
  vi.resetModules()
  delete process.env['OPENCLAW_DIR']
  delete process.env['APORT_PASSPORT_FILE']
  delete process.env['APORT_AUDIT_LOG']
  delete process.env['APORT_DECISION_FILE']
  delete process.env['APORT_MODE']
})

import { vi } from 'vitest'

describe('getAportConfig', () => {
  it('returns default paths under ~/.openclaw when no env vars set', async () => {
    const { getAportConfig } = await import('@/lib/aport/config')
    const config = getAportConfig()
    const home = homedir()

    expect(config.openclawDir).toBe(join(home, '.openclaw'))
    expect(config.passportFile).toBe(join(home, '.openclaw', 'aport', 'passport.json'))
    expect(config.auditLog).toBe(join(home, '.openclaw', 'aport', 'audit.log'))
    expect(config.decisionFile).toBe(join(home, '.openclaw', 'aport', 'decision.json'))
  })

  it('respects OPENCLAW_DIR env var', async () => {
    process.env['OPENCLAW_DIR'] = '/custom/openclaw'
    const { getAportConfig } = await import('@/lib/aport/config')
    const config = getAportConfig()

    expect(config.openclawDir).toBe('/custom/openclaw')
    expect(config.passportFile).toBe('/custom/openclaw/aport/passport.json')
  })

  it('respects individual file env var overrides', async () => {
    process.env['APORT_PASSPORT_FILE'] = '/my/passport.json'
    process.env['APORT_AUDIT_LOG']     = '/my/audit.log'

    const { getAportConfig } = await import('@/lib/aport/config')
    const config = getAportConfig()

    expect(config.passportFile).toBe('/my/passport.json')
    expect(config.auditLog).toBe('/my/audit.log')
  })

  it('expands ~ in env var paths', async () => {
    process.env['APORT_AUDIT_LOG'] = '~/custom/audit.log'
    const { getAportConfig } = await import('@/lib/aport/config')
    const config = getAportConfig()

    expect(config.auditLog).toBe(join(homedir(), 'custom', 'audit.log'))
    expect(config.auditLog).not.toContain('~')
  })

  it('defaults to local mode', async () => {
    const { getAportConfig } = await import('@/lib/aport/config')
    const config = getAportConfig()

    expect(config.mode).toBe('local')
    expect(config.hosted).toBe(false)
  })
})
