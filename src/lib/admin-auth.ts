/**
 * Admin authentication helpers — shared across admin API routes.
 *
 * Deployment modes:
 *   - Self-hosted (OpenClaw / BYOK): no x-myway-user-id header → single user, always admin
 *   - Hosted (AppRoom SSO): x-myway-user-id present → check MYWAY_ADMIN_EMAILS
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { isHostedMode } from '@/lib/hosted-storage'

/** Check if the current request is from an admin. Returns null if authorized, or a 403 response. */
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const userId = req.headers.get('x-myway-user-id')
  const adminEmails = getAdminEmails()

  // Self-hosted (no auth header) — single user, always admin
  if (!userId) return null

  // Hosted mode: MYWAY_ADMIN_EMAILS must be configured. If not set, deny all
  // admin access to prevent every authenticated user from seeing all tenants.
  if (adminEmails.length === 0) {
    if (isHostedMode()) {
      return NextResponse.json({ error: 'Admin access not configured' }, { status: 403 })
    }
    return null // self-hosted without auth header check (no userId, handled above)
  }

  try {
    const db = getDb(userId)
    const row = db.prepare(
      "SELECT value FROM user_profile WHERE key = 'email'"
    ).get() as { value: string } | undefined
    const email = row?.value?.toLowerCase()
    if (email && adminEmails.includes(email)) return null
  } catch { /* table may not exist */ }

  return NextResponse.json({ error: 'Access denied' }, { status: 403 })
}

/** Whether this instance is running in self-hosted mode (no multi-tenant auth). */
export function isSelfHosted(req: NextRequest): boolean {
  return !req.headers.get('x-myway-user-id')
}

function getAdminEmails(): string[] {
  return (process.env.MYWAY_ADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
}
