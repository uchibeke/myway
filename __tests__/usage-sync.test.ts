import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockPrepare = vi.fn()
const mockDb = {
  prepare: mockPrepare,
}

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}))

vi.mock('@/lib/db/config', () => ({
  DATA_DIR: '/tmp/test-data',
}))

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => mockDb),
}))

import { syncUsageToAppRoom } from '@/lib/usage-sync'
import { existsSync, readdirSync } from 'fs'
import { getDb } from '@/lib/db'

// ─── syncUsageToAppRoom ─────────────────────────────────────────────────────

describe('syncUsageToAppRoom', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    vi.clearAllMocks()
    // Default: DB returns no usage data
    mockPrepare.mockReturnValue({
      get: vi.fn(() => undefined),
      all: vi.fn(() => []),
      run: vi.fn(),
    })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns null when MYWAY_APPROOM_URL is not set', async () => {
    delete process.env.MYWAY_APPROOM_URL
    delete process.env.MYWAY_PARTNER_APPROOM_SECRET

    const result = await syncUsageToAppRoom()
    expect(result).toBeNull()
  })

  it('returns null when MYWAY_PARTNER_APPROOM_SECRET is not set', async () => {
    process.env.MYWAY_APPROOM_URL = 'https://approom.test'
    delete process.env.MYWAY_PARTNER_APPROOM_SECRET

    const result = await syncUsageToAppRoom()
    expect(result).toBeNull()
  })

  it('returns null when MYWAY_APPROOM_URL is empty', async () => {
    process.env.MYWAY_APPROOM_URL = '  '
    process.env.MYWAY_PARTNER_APPROOM_SECRET = 'secret'

    const result = await syncUsageToAppRoom()
    expect(result).toBeNull()
  })

  it('returns zero counts when no usage data exists', async () => {
    process.env.MYWAY_APPROOM_URL = 'https://approom.test'
    process.env.MYWAY_PARTNER_APPROOM_SECRET = 'test-secret'

    const result = await syncUsageToAppRoom()
    expect(result).toEqual({ tenantsSynced: 0, totalRecords: 0, totalTokens: 0 })
  })

  it('aggregates usage from default tenant and posts via approom client', async () => {
    process.env.MYWAY_APPROOM_URL = 'https://approom.test'
    process.env.MYWAY_PARTNER_APPROOM_SECRET = 'test-secret'
    process.env.MYWAY_INSTANCE_ID = 'test-instance'

    // Mock DB to return usage data
    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('last_usage_sync_at')) {
        return { get: vi.fn(() => undefined), run: vi.fn() }
      }
      if (sql.includes('GROUP BY model')) {
        return {
          all: vi.fn(() => [{
            model: 'claude-sonnet-4-6',
            totalTokens: 1000,
            promptTokens: 600,
            completionTokens: 400,
            estimatedCostUsd: 0.01,
            periodStart: 1709600000,
            periodEnd: 1709700000,
            requestCount: 5,
          }]),
        }
      }
      return { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() }
    })

    // Mock fetch — approom/client.reportUsage() calls appRoomFetch() which uses fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accepted: 1 }),
    })
    global.fetch = mockFetch

    const result = await syncUsageToAppRoom()

    expect(result).not.toBeNull()
    expect(result!.tenantsSynced).toBe(1)
    expect(result!.totalRecords).toBe(1)
    expect(result!.totalTokens).toBe(1000)

    // Verify POST was made via approom client
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('https://approom.test/api/usage/report')
    expect(opts.method).toBe('POST')
    expect(opts.headers['X-Myway-Signature']).toBeTruthy()
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect(opts.headers['X-Myway-Instance']).toBe('test-instance')

    // Verify payload matches AppRoom schema (snake_case wire format)
    const body = JSON.parse(opts.body)
    expect(body.instanceId).toBe('test-instance')
    expect(Array.isArray(body.users)).toBe(true)
    expect(body.users[0].userId).toBe('default')
    expect(body.users[0].prompt_tokens).toBe(600)
    expect(body.users[0].completion_tokens).toBe(400)
    expect(body.users[0].estimated_cost_usd).toBe(0.01)
    expect(body.users[0].models).toContain('claude-sonnet-4-6')
    expect(body.users[0].period_start).toBeTruthy()
    expect(body.users[0].period_end).toBeTruthy()
  })

  it('discovers and syncs tenant directories', async () => {
    process.env.MYWAY_APPROOM_URL = 'https://approom.test'
    process.env.MYWAY_PARTNER_APPROOM_SECRET = 'test-secret'

    // Mock tenant directory discovery
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'tenant-a', isDirectory: () => true } as any,
      { name: 'tenant-b', isDirectory: () => true } as any,
      { name: '.hidden', isDirectory: () => true } as any, // won't match regex
    ])

    // No usage data
    mockPrepare.mockReturnValue({
      get: vi.fn(() => undefined),
      all: vi.fn(() => []),
      run: vi.fn(),
    })

    const result = await syncUsageToAppRoom()
    // 3 tenants checked (default + tenant-a + tenant-b), .hidden skipped
    expect(result).toEqual({ tenantsSynced: 0, totalRecords: 0, totalTokens: 0 })
    // getDb called for default + 2 tenants (not .hidden due to regex)
    expect(getDb).toHaveBeenCalledTimes(3)
  })

  it('handles AppRoom rejection gracefully', async () => {
    process.env.MYWAY_APPROOM_URL = 'https://approom.test'
    process.env.MYWAY_PARTNER_APPROOM_SECRET = 'test-secret'

    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('GROUP BY model')) {
        return {
          all: vi.fn(() => [{
            model: 'gpt-4o', totalTokens: 500, promptTokens: 300,
            completionTokens: 200, estimatedCostUsd: 0.005,
            periodStart: 1709600000, periodEnd: 1709700000, requestCount: 2,
          }]),
        }
      }
      return { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() }
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
      statusText: 'Forbidden',
    })

    const result = await syncUsageToAppRoom()
    expect(result).not.toBeNull()
    expect(result!.error).toContain('403')
  })

  it('handles network failure gracefully', async () => {
    process.env.MYWAY_APPROOM_URL = 'https://approom.test'
    process.env.MYWAY_PARTNER_APPROOM_SECRET = 'test-secret'

    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('GROUP BY model')) {
        return {
          all: vi.fn(() => [{
            model: 'gpt-4o', totalTokens: 100, promptTokens: 50,
            completionTokens: 50, estimatedCostUsd: 0.001,
            periodStart: 1709600000, periodEnd: 1709700000, requestCount: 1,
          }]),
        }
      }
      return { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() }
    })

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const result = await syncUsageToAppRoom()
    expect(result).not.toBeNull()
    expect(result!.error).toBe('Network error')
  })
})

// ─── HMAC signing ───────────────────────────────────────────────────────────

describe('HMAC signing', () => {
  it('produces consistent SHA-256 signatures', () => {
    const body = JSON.stringify({ test: 'data' })
    const secret = 'test-secret'

    const sig1 = createHmac('sha256', secret).update(body).digest('hex')
    const sig2 = createHmac('sha256', secret).update(body).digest('hex')

    expect(sig1).toBe(sig2)
    expect(sig1).toHaveLength(64)
  })

  it('produces different signatures for different bodies', () => {
    const secret = 'test-secret'
    const sig1 = createHmac('sha256', secret).update('body1').digest('hex')
    const sig2 = createHmac('sha256', secret).update('body2').digest('hex')
    expect(sig1).not.toBe(sig2)
  })

  it('produces different signatures for different secrets', () => {
    const body = 'same-body'
    const sig1 = createHmac('sha256', 'secret1').update(body).digest('hex')
    const sig2 = createHmac('sha256', 'secret2').update(body).digest('hex')
    expect(sig1).not.toBe(sig2)
  })
})
