/**
 * DB Config — all paths and dimensions read from env, never hardcoded.
 *
 * MYWAY_DATA_DIR   Root for all persisted data (db, artifacts).
 *                   Default: ~/.myway/data
 *
 * MYWAY_DB_PATH    Override the full SQLite file path.
 *                   Default: $MYWAY_DATA_DIR/myway.db
 *
 * EMBEDDING_DIM     Float dimension for sqlite-vec tables.
 *                   Default: 768  (local models, nomic-embed-text, etc.)
 *                   Set to 1536  for OpenAI text-embedding-ada-002
 *                   Set to 3072  for OpenAI text-embedding-3-large
 *
 * Portable: copy this project to any machine, set env vars, run db:init.
 */

import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'

export const DATA_DIR: string =
  process.env.MYWAY_DATA_DIR ?? join(homedir(), '.myway', 'data')

export const DB_PATH: string =
  process.env.MYWAY_DB_PATH ?? join(DATA_DIR, 'myway.db')

export const ARTIFACTS_DIR: string = join(DATA_DIR, 'artifacts')

export const VOICES_DIR: string = join(DATA_DIR, 'voices')

export const EMBEDDING_DIM: number =
  parseInt(process.env.EMBEDDING_DIM ?? '768', 10)

/** Ensure all data directories exist. Idempotent. */
export function ensureDirs(): void {
  mkdirSync(DATA_DIR, { recursive: true })
  mkdirSync(ARTIFACTS_DIR, { recursive: true })
  mkdirSync(VOICES_DIR, { recursive: true })
}

// ── Tenant-aware helpers ──────────────────────────────────────────────────────

/** Get data directory for a tenant, or the default data dir if no userId. */
export function getDataDir(userId?: string): string {
  const base = process.env.MYWAY_DATA_DIR ?? join(homedir(), '.myway', 'data')
  return userId ? join(base, 'tenants', userId) : base
}

/** Get DB path for a tenant, or the default DB path if no userId. */
export function getDbPath(userId?: string): string {
  if (!userId) return process.env.MYWAY_DB_PATH ?? join(getDataDir(), 'myway.db')
  return join(getDataDir(userId), 'myway.db')
}

/** Ensure tenant data directories exist. Idempotent. */
export function ensureTenantDirs(userId?: string): void {
  const dir = getDataDir(userId)
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'artifacts'), { recursive: true })
  mkdirSync(join(dir, 'voices'), { recursive: true })
}
