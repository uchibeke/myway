import { describe, it, expect } from 'vitest'
import { ADMIN_TABS, getSortedAdminTabs } from '@/lib/admin-tabs'

describe('ADMIN_TABS', () => {
  it('has expected tabs', () => {
    const ids = ADMIN_TABS.map(t => t.id)
    expect(ids).toContain('users')
    expect(ids).toContain('usage')
    // System health lives in Settings — not duplicated here
    expect(ids).not.toContain('system')
  })

  it('each tab has required fields', () => {
    for (const tab of ADMIN_TABS) {
      expect(tab.id).toBeTruthy()
      expect(tab.label).toBeTruthy()
      expect(tab.icon).toBeTruthy()
      expect(typeof tab.order).toBe('number')
    }
  })

  it('has unique IDs', () => {
    const ids = ADMIN_TABS.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique order values', () => {
    const orders = ADMIN_TABS.map(t => t.order)
    expect(new Set(orders).size).toBe(orders.length)
  })
})

describe('getSortedAdminTabs', () => {
  it('returns tabs sorted by order ascending', () => {
    const sorted = getSortedAdminTabs()
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].order).toBeGreaterThan(sorted[i - 1].order)
    }
  })

  it('returns a copy (does not mutate original)', () => {
    const sorted = getSortedAdminTabs()
    sorted.push({ id: 'test', label: 'Test', icon: 'test', order: 999 })
    expect(ADMIN_TABS.length).toBeLessThan(sorted.length)
  })

  it('first tab is users', () => {
    expect(getSortedAdminTabs()[0].id).toBe('users')
  })
})
