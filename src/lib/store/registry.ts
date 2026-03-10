/**
 * Store Registry — unified CRUD for all Myway resources.
 *
 * Architecture:
 *   Each resource implements `ResourceHandler` (list/get/create/update/delete/action).
 *   The dynamic route /api/store/[resource] dispatches to the correct handler.
 *   New apps register here — zero new route files needed.
 *
 * Usage:
 *   GET  /api/store/tasks              → list open tasks
 *   GET  /api/store/tasks?today=1      → list today's tasks
 *   GET  /api/store/tasks?id=<id>      → get single task
 *   POST /api/store/tasks { action: 'create', appId, title, ... }
 *   POST /api/store/tasks { action: 'update', id, status: 'done' }
 *   POST /api/store/tasks { action: 'complete', id }
 *   POST /api/store/tasks { action: 'delete', id }
 *
 * SERVER ONLY — never import from client components.
 */

import type { Database } from 'better-sqlite3'
import { tasksResource } from './resource-tasks'
import { notificationsResource } from './resource-notifications'
import { conversationsResource } from './resource-conversations'
import { messagesResource } from './resource-messages'
import { briefingsResource } from './resource-briefings'
import { pipelineRunsResource } from './resource-pipeline-runs'
import { hunterPropertiesResource } from './resource-hunter-properties'
import { influencePostsResource } from './resource-influence-posts'
import { guardrailEventsResource } from './resource-guardrail-events'

export type ListQuery = {
  limit?: number
  /** Page offset for paginated lists (e.g. conversation history). */
  offset?: number
  appId?: string
  status?: string
  today?: boolean
  [key: string]: unknown
}

/**
 * All resources implement this interface.
 * `action` handles resource-specific named operations (complete, dismiss, archive, etc.)
 *
 * Handlers may return Promises (e.g. D1-backed handlers) — the API route awaits all results.
 */
export type ResourceHandler = {
  list(db: Database, query: ListQuery): unknown | Promise<unknown>
  get(db: Database, id: string): unknown | null | Promise<unknown | null>
  create(db: Database, body: Record<string, unknown>): { id: string } | Promise<{ id: string }>
  update(db: Database, id: string, body: Record<string, unknown>): { ok: true } | Promise<{ ok: true }>
  delete(db: Database, id: string): { ok: true } | Promise<{ ok: true }>
  /** Resource-specific named actions (e.g. complete, archive, dismiss). */
  action?(db: Database, actionName: string, id: string, body: Record<string, unknown>): unknown | Promise<unknown>
}

/**
 * Registry map — add one line for each new resource.
 * No new API route files ever needed.
 */
export const RESOURCE_REGISTRY: Record<string, ResourceHandler> = {
  tasks: tasksResource,
  notifications: notificationsResource,
  conversations: conversationsResource,
  messages: messagesResource,
  briefings: briefingsResource,
  'pipeline-runs': pipelineRunsResource,
  'hunter-properties': hunterPropertiesResource,
  'influence-posts':    influencePostsResource,
  'guardrail-events':   guardrailEventsResource,
}
