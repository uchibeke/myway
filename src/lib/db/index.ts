/**
 * DB Singleton — one connection per process.
 *
 * In development, stored on globalThis to survive Next.js hot reloads.
 * In production (PM2 fork mode = one process), a module-level singleton is fine.
 *
 * On every boot:
 *  1. Ensures data directories exist
 *  2. Opens (or creates) the SQLite file
 *  3. Loads sqlite-vec extension for vector search
 *  4. Sets performance PRAGMAs (WAL, 64MB cache, mmap)
 *  5. Runs pending migrations (idempotent)
 *  6. Creates vec tables if they don't exist (dimension from EMBEDDING_DIM)
 */

import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'
import { DB_PATH, EMBEDDING_DIM, ensureDirs, getDbPath, ensureTenantDirs } from './config'
import { runMigrations } from './migrate'

// Extend globalThis for dev hot-reload survival
declare global {
  // eslint-disable-next-line no-var
  var __myway_db: DB | undefined
}

function createDb(userId?: string): DB {
  if (userId) {
    ensureTenantDirs(userId)
  } else {
    ensureDirs()
  }

  const dbPath = userId ? getDbPath(userId) : DB_PATH

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db: DB = new (require('better-sqlite3'))(dbPath) as DB

  // Load sqlite-vec for vector similarity search
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require('sqlite-vec') as { load: (db: DB) => void }
    sqliteVec.load(db)
  } catch {
    console.warn('[db] sqlite-vec not available — vector search disabled')
  }

  // ── PRAGMAs ────────────────────────────────────────────────────────────────
  // WAL: concurrent reads + writes without locking
  db.pragma('journal_mode = WAL')
  // NORMAL sync: safe on most hardware (full = safe on ALL hardware but slower)
  db.pragma('synchronous = NORMAL')
  // Enforce foreign key constraints
  db.pragma('foreign_keys = ON')
  // 64 MB page cache (negative = kibibytes)
  db.pragma('cache_size = -65536')
  // Temp tables in memory
  db.pragma('temp_store = MEMORY')
  // Memory-mapped I/O: 512 MB — eliminates syscall overhead on reads
  db.pragma('mmap_size = 536870912')

  // ── Migrations ─────────────────────────────────────────────────────────────
  runMigrations(db)

  // ── Vec tables ─────────────────────────────────────────────────────────────
  // Created separately because they need a runtime-configurable dimension.
  // IF NOT EXISTS makes this idempotent (safe to call on every boot).
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_messages USING vec0(
        message_id TEXT KEY,
        embedding  float[${EMBEDDING_DIM}]
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
        memory_id TEXT KEY,
        embedding float[${EMBEDDING_DIM}]
      );
    `)
  } catch {
    // sqlite-vec not loaded — vec tables won't exist, vector search degrades gracefully
  }

  return db
}

// ── Tenant LRU cache ──────────────────────────────────────────────────────────

const tenantCache = new Map<string, { db: DB; lastAccess: number }>()
const MAX_TENANTS = 50

export function getDb(userId?: string): DB {
  // No userId → current singleton behavior (self-hosted, unchanged)
  if (!userId) {
    if (process.env.NODE_ENV === 'production') {
      if (!module_db) module_db = createDb()
      return module_db
    }
    if (!global.__myway_db) global.__myway_db = createDb()
    return global.__myway_db
  }

  // Tenant mode → LRU cache
  const cached = tenantCache.get(userId)
  if (cached) {
    cached.lastAccess = Date.now()
    return cached.db
  }

  // Evict oldest if at capacity
  if (tenantCache.size >= MAX_TENANTS) {
    let oldest = ''
    let oldestTime = Infinity
    for (const [k, v] of tenantCache) {
      if (v.lastAccess < oldestTime) {
        oldest = k
        oldestTime = v.lastAccess
      }
    }
    try {
      const evicted = tenantCache.get(oldest)?.db
      if (evicted) {
        evicted.pragma('wal_checkpoint(RESTART)')
        evicted.close()
      }
    } catch (err) {
      console.error(`[db] failed to close tenant DB ${oldest}:`, err)
    }
    tenantCache.delete(oldest)
  }

  const db = createDb(userId)
  tenantCache.set(userId, { db, lastAccess: Date.now() })
  return db
}

// Production singleton
let module_db: DB | undefined
