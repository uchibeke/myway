import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { checkSpendLimit, buildSpendLimitExceededBody } from '@/lib/quota-gate'

// Mock hosted-storage
vi.mock('@/lib/hosted-storage', () => ({
  isHostedMode: vi.fn(() => false),
}))

// Mock approom client (imported by quota-gate)
vi.mock('@/lib/approom/client', () => ({
  checkQuota: vi.fn(),
  isConfigured: vi.fn(() => false),
  sendNotificationEmail: vi.fn(),
  checkUserPlan: vi.fn(async () => ({ plan: 'free' as const, isActive: true })),
}))

// Mock notifications (imported by quota-gate)
vi.mock('@/lib/store/notifications', () => ({
  addNotification: vi.fn(),
}))

const { isHostedMode } = await import('@/lib/hosted-storage')
const { checkUserPlan } = await import('@/lib/approom/client')

function mockDb(totalCostUsd: number, planValue?: string) {
  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('token_usage')) {
        return { get: vi.fn(() => ({ total: totalCostUsd })), run: vi.fn(), all: vi.fn(() => []) }
      }
      if (sql.includes("key = 'plan'")) {
        // Return null to force AppRoom lookup (no cache)
        return { get: vi.fn(() => undefined), run: vi.fn() }
      }
      if (sql.includes("key = 'approom_user_id'")) {
        return { get: vi.fn(() => ({ value: 'user-123' })) }
      }
      // INSERT for plan cache
      return { get: vi.fn(() => undefined), run: vi.fn() }
    }),
  } as any
}

function mockDbThrows() {
  return {
    prepare: vi.fn(() => { throw new Error('no such table') }),
  } as any
}

describe('checkSpendLimit', () => {
  beforeEach(() => {
    delete process.env.MYWAY_MAX_FREE_SPEND
    delete process.env.MYWAY_MAX_PAID_SPEND
    vi.mocked(checkUserPlan).mockResolvedValue({ plan: 'free', isActive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.MYWAY_MAX_FREE_SPEND
    delete process.env.MYWAY_MAX_PAID_SPEND
  })

  it('allows when not in hosted mode', async () => {
    vi.mocked(isHostedMode).mockReturnValue(false)
    process.env.MYWAY_MAX_FREE_SPEND = '5.00'
    const result = await checkSpendLimit(mockDb(10))
    expect(result.allowed).toBe(true)
  })

  it('allows when no spend limits are set', async () => {
    vi.mocked(isHostedMode).mockReturnValue(true)
    const result = await checkSpendLimit(mockDb(100))
    expect(result.allowed).toBe(true)
  })

  it('allows free user when spend is below free limit', async () => {
    vi.mocked(isHostedMode).mockReturnValue(true)
    process.env.MYWAY_MAX_FREE_SPEND = '2.00'
    const result = await checkSpendLimit(mockDb(1.50))
    expect(result.allowed).toBe(true)
    expect(result.currentSpendUsd).toBe(1.5)
    expect(result.limitUsd).toBe(2)
    expect(result.plan).toBe('free')
  })

  it('denies free user when spend exceeds free limit', async () => {
    vi.mocked(isHostedMode).mockReturnValue(true)
    process.env.MYWAY_MAX_FREE_SPEND = '2.00'
    const result = await checkSpendLimit(mockDb(2.01))
    expect(result.allowed).toBe(false)
    expect(result.plan).toBe('free')
  })

  it('uses paid limit for personal plan users', async () => {
    vi.mocked(isHostedMode).mockReturnValue(true)
    vi.mocked(checkUserPlan).mockResolvedValue({ plan: 'personal', isActive: true })
    process.env.MYWAY_MAX_FREE_SPEND = '2.00'
    process.env.MYWAY_MAX_PAID_SPEND = '19.00'
    // Spend above free limit but below paid limit
    const result = await checkSpendLimit(mockDb(10.00))
    expect(result.allowed).toBe(true)
    expect(result.plan).toBe('personal')
    expect(result.limitUsd).toBe(19)
  })

  it('denies personal user when spend exceeds paid limit', async () => {
    vi.mocked(isHostedMode).mockReturnValue(true)
    vi.mocked(checkUserPlan).mockResolvedValue({ plan: 'personal', isActive: true })
    process.env.MYWAY_MAX_FREE_SPEND = '2.00'
    process.env.MYWAY_MAX_PAID_SPEND = '19.00'
    const result = await checkSpendLimit(mockDb(19.50))
    expect(result.allowed).toBe(false)
    expect(result.plan).toBe('personal')
  })

  it('treats inactive personal plan as free', async () => {
    vi.mocked(isHostedMode).mockReturnValue(true)
    vi.mocked(checkUserPlan).mockResolvedValue({ plan: 'personal', isActive: false })
    process.env.MYWAY_MAX_FREE_SPEND = '2.00'
    process.env.MYWAY_MAX_PAID_SPEND = '19.00'
    const result = await checkSpendLimit(mockDb(5.00))
    expect(result.allowed).toBe(false)
    expect(result.plan).toBe('free')
  })

  it('allows when only paid limit set and user is free (no free limit)', async () => {
    vi.mocked(isHostedMode).mockReturnValue(true)
    process.env.MYWAY_MAX_PAID_SPEND = '19.00'
    // No MYWAY_MAX_FREE_SPEND → no limit for free users
    const result = await checkSpendLimit(mockDb(100))
    expect(result.allowed).toBe(true)
    expect(result.plan).toBe('free')
  })

  it('allows when limit is invalid (NaN)', async () => {
    vi.mocked(isHostedMode).mockReturnValue(true)
    process.env.MYWAY_MAX_FREE_SPEND = 'abc'
    const result = await checkSpendLimit(mockDb(100))
    expect(result.allowed).toBe(true)
  })

  it('treats missing token_usage table as zero spend', async () => {
    vi.mocked(isHostedMode).mockReturnValue(true)
    process.env.MYWAY_MAX_FREE_SPEND = '5.00'
    const result = await checkSpendLimit(mockDbThrows())
    expect(result.allowed).toBe(true)
    expect(result.currentSpendUsd).toBe(0)
  })
})

describe('buildSpendLimitExceededBody', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APPROOM_URL
    delete process.env.MYWAY_APPROOM_URL
  })

  it('builds free-tier exceeded response', () => {
    process.env.NEXT_PUBLIC_APPROOM_URL = 'https://approom.ai'
    const body = buildSpendLimitExceededBody({
      allowed: false,
      currentSpendUsd: 2.25,
      limitUsd: 2.00,
      plan: 'free',
    })
    expect(body.quotaExceeded).toBe(true)
    expect(body.message).toContain('$2.00')
    expect(body.message).toContain('Upgrade to Personal')
    expect(body.spendLimit.currentSpendUsd).toBe(2.25)
    expect(body.spendLimit.limitUsd).toBe(2)
    expect(body.appRoomUrl).toBe('https://approom.ai')
  })

  it('builds paid-tier exceeded response', () => {
    const body = buildSpendLimitExceededBody({
      allowed: false,
      currentSpendUsd: 19.50,
      limitUsd: 19.00,
      plan: 'personal',
    })
    expect(body.message).toContain('$19.00')
    expect(body.message).toContain('Contact support')
    expect(body.message).not.toContain('Upgrade')
  })
})
