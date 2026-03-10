/**
 * Migration runner — applies SQL migration files in order.
 * Idempotent: tracks applied versions in schema_migrations table.
 * All migrations use IF NOT EXISTS, so re-running is always safe.
 *
 * __dirname is NOT used because it points to .next/server/ in the Next.js runtime,
 * not to the source directory. We resolve the migrations directory from process.cwd()
 * (project root in both dev and production) with a fallback to __dirname (tsx scripts).
 */

import type { Database } from 'better-sqlite3'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

function findMigrationsDir(): string | null {
  const candidates = [
    // Next.js dev/prod: process.cwd() = project root
    join(process.cwd(), 'src', 'lib', 'db', 'migrations'),
    // tsx script mode: __dirname = src/lib/db
    join(__dirname, 'migrations'),
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return null
}

export function runMigrations(db: Database): void {
  // Ensure the migrations tracking table exists first
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT    PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  const migrationsDir = findMigrationsDir()
  if (!migrationsDir) {
    // Migrations directory not accessible — DB was already initialised via db:init.
    // Safe to skip: all CREATE TABLE IF NOT EXISTS statements are idempotent anyway.
    return
  }

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[])
      .map((r) => r.version)
  )

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort() // lexicographic order: 001_, 002_, etc.

  for (const file of files) {
    const version = file.replace('.sql', '')
    if (applied.has(version)) continue

    const sql = readFileSync(join(migrationsDir, file), 'utf8')

    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version)
    })()

    console.log(`[db] applied migration: ${file}`)
  }
}
