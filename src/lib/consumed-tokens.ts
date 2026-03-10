/**
 * Persistent consumed token store — survives process restarts.
 *
 * Uses a simple SQLite database (separate from tenant DBs) to track
 * consumed partner token signatures. This prevents replay attacks
 * even across process restarts.
 *
 * Location: $MYWAY_DATA_DIR/auth-state.db
 *
 * Auto-cleans entries older than 5 minutes (token TTL).
 */

import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import type { Database as DB } from 'better-sqlite3'

const TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes (matches partner token expiry)

let _db: DB | null = null

function getDb(): DB {
  if (_db) return _db

  const dataDir = process.env.MYWAY_DATA_DIR ?? join(homedir(), '.myway', 'data')
  mkdirSync(dataDir, { recursive: true })

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  _db = new Database(join(dataDir, 'auth-state.db')) as DB

  _db.pragma('journal_mode = WAL')
  _db.pragma('synchronous = NORMAL')

  _db.exec(`
    CREATE TABLE IF NOT EXISTS consumed_tokens (
      sig        TEXT PRIMARY KEY,
      consumed_at INTEGER NOT NULL
    )
  `)

  return _db
}

/** Check if a token signature has already been consumed. */
export function isTokenConsumed(sig: string): boolean {
  const db = getDb()
  const row = db.prepare('SELECT 1 FROM consumed_tokens WHERE sig = ?').get(sig)
  return !!row
}

/** Mark a token signature as consumed. Also cleans up expired entries. */
export function consumeToken(sig: string): void {
  const db = getDb()
  const now = Date.now()

  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO consumed_tokens (sig, consumed_at) VALUES (?, ?)').run(sig, now)
    // Clean up expired entries
    db.prepare('DELETE FROM consumed_tokens WHERE consumed_at < ?').run(now - TOKEN_TTL_MS)
  })()
}
