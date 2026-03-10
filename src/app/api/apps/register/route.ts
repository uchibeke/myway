/**
 * POST   /api/apps/register — register or update a dynamic app
 * GET    /api/apps/register — list all dynamic apps for this tenant
 * DELETE /api/apps/register — soft-delete a dynamic app by ID
 *
 * Dynamic apps are stored in the dynamic_apps DB table and resolved
 * as fallbacks when getApp(id, db) doesn't find a static registry entry.
 *
 * Protected by the existing MYWAY_API_TOKEN auth in middleware.
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import type { MywayApp } from '@/lib/apps'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { app, skillPrompt } = body as { app?: MywayApp; skillPrompt?: string }

    if (!app?.id || !app?.name || !app?.skill?.slug) {
      return Response.json(
        { error: 'Required fields: app.id, app.name, app.skill.slug' },
        { status: 400 },
      )
    }

    // Validate ID format
    if (!/^[a-z0-9-]{1,64}$/.test(app.id)) {
      return Response.json(
        { error: 'app.id must be lowercase alphanumeric with hyphens, max 64 chars' },
        { status: 400 },
      )
    }

    // Length guards
    if (app.name.length > 100) {
      return Response.json({ error: 'app.name must be 100 chars or less' }, { status: 400 })
    }
    if (skillPrompt && skillPrompt.length > 100_000) {
      return Response.json({ error: 'skillPrompt must be 100KB or less' }, { status: 400 })
    }
    const configJson = JSON.stringify(app)
    if (configJson.length > 50_000) {
      return Response.json({ error: 'app config must be 50KB or less' }, { status: 400 })
    }

    const db = getDb(getTenantId(req))

    db.prepare(`
      INSERT INTO dynamic_apps (id, config, skill_prompt, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        config = excluded.config,
        skill_prompt = excluded.skill_prompt,
        updated_at = unixepoch(),
        is_deleted = 0
    `).run(app.id, configJson, skillPrompt ?? null)

    return Response.json({ success: true, id: app.id })
  } catch (e) {
    console.error('[POST /api/apps/register]', e)
    return Response.json({ error: 'Failed to register app' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb(getTenantId(req))

    const rows = db.prepare(
      'SELECT id, config, skill_prompt, created_at, updated_at FROM dynamic_apps WHERE is_deleted = 0 ORDER BY created_at DESC',
    ).all() as { id: string; config: string; skill_prompt: string | null; created_at: number; updated_at: number }[]

    const apps = rows.map((r) => ({
      id: r.id,
      config: JSON.parse(r.config),
      hasSkillPrompt: !!r.skill_prompt,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))

    return Response.json({ apps })
  } catch {
    // Table might not exist yet
    return Response.json({ apps: [] })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 })
    }

    const db = getDb(getTenantId(req))

    const result = db.prepare(
      'UPDATE dynamic_apps SET is_deleted = 1, updated_at = unixepoch() WHERE id = ? AND is_deleted = 0',
    ).run(id)

    if (result.changes === 0) {
      return Response.json({ error: `App not found: ${id}` }, { status: 404 })
    }

    return Response.json({ success: true, id })
  } catch (e) {
    console.error('[DELETE /api/apps/register]', e)
    return Response.json({ error: 'Failed to delete app' }, { status: 500 })
  }
}
