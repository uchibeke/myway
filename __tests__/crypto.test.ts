import { describe, it, expect } from 'vitest'
import { encryptToken, decryptToken } from '@/lib/connections/crypto'

describe('Connection Crypto', () => {
  const secret = 'test-secret-for-unit-tests-only'

  it('encrypts and decrypts a simple token', () => {
    const token = 'ya29.a0AfH6SMB_some_oauth_token'
    const encrypted = encryptToken(token, secret)
    expect(encrypted).not.toBe(token)
    expect(decryptToken(encrypted, secret)).toBe(token)
  })

  it('encrypts and decrypts an empty string', () => {
    const encrypted = encryptToken('', secret)
    expect(decryptToken(encrypted, secret)).toBe('')
  })

  it('encrypts and decrypts unicode content', () => {
    const token = 'token-with-émojis-🔑-and-日本語'
    const encrypted = encryptToken(token, secret)
    expect(decryptToken(encrypted, secret)).toBe(token)
  })

  it('different secrets produce different ciphertext', () => {
    const token = 'same-token'
    const enc1 = encryptToken(token, 'secret-one')
    const enc2 = encryptToken(token, 'secret-two')
    expect(enc1).not.toBe(enc2)
  })

  it('decrypting with wrong secret throws', () => {
    const token = 'sensitive-data'
    const encrypted = encryptToken(token, 'correct-secret')
    expect(() => decryptToken(encrypted, 'wrong-secret')).toThrow()
  })

  it('same plaintext produces different ciphertext each time (random IV)', () => {
    const token = 'repeated-token'
    const enc1 = encryptToken(token, secret)
    const enc2 = encryptToken(token, secret)
    expect(enc1).not.toBe(enc2)
    // But both decrypt to the same value
    expect(decryptToken(enc1, secret)).toBe(token)
    expect(decryptToken(enc2, secret)).toBe(token)
  })

  it('base64 fallback works without secret', () => {
    // When no secret, encryptToken falls back to b64: prefix
    const token = 'dev-mode-token'
    const encrypted = encryptToken(token)
    expect(encrypted).toMatch(/^b64:/)
    expect(decryptToken(encrypted)).toBe(token)
  })
})
