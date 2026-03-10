/**
 * Tests for /api/admin/costs endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('fs', () => ({
  readdirSync: vi.fn(() => []),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}))

const mockPrepare = vi.fn()
const mockDb = { prepare: mockPrepare }
vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => mockDb) }))
vi.mock('@/lib/db/config', () => ({ DATA_DIR: '/tmp/test-data' }))
vi.mock('@/lib/admin-auth', () => ({
  requireAdmin: vi.fn(() => null), // null = authorized
  isSelfHosted: vi.fn(() => true),
}))

import { GET } from '@/app/api/admin/costs/route'
import { NextRequest } from 'next/server'

function createRequest(days = 30): NextRequest {
  return new NextRequest(new URL(`http://localhost/api/admin/costs?days=${days}`))
}

describe('GET /api/admin/costs', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: return empty results for all queries
    mockPrepare.mockReturnValue({
      get: vi.fn(() => ({ totalCostUsd: 0, totalTokens: 0, requestCount: 0 })),
      all: vi.fn(() => []),
    })
  })

  it('should return cost analytics with expected shape', async () => {
    const res = await GET(createRequest())
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toHaveProperty('totalCostUsd')
    expect(data).toHaveProperty('projectedMonthlyCost')
    expect(data).toHaveProperty('byModel')
    expect(data).toHaveProperty('dailyTrend')
    expect(data).toHaveProperty('topSpenders')
    expect(data.days).toBe(30)
  })

  it('should calculate projected monthly cost', async () => {
    // Simulate $10 total over 30 days = $10/month projected
    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('SUM(estimated_cost_usd)') && sql.includes('SUM(total_tokens)') && !sql.includes('created_at <')) {
        return { get: vi.fn(() => ({ totalCostUsd: 10, totalTokens: 100000, requestCount: 50 })) }
      }
      if (sql.includes('created_at <')) {
        return { get: vi.fn(() => ({ totalCostUsd: 8 })) }
      }
      return { all: vi.fn(() => []), get: vi.fn(() => null) }
    })

    const res = await GET(createRequest())
    const data = await res.json()

    expect(data.totalCostUsd).toBe(10)
    expect(data.projectedMonthlyCost).toBe(10) // 10/30 * 30
    expect(data.costChangePercent).toBe(25) // 10 vs 8 = +25%
  })

  it('should clamp days parameter to 1-365', async () => {
    const res = await GET(createRequest(0))
    const data = await res.json()
    expect(data.days).toBe(1)

    const res2 = await GET(createRequest(999))
    const data2 = await res2.json()
    expect(data2.days).toBe(365)
  })
})
