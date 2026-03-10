import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPrepare = vi.fn()
const mockDb = { prepare: mockPrepare }

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => mockDb),
}))

import { requireAdmin, isSelfHosted } from '@/lib/admin-auth'

function mockReq(headers: Record<string, string> = {}): any {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  }
}

describe('isSelfHosted', () => {
  it('returns true when no x-myway-user-id header', () => {
    expect(isSelfHosted(mockReq())).toBe(true)
  })

  it('returns false when x-myway-user-id header is present', () => {
    expect(isSelfHosted(mockReq({ 'x-myway-user-id': 'oliver' }))).toBe(false)
  })
})

describe('requireAdmin', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns null (allow) for self-hosted — no user header', async () => {
    const result = await requireAdmin(mockReq())
    expect(result).toBeNull()
  })

  it('returns null (allow) when no MYWAY_ADMIN_EMAILS configured', async () => {
    delete process.env.MYWAY_ADMIN_EMAILS
    const result = await requireAdmin(mockReq({ 'x-myway-user-id': 'oliver' }))
    expect(result).toBeNull()
  })

  it('returns null (allow) when user email matches admin list', async () => {
    process.env.MYWAY_ADMIN_EMAILS = 'admin@test.com, oliver@test.com'
    mockPrepare.mockReturnValue({
      get: vi.fn(() => ({ value: 'oliver@test.com' })),
    })

    const result = await requireAdmin(mockReq({ 'x-myway-user-id': 'oliver' }))
    expect(result).toBeNull()
  })

  it('returns 403 when user email not in admin list', async () => {
    process.env.MYWAY_ADMIN_EMAILS = 'admin@test.com'
    mockPrepare.mockReturnValue({
      get: vi.fn(() => ({ value: 'notadmin@test.com' })),
    })

    const result = await requireAdmin(mockReq({ 'x-myway-user-id': 'oliver' }))
    expect(result).not.toBeNull()
    // NextResponse.json returns an object with status
    expect((result as any).status).toBe(403)
  })

  it('returns 403 when user_profile table is missing', async () => {
    process.env.MYWAY_ADMIN_EMAILS = 'admin@test.com'
    mockPrepare.mockImplementation(() => { throw new Error('no such table') })

    const result = await requireAdmin(mockReq({ 'x-myway-user-id': 'oliver' }))
    expect(result).not.toBeNull()
    expect((result as any).status).toBe(403)
  })

  it('is case-insensitive for email matching', async () => {
    process.env.MYWAY_ADMIN_EMAILS = 'Admin@Test.COM'
    mockPrepare.mockReturnValue({
      get: vi.fn(() => ({ value: 'admin@test.com' })),
    })

    const result = await requireAdmin(mockReq({ 'x-myway-user-id': 'oliver' }))
    expect(result).toBeNull()
  })
})
