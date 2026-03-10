/**
 * Generic App Route — /apps/[id]
 *
 * Handles ALL apps where interactionType !== 'tool'.
 * Tool apps (Files, Mise, Roast) have their own page.tsx with custom UI.
 *
 * The interaction type determines which shell renders:
 *   'chat'        → AppShell (conversational, streaming)
 *   'transformer' → TransformerShell (input → output side-by-side)
 *   'feed'        → FeedShell (AI-generated scrollable feed)
 *   'button'      → ButtonShell (single tap → output)
 *   'canvas'      → CanvasShell (rich editor, coming soon)
 *
 * Openers (empty state quick actions) come from the registry — no per-app hardcoding.
 *
 * Dynamic apps: if getApp(id) doesn't find a static entry, falls back to
 * the dynamic_apps DB table (platform-registered apps via /api/apps/register).
 */

import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { getApp, getGenericApps } from '@/lib/apps'
import { getDb } from '@/lib/db'
import GenericApp from '@/components/GenericApp'

// Tell Next.js which [id] values to pre-render at build time
export function generateStaticParams() {
  return getGenericApps().map((app) => ({ id: app.id }))
}

export const dynamicParams = true

export default async function AppPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ q?: string }>
}) {
  const { id } = await params
  const { q } = await searchParams

  // Try static registry first (no DB needed)
  let app = getApp(id)

  // Dynamic fallback: check DB for platform-registered apps
  if (!app) {
    const hdrs = await headers()
    const userId = hdrs.get('x-myway-user-id') ?? undefined
    try {
      const db = getDb(userId)
      app = getApp(id, db)
    } catch { /* DB unavailable */ }
  }

  // 'tool' apps must have their own page under /apps/<id>/page.tsx
  if (!app || !app.live || app.interactionType === 'tool') {
    return notFound()
  }

  return <GenericApp app={app} initialMessage={q ? decodeURIComponent(q) : undefined} />
}
