#!/usr/bin/env tsx
/**
 * db:status — Show database health, migration state, and content summary.
 */

import { getDb } from '@/lib/db'
import { DB_PATH } from '@/lib/db/config'

const db = getDb()

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  Myway DB Status')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`  Path: ${DB_PATH}\n`)

// ── Migrations ──────────────────────────────────────────────────────────────
const migrations = db.prepare(`
  SELECT version, applied_at FROM schema_migrations ORDER BY version
`).all() as { version: string; applied_at: number }[]

console.log('Migrations applied:')
if (migrations.length === 0) {
  console.log('  (none)')
} else {
  for (const m of migrations) {
    const date = new Date(m.applied_at * 1000).toISOString().replace('T', ' ').slice(0, 19)
    console.log(`  ✓  ${m.version.padEnd(20)} ${date} UTC`)
  }
}

// ── Table counts ────────────────────────────────────────────────────────────
const tables = [
  'apps',
  'conversations',
  'messages',
  'memories',
  'artifacts',
  'notifications',
  'tasks',
  'app_messages',
  'app_subscriptions',
  'personality_state',
  'identity',
]

console.log('\nTable counts:')
for (const table of tables) {
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }
  console.log(`  ${table.padEnd(26)} ${count}`)
}

// ── Notifications ────────────────────────────────────────────────────────────
let hasTables = true
try {
  const pending_notifs = db.prepare(
    `SELECT COUNT(*) as count FROM notifications WHERE status = 'pending'`
  ).get() as { count: number }
  const open_tasks = db.prepare(
    `SELECT COUNT(*) as count FROM tasks WHERE status = 'open' AND is_deleted = 0`
  ).get() as { count: number }
  console.log(`\nNotifications pending:   ${pending_notifs.count}`)
  console.log(`Tasks open:              ${open_tasks.count}`)
} catch {
  hasTables = false
}
void hasTables // suppress unused warning

// ── Pending bus messages ────────────────────────────────────────────────────
const pending = db.prepare(
  `SELECT COUNT(*) as count FROM app_messages WHERE status = 'pending'`
).get() as { count: number }
console.log(`\nBus — pending messages:  ${pending.count}`)

// ── Registered apps ─────────────────────────────────────────────────────────
const apps = db.prepare(
  `SELECT id, name FROM apps ORDER BY name`
).all() as { id: string; name: string }[]

console.log('\nRegistered apps:')
if (apps.length === 0) {
  console.log('  (none — run npm run db:init)')
} else {
  for (const app of apps) {
    console.log(`  ${app.id.padEnd(26)} ${app.name}`)
  }
}

// ── Subscriptions ───────────────────────────────────────────────────────────
const subs = db.prepare(`
  SELECT app_id, subject_pattern, handler FROM app_subscriptions ORDER BY app_id, subject_pattern
`).all() as { app_id: string; subject_pattern: string; handler: string }[]

if (subs.length > 0) {
  console.log('\nBus subscriptions:')
  for (const s of subs) {
    console.log(`  ${s.app_id.padEnd(24)} ${s.subject_pattern.padEnd(20)} [${s.handler}]`)
  }
}

// ── Identity ────────────────────────────────────────────────────────────────
const identity = db.prepare(
  `SELECT key, value FROM identity ORDER BY key`
).all() as { key: string; value: string }[]

console.log('\nIdentity:')
for (const row of identity) {
  console.log(`  ${row.key.padEnd(26)} ${row.value}`)
}

// ── Personality signals ─────────────────────────────────────────────────────
const signals = db.prepare(
  `SELECT key, value, confidence, updated_by FROM personality_state ORDER BY key`
).all() as { key: string; value: string; confidence: number; updated_by: string }[]

if (signals.length > 0) {
  console.log('\nPersonality signals:')
  for (const s of signals) {
    const conf = `${(s.confidence * 100).toFixed(0)}%`
    console.log(`  ${s.key.padEnd(26)} ${s.value.padEnd(20)} (${conf}, by ${s.updated_by})`)
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
