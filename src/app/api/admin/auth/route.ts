/**
 * GET /api/admin/auth
 *
 * Checks if the current user is an admin.
 * Returns: { isAdmin: boolean, isSelfHosted: boolean, email?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, isSelfHosted } from '@/lib/admin-auth'

export async function GET(req: NextRequest) {
  try {
    const selfHosted = isSelfHosted(req)
    const denied = await requireAdmin(req)

    if (denied) {
      return NextResponse.json({ isAdmin: false, isSelfHosted: selfHosted })
    }

    return NextResponse.json({ isAdmin: true, isSelfHosted: selfHosted })
  } catch (err) {
    console.error('[GET /api/admin/auth]', err)
    return NextResponse.json(
      { error: 'Failed to check admin auth' },
      { status: 500 },
    )
  }
}
