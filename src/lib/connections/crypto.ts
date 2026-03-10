/**
 * Token encryption — AES-256-GCM for OAuth tokens at rest.
 *
 * Uses MYWAY_SECRET env var as key material (derived via scrypt).
 * Falls back to base64 encoding if no secret set (dev mode).
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

/**
 * Derive a per-instance salt from the secret itself.
 * This ensures different MYWAY_SECRET values produce different derived keys
 * even without a random salt (which would require separate storage).
 */
function deriveKey(secret: string): Buffer {
  const salt = createHash('sha256').update(`myway:${secret}`).digest().subarray(0, 16)
  return scryptSync(secret, salt, KEY_LEN)
}

function getSecret(): string | null {
  return process.env.MYWAY_SECRET ?? null
}

/**
 * Encrypt a token string. Returns base64-encoded (iv + ciphertext + authTag).
 * Falls back to base64 encoding if MYWAY_SECRET is not set.
 */
export function encryptToken(token: string, secret?: string): string {
  const key = secret ?? getSecret()
  if (!key) {
    console.warn('[connections] MYWAY_SECRET not set — tokens stored as base64 (dev mode)')
    return `b64:${Buffer.from(token, 'utf8').toString('base64')}`
  }

  const derived = deriveKey(key)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, derived, iv)

  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  // iv (12) + encrypted + tag (16)
  return Buffer.concat([iv, encrypted, tag]).toString('base64')
}

/**
 * Decrypt a token string. Handles both encrypted and base64-fallback formats.
 */
export function decryptToken(encrypted: string, secret?: string): string {
  // Handle base64 fallback (dev mode)
  if (encrypted.startsWith('b64:')) {
    return Buffer.from(encrypted.slice(4), 'base64').toString('utf8')
  }

  const key = secret ?? getSecret()
  if (!key) {
    throw new Error('Cannot decrypt token: MYWAY_SECRET not set')
  }

  const derived = deriveKey(key)
  const buf = Buffer.from(encrypted, 'base64')

  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(buf.length - TAG_LEN)
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN)

  const decipher = createDecipheriv(ALGO, derived, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
