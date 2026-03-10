/**
 * Post-login setup — runs after every successful authentication.
 *
 * Ensures the user's account is fully provisioned with:
 *   1. Profile: email + name synced from auth metadata
 *   2. APort passport: issued if not already present
 *   3. Welcome note: a starter note so the Notes app isn't empty
 *   4. Starter tasks: a few onboarding tasks so the Tasks app feels alive
 *
 * Designed to be:
 *   - Idempotent (safe to call on every login)
 *   - Non-blocking (fire-and-forget from auth callback)
 *   - Best-effort (failures never break authentication)
 *
 * SERVER ONLY.
 */

import type { Database } from 'better-sqlite3'

type SetupUser = {
  userId: string
  name?: string
  email?: string
  subdomain?: string
}

type SetupResult = {
  profileSynced: boolean
  passportProvisioned: boolean
  welcomeNoteCreated: boolean
  starterTasksCreated: boolean
  briefingCronCreated: boolean
  debriefCronCreated: boolean
}

/**
 * Run all post-login setup steps. Call after every successful login.
 * Returns which steps actually did something (vs. skipped because already done).
 */
export async function runPostLoginSetup(db: Database, user: SetupUser): Promise<SetupResult> {
  const result: SetupResult = {
    profileSynced: false,
    passportProvisioned: false,
    welcomeNoteCreated: false,
    starterTasksCreated: false,
    briefingCronCreated: false,
    debriefCronCreated: false,
  }

  // 1. Sync profile (email + name from auth)
  try {
    result.profileSynced = syncProfileFromAuth(db, user)
  } catch (e) {
    console.error('[post-login] Profile sync failed:', e instanceof Error ? e.message : e)
  }

  // 2. Provision APort passport
  try {
    const { provisionPassportIfNeeded } = await import('@/lib/aport/provision')
    const displayName = user.name || user.subdomain || user.userId
    const res = await provisionPassportIfNeeded(db, {
      name: displayName,
      email: user.email,
    })
    result.passportProvisioned = res.provisioned
  } catch (e) {
    console.error('[post-login] Passport provisioning failed:', e instanceof Error ? e.message : e)
  }

  // 3. Welcome note (only if notes table is empty)
  try {
    result.welcomeNoteCreated = seedWelcomeNote(db)
  } catch (e) {
    console.error('[post-login] Welcome note failed:', e instanceof Error ? e.message : e)
  }

  // 4. Starter tasks (only if tasks table is empty)
  try {
    result.starterTasksCreated = seedStarterTasks(db)
  } catch (e) {
    console.error('[post-login] Starter tasks failed:', e instanceof Error ? e.message : e)
  }

  // 5. Auto-schedule system crons (daily briefing + weekly debrief)
  try {
    const { ensureBriefingCron, ensureWeeklyDebriefCron } = await import('@/lib/notification/schedule-briefing-cron')
    const { getUserTimezone } = await import('@/lib/timezone')
    const tz = getUserTimezone(db)
    result.briefingCronCreated = ensureBriefingCron(db, tz)
    result.debriefCronCreated = ensureWeeklyDebriefCron(db, tz)
  } catch (e) {
    console.error('[post-login] System crons failed:', e instanceof Error ? e.message : e)
  }

  console.log('[post-login] Setup complete:', JSON.stringify(result))
  return result
}

// ─── Profile sync ─────────────────────────────────────────────────────────────

function syncProfileFromAuth(db: Database, user: SetupUser): boolean {
  let changed = false

  const upsert = db.prepare(`
    INSERT INTO user_profile (key, value, updated_at, updated_by)
    VALUES (?, ?, unixepoch(), 'auth')
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
    WHERE user_profile.updated_by = 'auth' OR user_profile.value = ''
  `)

  // Sync email if available and not already user-set
  if (user.email) {
    const existing = db.prepare('SELECT value, updated_by FROM user_profile WHERE key = ?').get('email') as
      { value: string; updated_by: string } | undefined

    if (!existing || !existing.value || existing.updated_by === 'auth') {
      upsert.run('email', user.email)
      changed = true
    }
  }

  // Sync name if available (use subdomain or userId as display name)
  const displayName = user.name && user.name !== user.userId ? user.name : user.subdomain
  if (displayName) {
    const existing = db.prepare('SELECT value, updated_by FROM user_profile WHERE key = ?').get('name') as
      { value: string; updated_by: string } | undefined

    if (!existing || !existing.value || existing.updated_by === 'auth' || existing.updated_by === 'seed') {
      upsert.run('name', displayName)
      // Also sync to identity table for backwards compat
      db.prepare(`
        INSERT INTO identity (key, value, updated_by)
        VALUES ('user.name', ?, 'auth')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by
        WHERE identity.updated_by IN ('auth', 'seed')
      `).run(displayName)
      changed = true
    }
  }

  return changed
}

// ─── Welcome note ─────────────────────────────────────────────────────────────

function seedWelcomeNote(db: Database): boolean {
  // Check if notes table exists and is empty
  try {
    const count = db.prepare('SELECT COUNT(*) AS c FROM notes WHERE is_deleted = 0').get() as { c: number }
    if (count.c > 0) return false
  } catch {
    // Table doesn't exist yet — skip
    return false
  }

  const id = `welcome-${Date.now().toString(36)}`
  const content = `# Welcome to Myway

Your personal AI workspace is ready. Here are some things you can do:

## Quick Start

- **Chat** — Talk to your AI assistant about anything
- **Tasks** — Add tasks by chatting or manually — AI helps you stay on track
- **Notes** — Capture ideas, meeting notes, and plans right here
- **Briefing AI** — Get morning briefs and evening recaps
- **Decode** — Paste any message to read the subtext and craft a reply

## Tips

- Use the **home screen** to jump between apps
- Tasks created in Chat automatically appear in the Tasks app
- Notes preserve full markdown formatting — use headers, lists, code blocks
- Check **Settings > About** for system health and usage stats

Happy exploring!`

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT INTO notes (id, title, content, tags, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, 'Welcome to Myway', content, '["welcome", "getting-started"]', null, now, now)

  return true
}

// ─── Starter tasks ────────────────────────────────────────────────────────────

function seedStarterTasks(db: Database): boolean {
  // Only seed if there are no tasks at all
  const count = db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE is_deleted = 0').get() as { c: number }
  if (count.c > 0) return false

  const { randomUUID } = require('crypto')
  const now = Math.floor(Date.now() / 1000)
  const tomorrow = now + 86400

  const tasks = [
    {
      title: 'Set up your profile',
      description: 'Go to Settings and add your name, timezone, and email so your AI assistant can personalize responses.',
      priority: 3,
      context: { why_it_matters: 'Personalized AI responses work better when the assistant knows who you are.' },
      source: 'system',
    },
    {
      title: 'Try asking the Chat app a question',
      description: 'Open the Chat app and ask anything — plan your day, brainstorm ideas, or get help with a task.',
      priority: 5,
      context: { why_it_matters: 'Chat is the core of Myway — every conversation can spawn tasks, notes, and insights.' },
      source: 'system',
    },
    {
      title: 'Explore the Decode app',
      description: 'Paste any message you received and Decode will analyze the subtext and suggest the perfect reply.',
      priority: 7,
      context: { why_it_matters: 'Great for tricky emails, ambiguous texts, or professional correspondence.' },
      source: 'system',
    },
  ]

  const insert = db.prepare(`
    INSERT INTO tasks (id, app_id, title, description, priority, due_at, context, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  db.transaction(() => {
    for (const t of tasks) {
      insert.run(
        randomUUID(),
        'tasks',
        t.title,
        t.description,
        t.priority,
        t.title.includes('profile') ? tomorrow : null,
        JSON.stringify(t.context),
        t.source,
        now,
        now,
      )
    }
  })()

  return true
}
