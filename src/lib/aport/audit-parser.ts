/**
 * APort audit log parser.
 *
 * Supports two log line formats:
 *
 * v1.0.12+ (no decision_id — synthetic one is generated):
 *   [2026-03-02 09:38:24] tool=read allow=true policy=data.file.read.v1 code=oap.allowed context="..."
 *
 * Earlier versions (decision_id present):
 *   [2026-03-01 13:08:39] tool=exec decision_id=b014c7dc allow=true policy=system.command.execute.v1 code=oap.allowed context="ls -la"
 *
 * Handles:
 *   - Missing file (returns [])
 *   - Missing decision_id (generates stable synthetic id from timestamp+tool+context)
 *   - Malformed lines (skips + logs to stderr)
 *   - Context strings with internal quotes/spaces
 *   - Partial file reads (via fromByte option)
 *
 * SERVER ONLY.
 */

import { createHash } from 'crypto'
import { createReadStream, existsSync, statSync } from 'fs'
import { createInterface } from 'readline'

export type GuardrailEvent = {
  /** APort decision_id or stable synthetic id derived from line content */
  id: string
  /** Unix epoch seconds */
  timestamp: number
  /** Tool identifier e.g. "exec", "read", "write" */
  tool: string
  /** Whether the action was allowed */
  allowed: boolean
  /** Policy that evaluated this e.g. "system.command.execute.v1" */
  policy: string
  /** Result code e.g. "oap.allowed" | "oap.blocked_pattern" | "oap.denied" */
  code: string
  /** Raw context — truncated command or action description */
  context: string
}

// Matches: [YYYY-MM-DD HH:MM:SS]
const TIMESTAMP_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/

/**
 * Generate a stable synthetic decision_id for log lines that don't include one.
 *
 * Deterministic: same input → same id, so upserts are idempotent across multiple
 * reads of the same log file (e.g. backfill on startup + ongoing tail).
 */
function syntheticId(timestamp: number, tool: string, context: string): string {
  const hash = createHash('sha1')
    .update(`${timestamp}:${tool}:${context.slice(0, 64)}`)
    .digest('hex')
    .slice(0, 12)
  return `syn-${hash}`
}

/**
 * Parse a single audit log line. Returns null for malformed/empty lines.
 */
export function parseAuditLine(line: string): GuardrailEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  // Extract timestamp prefix
  const tsMatch = trimmed.match(TIMESTAMP_RE)
  if (!tsMatch) return null

  const timestamp = Math.floor(new Date(tsMatch[1] + 'Z').getTime() / 1000)
  if (isNaN(timestamp)) return null

  const rest = trimmed.slice(tsMatch[0].length).trim()

  // Extract key=value pairs — handles context="quoted value with spaces"
  const fields: Record<string, string> = {}
  const fieldRe = /(\w+)=(?:"((?:[^"\\]|\\.)*)"|(\S+))/g
  let match: RegExpExecArray | null
  let contextStart = -1

  while ((match = fieldRe.exec(rest)) !== null) {
    const key = match[1]
    const val = match[2] !== undefined ? match[2] : match[3]
    if (key === 'context') contextStart = match.index
    fields[key] = val
  }

  // Re-extract context verbatim from that position to end-of-line
  // (may contain internal quotes the regex won't capture cleanly)
  if (contextStart !== -1) {
    const raw = rest.slice(contextStart + 'context='.length)
    fields['context'] = raw.startsWith('"')
      ? raw.slice(1, raw.endsWith('"') ? -1 : undefined)
      : raw
  }

  const tool = fields['tool']
  if (!tool) return null

  const context = (fields['context'] ?? '').slice(0, 500)

  // Use real decision_id when present; fall back to stable synthetic id.
  // This ensures all guardrail versions are captured without data loss.
  const id = fields['decision_id'] ?? syntheticId(timestamp, tool, context)

  return {
    id,
    timestamp,
    tool,
    allowed: fields['allow'] !== 'false',
    policy:  fields['policy'] ?? '',
    code:    fields['code']   ?? '',
    context,
  }
}

export type ReadAuditLogOptions = {
  /** Maximum number of events to return (most recent first). Default: 200 */
  limit?: number
  /** Only return events after this decision_id (exclusive) — for cursor pagination */
  sinceId?: string
  /** Only include blocked events */
  blockedOnly?: boolean
  /** Start reading from this byte offset. Default: 0 (full file) */
  fromByte?: number
}

/**
 * Read and parse the audit log. Returns events newest-first.
 * Returns [] if the file doesn't exist.
 */
export async function readAuditLog(
  filePath: string,
  opts: ReadAuditLogOptions = {},
): Promise<GuardrailEvent[]> {
  if (!existsSync(filePath)) return []

  const { limit = 200, blockedOnly = false, fromByte = 0 } = opts
  const lines: string[] = []

  await new Promise<void>((resolve, reject) => {
    const streamOpts = fromByte > 0
      ? { start: fromByte, encoding: 'utf8' as const }
      : { encoding: 'utf8' as const }

    const rl = createInterface({
      input: createReadStream(filePath, streamOpts),
      crlfDelay: Infinity,
    })
    rl.on('line',  (l) => { if (l.trim()) lines.push(l) })
    rl.on('close', resolve)
    rl.on('error', reject)
  })

  const events: GuardrailEvent[] = []
  for (const line of lines) {
    try {
      const ev = parseAuditLine(line)
      if (!ev) continue
      if (blockedOnly && ev.allowed) continue
      events.push(ev)
    } catch {
      process.stderr.write(`[aport] malformed audit line: ${line.slice(0, 120)}\n`)
    }
  }

  // Newest first
  events.sort((a, b) => b.timestamp - a.timestamp)

  if (opts.sinceId) {
    const idx = events.findIndex((e) => e.id === opts.sinceId)
    if (idx !== -1) return events.slice(0, idx).slice(0, limit)
    return events.slice(0, limit)
  }

  return events.slice(0, limit)
}

/** Synchronous file size — used by the AuditTailer to detect new writes. */
export function getAuditLogSize(filePath: string): number {
  try {
    return existsSync(filePath) ? statSync(filePath).size : 0
  } catch {
    return 0
  }
}
