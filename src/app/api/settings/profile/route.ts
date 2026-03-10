/**
 * GET  /api/settings/profile?type=user|ai — merged profile (DB + OpenClaw file).
 * POST /api/settings/profile              — upsert fields to DB.
 *
 * Uses the unified profile-sync layer. DB fields win, OpenClaw files fill gaps.
 * Non-OpenClaw users get full functionality from DB alone.
 * OpenClaw users see their file content merged in — no regression.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import {
  getProfile,
  setProfile,
  hasWorkspaceFile,
  isProfileType,
  groupIntoSections,
  type ProfileType,
  type ProfileSection,
  PROFILE_TYPES,
} from '@/lib/profile-sync'
import { invalidateWorkspaceCache } from '@/lib/workspace-context'

// ─── Response type ───────────────────────────────────────────────────────────

type ProfileResponse = {
  name: string
  type: ProfileType
  sections: ProfileSection[]
  hasWorkspaceFile: boolean
  hasDbFields: boolean
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const typeParam = req.nextUrl.searchParams.get('type') ?? 'user'
  if (!isProfileType(typeParam)) {
    return NextResponse.json({ error: `Invalid type. Must be one of: ${PROFILE_TYPES.join(', ')}` }, { status: 400 })
  }

  try {
    const db = getDb(getTenantId(req))
    const merged = getProfile(db, typeParam)
    const sections = groupIntoSections(merged)

    let dbFieldCount = 0
    try {
      const table = typeParam === 'user' ? 'user_profile' : 'ai_profile'
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number } | undefined
      dbFieldCount = row?.cnt ?? 0
    } catch { /* table may not exist yet */ }

    const response: ProfileResponse = {
      name: merged.get('name') ?? (typeParam === 'user' ? 'User' : 'Assistant'),
      type: typeParam,
      sections,
      hasWorkspaceFile: hasWorkspaceFile(typeParam, db),
      hasDbFields: dbFieldCount > 0,
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error(`[GET /api/settings/profile?type=${typeParam}]`, err)
    return NextResponse.json({
      name: typeParam === 'user' ? 'User' : 'Assistant',
      type: typeParam,
      sections: [],
      hasWorkspaceFile: false,
      hasDbFields: false,
    })
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { type?: string; fields?: Record<string, string> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const typeParam = body.type ?? 'user'
  if (!isProfileType(typeParam)) {
    return NextResponse.json({ error: `Invalid type. Must be one of: ${PROFILE_TYPES.join(', ')}` }, { status: 400 })
  }

  const fields = body.fields
  if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
    return NextResponse.json({ error: 'fields object is required and must be non-empty' }, { status: 400 })
  }

  try {
    const db = getDb(getTenantId(req))

    // Check if this is the first time name is being set (onboarding moment)
    const isFirstProfile = typeParam === 'user' && fields.name
    let hadName = false
    if (isFirstProfile) {
      try {
        const row = db.prepare(`SELECT value FROM user_profile WHERE key = 'name'`).get() as { value: string } | undefined
        hadName = !!row?.value
      } catch { /* table may not exist */ }
    }

    setProfile(db, typeParam, fields)
    invalidateWorkspaceCache()

    // Provision APort passport on first profile save (async, non-blocking)
    if (isFirstProfile && !hadName) {
      import('@/lib/aport/provision').then(({ provisionPassportIfNeeded }) => {
        provisionPassportIfNeeded(db, {
          name: fields.name!,
          email: fields.email,
        }).catch((err) => {
          console.error('[profile] passport provisioning failed:', err)
        })
      }).catch(() => { /* provision module not available */ })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(`[POST /api/settings/profile]`, err)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }
}
