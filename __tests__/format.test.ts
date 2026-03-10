import { describe, it, expect } from 'vitest'
import { timeAgo, formatTokens, formatCost } from '@/lib/format'

describe('timeAgo', () => {
  it('returns "just now" for recent timestamps', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(timeAgo(now)).toBe('just now')
    expect(timeAgo(now - 30)).toBe('just now')
  })

  it('returns minutes for timestamps within the hour', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(timeAgo(now - 120)).toBe('2m ago')
    expect(timeAgo(now - 3000)).toBe('50m ago')
  })

  it('returns hours for timestamps within the day', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(timeAgo(now - 7200)).toBe('2h ago')
    expect(timeAgo(now - 43200)).toBe('12h ago')
  })

  it('returns days for older timestamps', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(timeAgo(now - 86400)).toBe('1d ago')
    expect(timeAgo(now - 604800)).toBe('7d ago')
  })
})

describe('formatTokens', () => {
  it('returns raw number for small counts', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(1)).toBe('1')
    expect(formatTokens(999)).toBe('999')
  })

  it('formats thousands with K suffix', () => {
    expect(formatTokens(1000)).toBe('1.0K')
    expect(formatTokens(1500)).toBe('1.5K')
    expect(formatTokens(10000)).toBe('10.0K')
    expect(formatTokens(999999)).toBe('1000.0K')
  })

  it('formats millions with M suffix', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M')
    expect(formatTokens(2_500_000)).toBe('2.5M')
    expect(formatTokens(100_000_000)).toBe('100.0M')
  })
})

describe('formatCost', () => {
  it('shows $0.00 for zero', () => {
    expect(formatCost(0)).toBe('$0.00')
  })

  it('shows 4 decimal places for sub-penny amounts', () => {
    expect(formatCost(0.0012)).toBe('$0.0012')
    expect(formatCost(0.0099)).toBe('$0.0099')
    expect(formatCost(0.001)).toBe('$0.0010')
  })

  it('shows 3 decimal places for sub-dollar amounts', () => {
    expect(formatCost(0.01)).toBe('$0.010')
    expect(formatCost(0.05)).toBe('$0.050')
    expect(formatCost(0.5)).toBe('$0.500')
    expect(formatCost(0.999)).toBe('$0.999')
  })

  it('shows 2 decimal places for dollar amounts', () => {
    expect(formatCost(1)).toBe('$1.00')
    expect(formatCost(1.5)).toBe('$1.50')
    expect(formatCost(99.99)).toBe('$99.99')
    expect(formatCost(1234.56)).toBe('$1234.56')
  })
})
