import { describe, it, expect, vi, afterEach } from 'vitest'
import { decryptToken, encryptToken } from '@/lib/connections/crypto'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('decryptToken — edge cases', () => {
  it('throws when decrypting non-b64 token without secret and no env var', () => {
    // Simulate encrypted data that doesn't have b64: prefix, and no secret provided
    const secret = 'temp-secret'
    const encrypted = encryptToken('test-data', secret)

    // Remove MYWAY_SECRET from env
    const origEnv = process.env.MYWAY_SECRET
    delete process.env.MYWAY_SECRET

    try {
      expect(() => decryptToken(encrypted)).toThrow('Cannot decrypt token: MYWAY_SECRET not set')
    } finally {
      if (origEnv !== undefined) process.env.MYWAY_SECRET = origEnv
    }
  })

  it('throws on tampered ciphertext', () => {
    const secret = 'test-secret'
    const encrypted = encryptToken('sensitive', secret)

    // Tamper with the base64 data
    const tampered = encrypted.slice(0, -4) + 'XXXX'
    expect(() => decryptToken(tampered, secret)).toThrow()
  })

  it('handles long tokens', () => {
    const secret = 'long-token-secret'
    const longToken = 'x'.repeat(10000)
    const encrypted = encryptToken(longToken, secret)
    expect(decryptToken(encrypted, secret)).toBe(longToken)
  })

  it('handles special characters in tokens', () => {
    const secret = 'special-chars-secret'
    const token = 'token with\nnewlines\tand\ttabs and "quotes" and \'apostrophes\''
    const encrypted = encryptToken(token, secret)
    expect(decryptToken(encrypted, secret)).toBe(token)
  })
})
