/**
 * Personality state — shared, mutable signals about the user.
 *
 * Any app can read or write. This is how apps build a coherent model of
 * the user without duplicating inference:
 *
 *   Ember writes:        'user.mood'          = 'burnt_out'   (confidence 0.8)
 *   Morning Brief reads:    'user.mood'          → skips motivational content
 *   Compliment Avalanche:   'user.last_shipped'  → fires celebration message
 *   Chat reads:             'user.streak_days'   → surfaces in greeting
 *
 * Keys use 'domain.signal' convention: 'user.mood', 'user.streak_days',
 * 'user.last_shipped', 'recipe.last_saved', etc.
 *
 * Confidence: 0.0–1.0.
 *   1.0 = directly observed (user said it)
 *   0.7 = strongly inferred
 *   0.4 = weakly inferred / stale
 * Callers are responsible for setting lower confidence for older signals.
 */

import type { Database } from 'better-sqlite3'

export interface PersonalitySignal {
  key: string
  value: string
  confidence: number
  updatedBy: string
  updatedAt: number
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export function getSignal(db: Database, key: string): PersonalitySignal | null {
  const row = db.prepare(`
    SELECT key, value, confidence, updated_by, updated_at
    FROM personality_state WHERE key = ?
  `).get(key) as RawSignal | undefined

  return row ? toSignal(row) : null
}

/** Get just the value string, or null if not set. */
export function getValue(db: Database, key: string): string | null {
  return getSignal(db, key)?.value ?? null
}

/** All signals, optionally filtered by key prefix (e.g. 'user.'). */
export function getAllSignals(db: Database, prefix?: string): PersonalitySignal[] {
  const rows = prefix
    ? (db.prepare(`
        SELECT key, value, confidence, updated_by, updated_at
        FROM personality_state WHERE key LIKE ?
        ORDER BY updated_at DESC
      `).all(`${prefix}%`) as RawSignal[])
    : (db.prepare(`
        SELECT key, value, confidence, updated_by, updated_at
        FROM personality_state ORDER BY updated_at DESC
      `).all() as RawSignal[])

  return rows.map(toSignal)
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export function setSignal(
  db: Database,
  key: string,
  value: string,
  updatedBy: string,
  confidence = 1.0,
): void {
  db.prepare(`
    INSERT INTO personality_state (key, value, confidence, updated_by, updated_at)
    VALUES (@key, @value, @confidence, @updatedBy, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value      = excluded.value,
      confidence = excluded.confidence,
      updated_by = excluded.updated_by,
      updated_at = unixepoch()
  `).run({ key, value, confidence, updatedBy })
}

/** Bulk upsert — single transaction for efficiency. */
export function setSignals(
  db: Database,
  entries: { key: string; value: string; confidence?: number }[],
  updatedBy: string,
): void {
  const stmt = db.prepare(`
    INSERT INTO personality_state (key, value, confidence, updated_by, updated_at)
    VALUES (@key, @value, @confidence, @updatedBy, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value      = excluded.value,
      confidence = excluded.confidence,
      updated_by = excluded.updated_by,
      updated_at = unixepoch()
  `)

  db.transaction(() => {
    for (const e of entries) {
      stmt.run({ key: e.key, value: e.value, confidence: e.confidence ?? 1.0, updatedBy })
    }
  })()
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface RawSignal {
  key: string
  value: string
  confidence: number
  updated_by: string
  updated_at: number
}

function toSignal(r: RawSignal): PersonalitySignal {
  return {
    key: r.key,
    value: r.value,
    confidence: r.confidence,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  }
}
