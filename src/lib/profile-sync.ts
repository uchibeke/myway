/**
 * profile-sync — unified read/write layer for workspace profiles.
 *
 * ONE pattern for syncing between OpenClaw workspace files and DB tables:
 *
 *   | Profile Type | DB Table     | OpenClaw File  | What it is              |
 *   |-------------|-------------|----------------|------------------------|
 *   | user        | user_profile | USER.md        | Who the human is       |
 *   | ai          | ai_profile   | IDENTITY.md    | Who the AI agent is    |
 *
 * Merge strategy (on every read):
 *   1. Read DB table → Map<key, value>
 *   2. Parse OpenClaw file → Map<key, value>
 *   3. Merge: DB wins per-key, file fills gaps
 *   4. Return merged map
 *
 * Write: goes to DB, and syncs back to OpenClaw file if it exists.
 *
 * Key naming convention:
 *   - Top-level fields: "name", "email", "timezone"
 *   - Section fields:   "spouse.email", "spouse.birthday"
 *   - Section subtitle: "spouse._subtitle" (e.g. "Jennifer")
 *   - Section text:     "founded._text" (plain text, no key-value)
 *
 * SERVER ONLY — never import from 'use client' components.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type { Database } from 'better-sqlite3'
import { isTenantUser } from '@/lib/hosted-storage'

const WORKSPACE = join(homedir(), '.openclaw', 'workspace')

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Convert a snake_case key to a display label: "call_them" → "Call them" */
export function labelFromKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

/** Reserved key suffixes for section metadata (not displayed as regular fields). */
const SECTION_META_SUFFIXES = ['_subtitle', '_text'] as const

function isSectionMeta(subKey: string): boolean {
  return (SECTION_META_SUFFIXES as readonly string[]).includes(subKey)
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export type ProfileType = 'user' | 'ai'

interface ProfileDef {
  table: string
  file: string
  /** Human-readable label for the context block heading */
  heading: string
}

const PROFILES: Record<ProfileType, ProfileDef> = {
  user: {
    table: 'user_profile',
    file: 'USER.md',
    heading: 'User Profile',
  },
  ai: {
    table: 'ai_profile',
    file: 'IDENTITY.md',
    heading: 'AI Identity',
  },
}

// ─── Placeholder detection ──────────────────────────────────────────────────

/**
 * Returns true if the value looks like a template placeholder rather than real data.
 *
 * Catches patterns like:
 *   - `_(optional)_`, `_(your name)_` — markdown italic placeholders
 *   - `[your name]`, `<name>` — bracketed placeholders
 *   - `...`, `…` — ellipsis placeholders
 *   - `TBD`, `N/A`, `TODO` — common placeholder tokens
 */
function isPlaceholder(value: string): boolean {
  const v = value.trim()
  if (!v) return true
  // Markdown italic placeholder: _(...)_ or _..._
  if (/^_\(.+\)_$/.test(v) || /^_[^_]+_$/.test(v)) return true
  // Bracketed: [your name], <name>
  if (/^\[.+\]$/.test(v) || /^<.+>$/.test(v)) return true
  // Ellipsis
  if (/^\.{2,}$/.test(v) || v === '…') return true
  // Common filler tokens (case-insensitive, exact match)
  if (/^(tbd|n\/a|todo|none|placeholder|example|untitled)$/i.test(v)) return true
  return false
}

/**
 * Returns true if a heading looks like a file-name descriptor, not a real name.
 * e.g. "IDENTITY.md - Who Am I?" or "USER.md — About You"
 */
function isTemplateHeading(heading: string): boolean {
  // Contains a .md file extension
  if (/\.md\b/i.test(heading)) return true
  // Generic template headings
  if (/^(who am i|about you|your profile|user profile|ai identity)\??$/i.test(heading.replace(/[—–\-]/g, '').trim())) return true
  return false
}

// ─── File parser (generic — works for USER.md and IDENTITY.md) ───────────────

/**
 * Parse an OpenClaw markdown file into a flat Map<string, string>.
 *
 * Handles:
 *   - `## Heading` → key "name" (display name)
 *   - `- **Key:** Value` → normalised key (lowercase, underscored)
 *   - `### Section — Subtitle` → prefixed keys: "section.key", "section._subtitle"
 *   - Plain text under a section → "section._text"
 *   - `### Notes\n- text` → "notes._text"
 *   - "Call them" / "What to call them" fields override "name"
 *
 * Skips template placeholder values (e.g. `_(optional)_`, `[your name]`).
 */
export function parseMdProfile(content: string): Map<string, string> {
  const map = new Map<string, string>()
  const lines = content.split('\n')

  // Extract display name from top heading (skip template headings)
  const headingMatch = content.match(/^##?\s+(.+)$/m)
  if (headingMatch?.[1]?.trim() && !isTemplateHeading(headingMatch[1].trim())) {
    map.set('name', headingMatch[1].trim())
  }

  let sectionPrefix = ''
  const textBuffer: string[] = []

  function flushText() {
    if (textBuffer.length > 0 && sectionPrefix) {
      const text = textBuffer.join('\n').trim()
      if (text) map.set(sectionPrefix + '_text', text)
      textBuffer.length = 0
    }
  }

  for (const line of lines) {
    // Skip top-level heading (already extracted)
    if (/^##?\s+/.test(line) && !line.startsWith('###')) continue

    // Section header: ### Spouse — Jennifer  or  ### Founded
    const sectionMatch = line.match(/^###\s+(.+?)(?:\s*[—–-]\s*(.+))?$/)
    if (sectionMatch) {
      flushText()
      sectionPrefix = sectionMatch[1].trim().toLowerCase().replace(/\s+/g, '_') + '.'
      if (sectionMatch[2]?.trim() && !isPlaceholder(sectionMatch[2].trim())) {
        map.set(sectionPrefix + '_subtitle', sectionMatch[2].trim())
      }
      continue
    }

    // Key-value: `- **Key:** Value`
    const kvMatch = line.match(/^\s*[-*]\s+\*\*(.+?):\*\*\s*(.+)$/)
    if (kvMatch) {
      flushText()
      const rawKey = kvMatch[1].trim()
      const value = kvMatch[2].trim()

      // Skip template placeholder values
      if (isPlaceholder(value)) continue

      const key = sectionPrefix + rawKey.toLowerCase().replace(/\s+/g, '_')
      map.set(key, value)

      // "Call them" / "What to call them" overrides display name
      if (!sectionPrefix) {
        const lk = rawKey.toLowerCase()
        if (lk === 'call them' || lk === 'what to call them') {
          map.set('name', value)
        }
      }
      continue
    }

    // Plain text (not heading, not key-value)
    if (sectionPrefix) {
      // Plain list items: `- Some text` (without bold key)
      const plainListMatch = line.match(/^\s*[-*]\s+(.+)$/)
      if (plainListMatch) {
        textBuffer.push(plainListMatch[1].trim())
        continue
      }
      if (line.trim()) {
        textBuffer.push(line.trim())
      }
    }
  }

  // Flush final section text
  flushText()

  return map
}

// ─── File writer (sync DB changes back to OpenClaw file) ─────────────────────

/**
 * Sync changed fields back to an OpenClaw workspace file.
 *
 * Strategy:
 *   - For each changed field, find the matching `- **Key:** Value` line and update it
 *   - If the field doesn't exist in the file, append it to the matching section
 *   - If the section doesn't exist, create a new `### Section` at the end
 *   - Only runs if the workspace file already exists (don't create it from scratch)
 *
 * This is field-by-field surgery, not a full rewrite — preserves formatting,
 * comments, and structure the user added manually.
 */
function syncToFile(type: ProfileType, fields: Record<string, string>, db?: Database): void {
  // Tenant/hosted users: don't write to shared server filesystem
  if (isTenantUser({ db })) return
  const def = PROFILES[type]
  const filePath = join(WORKSPACE, def.file)
  if (!existsSync(filePath)) return

  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    return
  }

  const lines = content.split('\n')
  const pendingBySection = new Map<string, { key: string; rawKey: string; value: string }[]>()

  for (const [fullKey, value] of Object.entries(fields)) {
    // Skip internal keys
    if (fullKey === 'name' || fullKey.endsWith('._subtitle') || fullKey.endsWith('._text')) continue
    if (!value.trim()) continue

    const dotIdx = fullKey.indexOf('.')
    const section = dotIdx > 0 ? fullKey.slice(0, dotIdx) : ''
    const fieldKey = dotIdx > 0 ? fullKey.slice(dotIdx + 1) : fullKey
    const rawKey = labelFromKey(fieldKey)

    // Try to find and update the line in-place
    const pattern = new RegExp(
      `^(\\s*[-*]\\s+\\*\\*)${escapeRegex(rawKey)}(:\\*\\*\\s*)(.+)$`,
      'im'
    )

    let found = false
    // Only match within the correct section
    let inSection = section === ''
    for (let i = 0; i < lines.length; i++) {
      // Track which section we're in
      if (lines[i].startsWith('###')) {
        const sm = lines[i].match(/^###\s+(.+?)(?:\s*[—–-]|$)/)
        const secName = sm?.[1]?.trim().toLowerCase().replace(/\s+/g, '_') ?? ''
        inSection = secName === section
      }

      if (inSection && pattern.test(lines[i])) {
        lines[i] = lines[i].replace(pattern, `$1${rawKey}$2${value}`)
        found = true
        break
      }
    }

    if (!found) {
      if (!pendingBySection.has(section)) pendingBySection.set(section, [])
      pendingBySection.get(section)!.push({ key: fullKey, rawKey, value })
    }
  }

  // Append pending fields to their sections (or create new sections)
  for (const [section, pending] of pendingBySection) {
    if (section === '') {
      // Append to top-level: find last key-value line before first ### or end
      let insertIdx = lines.length
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('###')) { insertIdx = i; break }
      }
      for (const p of pending) {
        lines.splice(insertIdx, 0, `- **${p.rawKey}:** ${p.value}`)
        insertIdx++
      }
    } else {
      const sectionTitle = labelFromKey(section)
      let sectionIdx = -1
      for (let i = 0; i < lines.length; i++) {
        const sm = lines[i].match(/^###\s+(.+?)(?:\s*[—–-]|$)/)
        if (sm && sm[1].trim().toLowerCase().replace(/\s+/g, '_') === section) {
          sectionIdx = i
          break
        }
      }

      if (sectionIdx >= 0) {
        // Find end of section (next ### or end of file)
        let endIdx = lines.length
        for (let i = sectionIdx + 1; i < lines.length; i++) {
          if (lines[i].startsWith('###') || lines[i].startsWith('## ')) { endIdx = i; break }
        }
        for (const p of pending) {
          lines.splice(endIdx, 0, `- **${p.rawKey}:** ${p.value}`)
          endIdx++
        }
      } else {
        // Create new section at end
        lines.push('', `### ${sectionTitle}`)
        for (const p of pending) {
          lines.push(`- **${p.rawKey}:** ${p.value}`)
        }
      }
    }
  }

  // Atomic write
  const newContent = lines.join('\n')
  if (newContent !== content) {
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      const tmp = filePath + '.tmp'
      writeFileSync(tmp, newContent, 'utf8')
      renameSync(tmp, filePath)
    } catch (e) {
      console.warn(`[profile-sync] Failed to sync ${def.file}:`, e instanceof Error ? e.message : e)
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── Read (merge DB + file) ──────────────────────────────────────────────────

/**
 * Read a workspace file if it exists. Returns raw content or null.
 */
function readWorkspaceFile(filename: string): string | null {
  const filePath = join(WORKSPACE, filename)
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf8').trim()
    return raw || null
  } catch {
    return null
  }
}

/**
 * Read all rows from a profile table. Returns Map<key, value>.
 */
function readDbTable(db: Database, table: string): Map<string, string> {
  const map = new Map<string, string>()
  try {
    const rows = db.prepare(`SELECT key, value FROM ${table}`).all() as { key: string; value: string }[]
    for (const row of rows) {
      if (row.value.trim()) map.set(row.key, row.value.trim())
    }
  } catch {
    // Table may not exist yet (pre-migration)
  }
  return map
}

/**
 * Get a merged profile: DB fields win, OpenClaw file fills gaps.
 *
 * In hosted mode: DB only — workspace files on the server filesystem are
 * shared across tenants and must not be read.
 *
 * In self-hosted mode: DB + OpenClaw workspace file merge (file fills gaps).
 *
 * Returns the merged Map<key, value> — empty map if no data from either source.
 */
export function getProfile(db: Database, type: ProfileType): Map<string, string> {
  const def = PROFILES[type]

  // DB fields (authoritative)
  const dbFields = readDbTable(db, def.table)

  // Tenant/hosted users: DB only — don't read shared server filesystem
  if (isTenantUser({ db })) return dbFields

  // Self-hosted: OpenClaw file fields fill gaps
  const fileContent = readWorkspaceFile(def.file)
  const fileFields = fileContent ? parseMdProfile(fileContent) : new Map<string, string>()

  // Merge: file first, then DB overwrites (DB wins)
  const merged = new Map(fileFields)
  for (const [key, value] of dbFields) {
    merged.set(key, value)
  }

  return merged
}

/**
 * Check if the OpenClaw workspace file exists for a profile type.
 * Always returns false for tenant/hosted users (workspace files are not per-tenant).
 */
export function hasWorkspaceFile(type: ProfileType, db?: Database): boolean {
  if (isTenantUser({ db })) return false
  const def = PROFILES[type]
  return existsSync(join(WORKSPACE, def.file))
}

/**
 * Get raw OpenClaw workspace file content for a profile type.
 * Returns null for tenant/hosted users (workspace files are not per-tenant).
 */
export function getWorkspaceFileContent(type: ProfileType, db?: Database): string | null {
  if (isTenantUser({ db })) return null
  return readWorkspaceFile(PROFILES[type].file)
}

// ─── Write (DB + file sync) ──────────────────────────────────────────────────

/**
 * Upsert one or more fields into a profile table.
 * Syncs back to OpenClaw workspace file if it exists.
 * Syncs name/timezone to identity table for backwards compat.
 */
export function setProfile(
  db: Database,
  type: ProfileType,
  fields: Record<string, string>,
  updatedBy = 'user',
): void {
  const def = PROFILES[type]
  const upsert = db.prepare(`
    INSERT INTO ${def.table} (key, value, updated_at, updated_by)
    VALUES (?, ?, unixepoch(), ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `)

  const txn = db.transaction(() => {
    for (const [key, value] of Object.entries(fields)) {
      if (value.trim()) {
        upsert.run(key, value.trim(), updatedBy)
      } else {
        // Empty value = delete the key
        db.prepare(`DELETE FROM ${def.table} WHERE key = ?`).run(key)
      }
    }

    // Sync user profile name/timezone → identity table (backwards compat)
    if (type === 'user') {
      if (fields.name) {
        db.prepare(
          `INSERT INTO identity (key, value, updated_by) VALUES ('user.name', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by`
        ).run(fields.name, updatedBy)
      }
      if (fields.timezone) {
        db.prepare(
          `INSERT INTO identity (key, value, updated_by) VALUES ('user.timezone', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by`
        ).run(fields.timezone, updatedBy)
      }
    }
  })

  txn()

  // Sync back to OpenClaw file (non-critical, outside transaction)
  try {
    syncToFile(type, fields, db)
  } catch (e) {
    console.warn(`[profile-sync] File sync failed:`, e instanceof Error ? e.message : e)
  }
}

/**
 * Delete a key from a profile table.
 */
export function deleteProfileKey(db: Database, type: ProfileType, key: string): void {
  const def = PROFILES[type]
  db.prepare(`DELETE FROM ${def.table} WHERE key = ?`).run(key)
}

// ─── Context formatting (for AI system prompt injection) ─────────────────────

/**
 * Format a merged profile as a markdown block for system prompt injection.
 * Uses groupIntoSections for consistent section logic.
 */
export function formatProfileContext(fields: Map<string, string>, heading: string): string | null {
  if (fields.size === 0) return null

  const sections = groupIntoSections(fields)
  if (sections.length === 0) return null

  const lines: string[] = [`### ${heading}`]

  for (const section of sections) {
    if (section.title) {
      const subtitle = section.subtitle ? ` — ${section.subtitle}` : ''
      lines.push(`\n#### ${section.title}${subtitle}`)
    }
    if (section.text) lines.push(section.text)
    for (const { key, value } of section.fields) {
      lines.push(`- **${key}:** ${value}`)
    }
  }

  return lines.join('\n')
}

/**
 * Build the full workspace context for AI injection.
 * Merges both user + ai profiles from DB + OpenClaw files.
 *
 * This is the single function that chat/route.ts calls.
 */
export function buildWorkspaceContext(db: Database): string | null {
  const parts: string[] = []

  for (const type of ['user', 'ai'] as ProfileType[]) {
    const def = PROFILES[type]
    const merged = getProfile(db, type)
    const formatted = formatProfileContext(merged, def.heading)
    if (formatted) parts.push(formatted)
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}

/** Valid profile types. */
export const PROFILE_TYPES = Object.keys(PROFILES) as ProfileType[]

/** Type guard: returns true if the string is a valid ProfileType. */
export function isProfileType(s: string): s is ProfileType {
  return (PROFILE_TYPES as string[]).includes(s)
}

// ─── Section grouping (shared between API and context formatting) ────────────

export type ProfileField = { key: string; value: string }

export type ProfileSection = {
  title: string | null
  subtitle: string | null
  fields: ProfileField[]
  text: string | null
}

/**
 * Group flat dot-notation keys into UI-ready sections.
 *
 * Used by both the settings API (returns JSON) and context formatting (builds markdown).
 * Single source of truth for how profile keys map to sections.
 */
export function groupIntoSections(fields: Map<string, string>): ProfileSection[] {
  const main: ProfileField[] = []
  const subs = new Map<string, { subtitle: string | null; text: string | null; fields: ProfileField[] }>()

  for (const [key, value] of fields) {
    const dotIdx = key.indexOf('.')
    if (dotIdx > 0) {
      const section = key.slice(0, dotIdx)
      const subKey = key.slice(dotIdx + 1)
      if (!subs.has(section)) subs.set(section, { subtitle: null, text: null, fields: [] })
      const group = subs.get(section)!
      if (subKey === '_subtitle') group.subtitle = value
      else if (subKey === '_text') group.text = value
      else group.fields.push({ key: labelFromKey(subKey), value })
    } else {
      main.push({ key: labelFromKey(key), value })
    }
  }

  const sections: ProfileSection[] = []
  if (main.length > 0) sections.push({ title: null, subtitle: null, fields: main, text: null })
  for (const [key, group] of subs) {
    sections.push({ title: labelFromKey(key), subtitle: group.subtitle, fields: group.fields, text: group.text })
  }
  return sections
}
