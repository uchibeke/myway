/**
 * Tests for DB-backed passport storage + encryption.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  encryptApiKey,
  decryptApiKey,
  listPassports,
  getPassportForApp,
  getPassportApiKey,
  savePassport,
  deletePassport,
} from '@/lib/aport/passport-store'

// Need MYWAY_SECRET for encryption
const TEST_SECRET = 'test-secret-for-passport-encryption-32bytes!'

let db: Database.Database

beforeEach(() => {
  process.env.MYWAY_SECRET = TEST_SECRET
  db = new Database(':memory:')
  const sql = readFileSync(
    join(__dirname, '../src/lib/db/migrations/019_user_passports.sql'),
    'utf8',
  )
  db.exec(sql)
})

afterEach(() => {
  db.close()
  delete process.env.MYWAY_SECRET
})

describe('encryption', () => {
  it('encrypts and decrypts API key', () => {
    const key = 'aport_key_abc123xyz'
    const encrypted = encryptApiKey(key)
    expect(encrypted).not.toBe(key)
    expect(encrypted).not.toContain(key)
    expect(decryptApiKey(encrypted)).toBe(key)
  })

  it('produces different ciphertext for same plaintext (unique IV)', () => {
    const key = 'aport_key_same'
    const a = encryptApiKey(key)
    const b = encryptApiKey(key)
    expect(a).not.toBe(b) // Different IVs
    expect(decryptApiKey(a)).toBe(key)
    expect(decryptApiKey(b)).toBe(key)
  })

  it('throws without MYWAY_SECRET', () => {
    delete process.env.MYWAY_SECRET
    expect(() => encryptApiKey('test')).toThrow('MYWAY_SECRET')
  })
})

describe('CRUD operations', () => {
  it('saves and lists passports', () => {
    savePassport(db, { appId: 'default', agentId: 'ap_test1', apiKey: 'key1', label: 'Main' })
    savePassport(db, { appId: 'chat', agentId: 'ap_test2', apiKey: 'key2' })

    const list = listPassports(db)
    expect(list).toHaveLength(2)
    expect(list[0].appId).toBe('chat') // Sorted by app_id
    expect(list[1].appId).toBe('default')
    expect(list[1].agentId).toBe('ap_test1')
    expect(list[1].label).toBe('Main')
    // API keys must NOT be in the list response
    expect((list[0] as Record<string, unknown>).apiKey).toBeUndefined()
    expect((list[0] as Record<string, unknown>).api_key_enc).toBeUndefined()
  })

  it('upserts on conflict', () => {
    savePassport(db, { appId: 'default', agentId: 'ap_v1', apiKey: 'key_v1' })
    savePassport(db, { appId: 'default', agentId: 'ap_v2', apiKey: 'key_v2', label: 'Updated' })

    const list = listPassports(db)
    expect(list).toHaveLength(1)
    expect(list[0].agentId).toBe('ap_v2')
    expect(list[0].label).toBe('Updated')
  })

  it('retrieves decrypted API key', () => {
    savePassport(db, { appId: 'default', agentId: 'ap_test', apiKey: 'my_secret_key' })

    const creds = getPassportApiKey(db, 'default')
    expect(creds).not.toBeNull()
    expect(creds!.agentId).toBe('ap_test')
    expect(creds!.apiKey).toBe('my_secret_key')
  })

  it('saves passport without API key', () => {
    savePassport(db, { appId: 'default', agentId: 'ap_nokey' })

    const list = listPassports(db)
    expect(list).toHaveLength(1)
    expect(list[0].agentId).toBe('ap_nokey')

    const creds = getPassportApiKey(db, 'default')
    expect(creds).not.toBeNull()
    expect(creds!.agentId).toBe('ap_nokey')
    expect(creds!.apiKey).toBeNull()
  })

  it('falls back to default when app-specific not found', () => {
    savePassport(db, { appId: 'default', agentId: 'ap_default', apiKey: 'key_default' })

    const result = getPassportForApp(db, 'forge')
    expect(result).not.toBeNull()
    expect(result!.appId).toBe('default')
    expect(result!.agentId).toBe('ap_default')

    const creds = getPassportApiKey(db, 'forge')
    expect(creds).not.toBeNull()
    expect(creds!.agentId).toBe('ap_default')
  })

  it('returns app-specific passport over default', () => {
    savePassport(db, { appId: 'default', agentId: 'ap_default', apiKey: 'key_default' })
    savePassport(db, { appId: 'forge', agentId: 'ap_forge', apiKey: 'key_forge' })

    const result = getPassportForApp(db, 'forge')
    expect(result!.agentId).toBe('ap_forge')
  })

  it('returns null when no passports exist', () => {
    expect(getPassportForApp(db, 'default')).toBeNull()
    expect(getPassportApiKey(db, 'default')).toBeNull()
  })

  it('deletes passport', () => {
    savePassport(db, { appId: 'default', agentId: 'ap_test', apiKey: 'key' })
    expect(listPassports(db)).toHaveLength(1)

    const deleted = deletePassport(db, 'default')
    expect(deleted).toBe(true)
    expect(listPassports(db)).toHaveLength(0)
  })

  it('returns false when deleting non-existent passport', () => {
    expect(deletePassport(db, 'nonexistent')).toBe(false)
  })
})
