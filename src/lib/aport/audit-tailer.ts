/**
 * AuditTailer — process-scoped singleton for live audit log monitoring.
 *
 * Architecture:
 *   - One setInterval per process (regardless of open SSE connections)
 *   - Reads only new bytes on each tick (efficient tail)
 *   - Upserts new events to SQLite for persistence
 *   - Emits 'event' on the built-in EventEmitter for SSE subscribers
 *   - Backfills the full existing log once on start()
 *
 * Singleton pattern:
 *   Stored on globalThis so that the same instance is shared across Next.js
 *   Turbopack/Webpack chunk boundaries. Without this, instrumentation.ts and
 *   stream/route.ts would each get their own EventEmitter and events would
 *   never reach SSE subscribers.
 *
 * SSE connections subscribe via auditTailer.on('event', handler).
 * N connected tabs = 0 extra file reads (all share the singleton).
 *
 * SERVER ONLY. Import only in Node.js runtime code.
 */

import EventEmitter from 'events'
import { createReadStream, existsSync, statSync } from 'fs'
import { createInterface } from 'readline'
import { parseAuditLine, type GuardrailEvent } from './audit-parser'

// ─── Types ────────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __myway_audit_tailer: AuditTailer | undefined
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Read all lines from a file starting at `fromByte`. */
async function readTailFrom(filePath: string, fromByte: number): Promise<string[]> {
  if (!existsSync(filePath)) return []
  const lines: string[] = []
  await new Promise<void>((resolve) => {
    const opts = fromByte > 0
      ? { start: fromByte, encoding: 'utf8' as const }
      : { encoding: 'utf8' as const }
    const rl = createInterface({ input: createReadStream(filePath, opts), crlfDelay: Infinity })
    rl.on('line',  (l) => { if (l.trim()) lines.push(l) })
    rl.on('close', resolve)
    rl.on('error', resolve)  // never crash the tailer on read errors
  })
  return lines
}

/** Persist a single event to the DB via the guardrail-events resource handler. */
function persistEvent(ev: GuardrailEvent): void {
  try {
    // Dynamic require avoids circular init-order issues.
    // Both modules are singletons so require() is cheap after first call.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDb } = require('@/lib/db') as { getDb: () => import('better-sqlite3').Database }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RESOURCE_REGISTRY } = require('@/lib/store/registry') as {
      RESOURCE_REGISTRY: Record<string, {
        create: (db: import('better-sqlite3').Database, body: Record<string, unknown>) => unknown
      }>
    }
    const db = getDb()
    RESOURCE_REGISTRY['guardrail-events'].create(db, {
      id:        ev.id,
      timestamp: ev.timestamp,
      tool:      ev.tool,
      allowed:   ev.allowed,
      policy:    ev.policy,
      code:      ev.code,
      context:   ev.context,
    })
  } catch (err) {
    // Log but never throw — a DB write failure must not crash the tailer
    process.stderr.write(`[aport-tailer] persist error: ${err}\n`)
  }
}

// ─── AuditTailer ─────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2000

class AuditTailer extends EventEmitter {
  private filePath   = ''
  private lastByte   = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private started    = false

  /**
   * Start the tailer. Safe to call multiple times — only starts once.
   *
   * 1. Sets lastByte to current file size (new writes only from here on).
   * 2. Kicks off async backfill of all existing log entries (idempotent upserts).
   * 3. Starts 2-second poll interval for ongoing tail.
   */
  start(filePath: string): void {
    if (this.started) return
    this.started  = true
    this.filePath = filePath

    // Mark current end so tail picks up only new writes
    this.lastByte = existsSync(filePath) ? statSync(filePath).size : 0

    // Backfill all existing entries in background (idempotent — ON CONFLICT DO UPDATE)
    this.backfill().catch((err) =>
      process.stderr.write(`[aport-tailer] backfill error: ${err}\n`),
    )

    this.timer = setInterval(() => { void this.tick() }, POLL_INTERVAL_MS)

    process.stderr.write(`[aport-tailer] started — watching ${filePath}\n`)
  }

  /** Stop polling (tests / graceful shutdown). */
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.started = false
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /** Read and upsert all lines already in the log. */
  private async backfill(): Promise<void> {
    const lines = await readTailFrom(this.filePath, 0)
    let count = 0
    for (const line of lines) {
      const ev = parseAuditLine(line)
      if (!ev) continue
      persistEvent(ev)
      count++
    }
    if (count > 0) {
      process.stderr.write(`[aport-tailer] backfilled ${count} events\n`)
    }
  }

  /** Poll tick — detect new bytes, parse, persist, broadcast. */
  private async tick(): Promise<void> {
    if (!existsSync(this.filePath)) return

    const currentSize = statSync(this.filePath).size
    if (currentSize <= this.lastByte) return

    const newLines = await readTailFrom(this.filePath, this.lastByte)
    this.lastByte = currentSize

    for (const line of newLines) {
      const ev = parseAuditLine(line)
      if (!ev) continue
      persistEvent(ev)
      this.emit('event', ev)
    }
  }
}

// ─── Process-scoped singleton (survives Next.js hot reloads + chunk isolation) ─

function getAuditTailer(): AuditTailer {
  if (!globalThis.__myway_audit_tailer) {
    globalThis.__myway_audit_tailer = new AuditTailer()
  }
  return globalThis.__myway_audit_tailer
}

/**
 * The process-scoped singleton.
 *
 * Stored on globalThis so that both instrumentation.ts (startup) and
 * stream/route.ts (SSE subscriptions) reference the exact same EventEmitter,
 * even across Next.js Turbopack/Webpack chunk boundaries.
 *
 * Usage:
 *   instrumentation.ts  → auditTailer.start(filePath)
 *   stream/route.ts     → auditTailer.on('event', handler)
 */
export const auditTailer = getAuditTailer()
