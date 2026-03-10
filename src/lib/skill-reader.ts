/**
 * SKILL.md resolution with fallback chain.
 *
 * Lookup order:
 *   1. ~/.openclaw/workspace/skills/<slug>/SKILL.md  (user workspace — overrides win)
 *   2. src/lib/skills/<slug>.md                      (bundled defaults — ship with Myway)
 *   3. dynamic_apps.skill_prompt WHERE id = slug     (DB — platform-registered dynamic apps)
 *   4. null                                          (unknown skill)
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Database } from 'better-sqlite3'
import { isTenantUser } from '@/lib/hosted-storage'

const WORKSPACE_SKILLS_DIR = join(homedir(), '.openclaw', 'workspace', 'skills')
// process.cwd() is the project root in Next.js (both dev and production)
const BUNDLED_SKILLS_DIR = join(process.cwd(), 'src', 'lib', 'skills')

/**
 * Strip YAML frontmatter (--- ... ---) from the beginning of a file.
 */
function stripFrontmatter(raw: string): string {
  return raw.replace(/^---[\s\S]*?---\s*/m, '').trim()
}

/**
 * Read a skill prompt by slug. Returns the stripped content or null.
 * When `db` is provided, falls back to dynamic_apps table as step 3.
 */
export function readSkillPrompt(slug: string, db?: Database): string | null {
  // 1. OpenClaw workspace (user overrides) — self-hosted only
  if (!isTenantUser({ db })) {
    const workspacePath = join(WORKSPACE_SKILLS_DIR, slug, 'SKILL.md')
    if (existsSync(workspacePath)) {
      const raw = readFileSync(workspacePath, 'utf8')
      const stripped = stripFrontmatter(raw)
      if (stripped) return stripped
    }
  }

  // 2. Bundled defaults
  const bundledPath = join(BUNDLED_SKILLS_DIR, `${slug}.md`)
  if (existsSync(bundledPath)) {
    const raw = readFileSync(bundledPath, 'utf8')
    const stripped = stripFrontmatter(raw)
    if (stripped) return stripped
  }

  // 3. Dynamic apps (DB — platform-registered)
  if (db) {
    try {
      const row = db.prepare('SELECT skill_prompt FROM dynamic_apps WHERE id = ? AND is_deleted = 0').get(slug) as { skill_prompt: string | null } | undefined
      if (row?.skill_prompt) return row.skill_prompt
    } catch { /* table may not exist yet */ }
  }

  // 4. Unknown skill
  return null
}
