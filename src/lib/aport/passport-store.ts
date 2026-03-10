/**
 * DB-backed passport storage — CRUD for user_passports table.
 *
 * API keys are encrypted at rest using AES-256-GCM with a key derived
 * from MYWAY_SECRET via HKDF. Each row gets a unique IV.
 *
 * Resolution chain (used by getPassportForApp):
 *   1. DB passport for requested app_id
 *   2. DB passport for 'default'
 *   3. null (caller falls back to local file / env vars)
 *
 * SERVER ONLY.
 */

import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'crypto'
import type { Database } from 'better-sqlite3'

// ─── Types ──────────────────────────────────────────────────────────────────

export type UserPassport = {
  id: number
  appId: string
  agentId: string
  label: string | null
  createdAt: number
  updatedAt: number
}

type PassportRow = {
  id: number
  app_id: string
  agent_id: string
  api_key_enc: string | null
  label: string | null
  created_at: number
  updated_at: number
}

// ─── Encryption ─────────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const secret = process.env.MYWAY_SECRET
  if (!secret) throw new Error('MYWAY_SECRET is required for passport encryption')
  return Buffer.from(
    hkdfSync('sha256', secret, 'myway-passport-keys', '', 32),
  )
}

/**
 * Encrypt an API key. Stored format: base64(iv:ciphertext:authTag)
 */
export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const combined = Buffer.concat([iv, encrypted, authTag])
  return combined.toString('base64')
}

/**
 * Decrypt an API key from the stored base64 format.
 */
export function decryptApiKey(stored: string): string {
  const key = getEncryptionKey()
  const combined = Buffer.from(stored, 'base64')
  const iv = combined.subarray(0, 12)
  const authTag = combined.subarray(combined.length - 16)
  const ciphertext = combined.subarray(12, combined.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(ciphertext) + decipher.final('utf8')
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

/**
 * List all passports for a user (never returns API keys).
 */
export function listPassports(db: Database): UserPassport[] {
  const rows = db.prepare(
    `SELECT id, app_id, agent_id, label, created_at, updated_at FROM user_passports ORDER BY app_id`,
  ).all() as PassportRow[]

  return rows.map(rowToPassport)
}

/**
 * Get the passport for a specific app scope. Falls back to 'default'.
 * Returns null if no passport exists.
 */
export function getPassportForApp(db: Database, appId: string): UserPassport | null {
  const row = db.prepare(
    `SELECT id, app_id, agent_id, label, created_at, updated_at FROM user_passports WHERE app_id = ?`,
  ).get(appId) as PassportRow | undefined

  if (row) return rowToPassport(row)

  if (appId !== 'default') {
    const defaultRow = db.prepare(
      `SELECT id, app_id, agent_id, label, created_at, updated_at FROM user_passports WHERE app_id = 'default'`,
    ).get() as PassportRow | undefined
    if (defaultRow) return rowToPassport(defaultRow)
  }

  return null
}

/**
 * Get the decrypted API key for a passport entry.
 * Returns null if the passport doesn't exist.
 * The apiKey field may be null if no key was stored.
 */
export function getPassportApiKey(db: Database, appId: string): { agentId: string; apiKey: string | null } | null {
  const row = db.prepare(
    `SELECT agent_id, api_key_enc FROM user_passports WHERE app_id = ?`,
  ).get(appId) as Pick<PassportRow, 'agent_id' | 'api_key_enc'> | undefined

  if (!row) {
    if (appId !== 'default') {
      return getPassportApiKey(db, 'default')
    }
    return null
  }

  return {
    agentId: row.agent_id,
    apiKey: row.api_key_enc ? decryptApiKey(row.api_key_enc) : null,
  }
}

/**
 * Upsert a passport entry. Encrypts the API key before storing (if provided).
 */
export function savePassport(
  db: Database,
  opts: { appId: string; agentId: string; apiKey?: string; label?: string },
): UserPassport {
  const encrypted = opts.apiKey ? encryptApiKey(opts.apiKey) : null
  const now = Math.floor(Date.now() / 1000)

  if (encrypted) {
    db.prepare(`
      INSERT INTO user_passports (app_id, agent_id, api_key_enc, label, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(app_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        api_key_enc = excluded.api_key_enc,
        label = excluded.label,
        updated_at = excluded.updated_at
    `).run(opts.appId, opts.agentId, encrypted, opts.label ?? null, now, now)
  } else {
    // Save without changing api_key_enc (or set null if new entry)
    db.prepare(`
      INSERT INTO user_passports (app_id, agent_id, api_key_enc, label, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?)
      ON CONFLICT(app_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        label = excluded.label,
        updated_at = excluded.updated_at
    `).run(opts.appId, opts.agentId, opts.label ?? null, now, now)
  }

  return {
    id: 0,
    appId: opts.appId,
    agentId: opts.agentId,
    label: opts.label ?? null,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Delete a passport entry by app_id.
 */
export function deletePassport(db: Database, appId: string): boolean {
  const result = db.prepare(`DELETE FROM user_passports WHERE app_id = ?`).run(appId)
  return result.changes > 0
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowToPassport(row: PassportRow): UserPassport {
  return {
    id: row.id,
    appId: row.app_id,
    agentId: row.agent_id,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
