/**
 * GET  /api/store/[resource]           — list items
 * POST /api/store/[resource]           — create/update/delete/action
 *
 * This single route handles all registered resources. New apps register a
 * ResourceHandler in src/lib/store/registry.ts — no new route files ever needed.
 *
 * GET query params:
 *   id     — fetch a single item by ID
 *   limit  — max items to return (default: 20)
 *   appId  — filter by app
 *   status — filter by status
 *   today  — "1" to filter by today's items (tasks only)
 *
 * POST body:
 *   { action: 'create', ...fields }            — create new item
 *   { action: 'update', id: string, ...fields } — update item
 *   { action: 'delete', id: string }            — soft-delete item
 *   { action: 'complete', id: string }          — resource-specific action
 *   { action: 'dismiss', id: string }           — resource-specific action
 *   (action defaults to 'create' if omitted)
 */

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { RESOURCE_REGISTRY } from '@/lib/store/registry'

type RouteContext = { params: Promise<{ resource: string }> }

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { resource } = await params
  const handler = RESOURCE_REGISTRY[resource]
  if (!handler) {
    return Response.json(
      { error: `Unknown resource: ${resource}. Available: ${Object.keys(RESOURCE_REGISTRY).join(', ')}` },
      { status: 404 },
    )
  }

  try {
    const db = getDb(getTenantId(req))
    const sp = req.nextUrl.searchParams
    const id = sp.get('id')

    // Single-item fetch
    if (id) {
      const item = await handler.get(db, id)
      if (!item) return Response.json({ error: 'Not found' }, { status: 404 })
      return Response.json(item)
    }

    // List with optional filters — spread ALL params so resource-specific
    // params (run_id, recommendation, property_key, province…) pass through.
    const query: Record<string, unknown> = {}
    sp.forEach((v, k) => { query[k] = v })
    // Coerce known numeric/boolean fields
    if (sp.has('limit'))  query.limit  = Number(sp.get('limit'))
    if (sp.has('offset')) query.offset = Number(sp.get('offset'))
    query.today = sp.get('today') === '1'
    return Response.json(await handler.list(db, query))
  } catch (err) {
    console.error(`[GET /api/store/${resource}]`, err)
    return Response.json({ error: 'Failed to fetch resource' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { resource } = await params
  const handler = RESOURCE_REGISTRY[resource]
  if (!handler) {
    return Response.json(
      { error: `Unknown resource: ${resource}. Available: ${Object.keys(RESOURCE_REGISTRY).join(', ')}` },
      { status: 404 },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action = 'create', id, ...rest } = body

  try {
    const db = getDb(getTenantId(req))
    let result: unknown

    switch (action) {
      case 'create':
        result = await handler.create(db, id ? { id, ...rest } : rest)
        break

      case 'update':
        if (!id) return Response.json({ error: 'id is required for update' }, { status: 400 })
        result = await handler.update(db, String(id), rest)
        break

      case 'delete':
        if (!id) return Response.json({ error: 'id is required for delete' }, { status: 400 })
        result = await handler.delete(db, String(id))
        break

      default:
        // Resource-specific named actions (complete, archive, dismiss, etc.)
        if (!handler.action) {
          return Response.json({ error: `Action '${action}' is not supported for ${resource}` }, { status: 400 })
        }
        if (!id && action !== 'create') {
          return Response.json({ error: 'id is required for this action' }, { status: 400 })
        }
        result = await handler.action(db, String(action), id ? String(id) : '', rest)
    }

    return Response.json(result)
  } catch (err) {
    console.error(`[POST /api/store/${resource}]`, err)
    return Response.json({ error: 'Operation failed' }, { status: 500 })
  }
}
