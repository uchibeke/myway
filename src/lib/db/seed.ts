/**
 * Seed — populates the DB from the app registry and default identity.
 *
 * Idempotent: uses INSERT OR IGNORE everywhere.
 * Run via: npm run db:init (which calls this after migrations)
 */

import type { Database } from 'better-sqlite3'
import { getAllApps } from '@/lib/apps'
import type { MywayApp } from '@/lib/apps'

// ─── Apps ────────────────────────────────────────────────────────────────────

export function seedApps(db: Database): void {
  const insertApp = db.prepare(`
    INSERT OR IGNORE INTO apps (id, name, storage_manifest)
    VALUES (@id, @name, @manifest)
  `)

  const insertSub = db.prepare(`
    INSERT OR IGNORE INTO app_subscriptions (id, app_id, subject_pattern, handler)
    VALUES (@id, @app_id, @subject_pattern, @handler)
  `)

  const apps = getAllApps()

  db.transaction(() => {
    for (const app of apps) {
      const manifest = buildManifest(app)
      insertApp.run({ id: app.id, name: app.name, manifest: JSON.stringify(manifest) })

      // Register subscriptions from storage manifest
      for (const pattern of manifest.subscribes ?? []) {
        insertSub.run({
          id: `${app.id}:${pattern}`,
          app_id: app.id,
          subject_pattern: pattern,
          handler: 'heartbeat',
        })
      }
    }
  })()

  console.log(`[db] seeded ${apps.length} apps`)
}

function buildManifest(app: MywayApp) {
  const { storage, interactionType } = app
  return {
    conversations: storage?.conversations ?? (interactionType === 'chat' || interactionType === 'transformer'),
    memory: storage?.memory ?? false,
    artifacts: storage?.artifacts ?? [],
    emits: storage?.emits ?? [],
    subscribes: storage?.subscribes ?? [],
  }
}

// ─── Identity ─────────────────────────────────────────────────────────────────

export function seedIdentity(db: Database): void {
  const upsert = db.prepare(`
    INSERT OR IGNORE INTO identity (key, value, updated_by)
    VALUES (@key, @value, 'seed')
  `)

  const defaults = [
    { key: 'user.name',     value: process.env.MYWAY_USER_NAME ?? 'User' },
    { key: 'user.timezone', value: process.env.MYWAY_TIMEZONE   ?? 'UTC' },
  ]

  db.transaction(() => {
    for (const row of defaults) upsert.run(row)
  })()

  console.log('[db] seeded identity defaults')
}
