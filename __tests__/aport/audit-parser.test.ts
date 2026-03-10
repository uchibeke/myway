import { describe, it, expect } from 'vitest'
import { parseAuditLine } from '@/lib/aport/audit-parser'

describe('parseAuditLine', () => {
  it('parses a valid audit log line', () => {
    const line = '[2026-03-01 13:08:39] tool=system.command.execute decision_id=b014c7dc allow=true policy=system.command.execute.v1 code=oap.allowed context="ls -la /root"'
    const ev = parseAuditLine(line)

    expect(ev).not.toBeNull()
    expect(ev?.id).toBe('b014c7dc')
    expect(ev?.tool).toBe('system.command.execute')
    expect(ev?.allowed).toBe(true)
    expect(ev?.policy).toBe('system.command.execute.v1')
    expect(ev?.code).toBe('oap.allowed')
    expect(ev?.context).toBe('ls -la /root')
    expect(typeof ev?.timestamp).toBe('number')
  })

  it('parses allow=false correctly', () => {
    const line = '[2026-03-01 13:08:39] tool=system.command.execute decision_id=blocked123 allow=false policy=system.command.execute.v1 code=oap.denied context="rm -rf /"'
    const ev = parseAuditLine(line)

    expect(ev?.allowed).toBe(false)
    expect(ev?.code).toBe('oap.denied')
  })

  it('handles context with internal quotes and spaces', () => {
    const line = '[2026-03-01 13:08:39] tool=system.command.execute decision_id=id1 allow=true policy=p1 code=c1 context="git commit -m \\"feat: add guardrails\\""'
    const ev = parseAuditLine(line)

    expect(ev).not.toBeNull()
    expect(ev?.context).toContain('feat: add guardrails')
  })

  it('returns null for malformed lines', () => {
    expect(parseAuditLine('')).toBeNull()
    expect(parseAuditLine('no timestamp here')).toBeNull()
    expect(parseAuditLine('[invalid date] tool=foo decision_id=bar')).toBeNull()
  })

  it('returns null for lines missing required fields', () => {
    const line = '[2026-03-01 13:08:39] allow=true policy=foo code=bar'
    expect(parseAuditLine(line)).toBeNull()
  })

  it('caps context at 500 chars', () => {
    const longContext = 'a'.repeat(600)
    const line = `[2026-03-01 13:08:39] tool=test decision_id=id1 allow=true policy=p1 code=c1 context="${longContext}"`
    const ev = parseAuditLine(line)

    expect(ev?.context.length).toBe(500)
  })

  it('converts ISO timestamp to unix epoch seconds', () => {
    const line = '[2026-03-01 13:08:39] tool=test decision_id=id1 allow=true policy=p1 code=c1 context="test"'
    const ev = parseAuditLine(line)

    expect(typeof ev?.timestamp).toBe('number')
    expect(ev?.timestamp).toBeGreaterThan(0)
    // 2026-03-01T13:08:39Z should be roughly 1772354919
    expect(ev?.timestamp).toBeGreaterThan(1700000000) // sanity check
  })
})
