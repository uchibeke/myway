#!/usr/bin/env tsx
/**
 * db:init — Full database bootstrap.
 *
 * Run once after clone, or any time to re-sync app registrations.
 * Safe to run multiple times (fully idempotent).
 *
 * What it does:
 *   1. Ensures data directories exist         (config.ts → ensureDirs)
 *   2. Opens (or creates) the SQLite file     (~/.myway/data/myway.db by default)
 *   3. Loads sqlite-vec extension             (vector search; degrades gracefully)
 *   4. Applies pending migrations             (src/lib/db/migrations/*.sql)
 *   5. Seeds apps from the registry           (src/lib/apps.ts → getAllApps)
 *   6. Seeds default identity values          (MYWAY_USER_NAME, MYWAY_TIMEZONE env)
 *
 * Override data location:
 *   MYWAY_DATA_DIR=/custom/path npm run db:init
 */

import { getDb } from '@/lib/db'
import { seedApps, seedIdentity } from '@/lib/db/seed'
import { DB_PATH } from '@/lib/db/config'

console.log('[db:init] Initializing Myway database...')
console.log(`[db:init] Path: ${DB_PATH}\n`)

const db = getDb()

seedApps(db)
seedIdentity(db)

// Report applied migrations
const migrations = db.prepare(`
  SELECT version, applied_at FROM schema_migrations ORDER BY version
`).all() as { version: string; applied_at: number }[]

console.log('\n[db:init] Applied migrations:')
for (const m of migrations) {
  const date = new Date(m.applied_at * 1000).toISOString().replace('T', ' ').slice(0, 19)
  console.log(`  ✓  ${m.version}  (${date} UTC)`)
}

// Quick sanity: app count
const { count } = db.prepare('SELECT COUNT(*) as count FROM apps').get() as { count: number }
console.log(`\n[db:init] ${count} app(s) registered.`)
console.log('[db:init] Done. Database is ready.\n')
