'use client'

/**
 * Smart Router — bypasses the LLM for pure data-retrieval queries.
 *
 * When the user asks for structured data that lives in the DB (tasks, etc.),
 * we can answer instantly without an LLM round-trip. This gives sub-100ms
 * responses vs. 1–3 second LLM latency.
 *
 * Architecture:
 *   AppShell calls smartRoute() BEFORE sending to /api/openclaw/chat.
 *   If smartRoute returns a result, it's displayed directly — no LLM call.
 *   If it returns null, the normal LLM path runs.
 *
 * Two handler registries (checked in order for a given request):
 *
 *   APP_HANDLERS       — keyed by appId. App-specific overrides.
 *   RESOURCE_HANDLERS  — keyed by resource name (from app.storage.resource).
 *                        Forge-generated apps auto-inherit these by declaring
 *                        `storage: { resource: 'tasks' }` — no extra code needed.
 *   APP_HANDLERS['*']  — global, runs for every app.
 *
 * Adding a new handler:
 *   1. Write a pattern (RegExp) and async handler function.
 *   2. Register in RESOURCE_HANDLERS[resourceName] for any app with that resource,
 *      OR in APP_HANDLERS[appId] for a specific app.
 *
 * Security: all data is fetched via /api/store/* which enforces auth/validation.
 */

import { getApp } from '@/lib/apps'
import type { TaskContext } from '@/lib/store/tasks'

export type SmartRouteResult = {
  /** Markdown-formatted response to display immediately. */
  content: string
  /** Short provenance label shown below the message, e.g. "Tasks · 3 open". */
  sourceLabel?: string
}

type SmartHandler = {
  pattern: RegExp
  /**
   * The message is passed so handlers can extract IDs or keywords.
   * Most handlers ignore it (pure DB queries), but specific lookups use it.
   */
  handler: (message: string) => Promise<SmartRouteResult | null>
}

// ─── Task handlers ─────────────────────────────────────────────────────────────

type TaskItem = {
  id: string
  title: string
  status: string
  priority: number
  dueAt: number | null
  dueAtHasTime: boolean
  description: string | null
  context: TaskContext
}

type TaskSummary = {
  totalOpen: number
  dueToday: number
  doneToday: number
  mit: { title: string } | null
}

/**
 * Format a task's due date for display.
 * Uses the explicit `hasTime` flag — not midnight detection — so date-only
 * tasks always show as just the date regardless of the viewer's timezone.
 *
 * Examples:
 *   date-only: "Thu, Feb 20"
 *   with time: "Thu, Feb 20 at 2:00 PM"
 */
function formatDueDate(epochSeconds: number, hasTime: boolean): string {
  const dt = new Date(epochSeconds * 1000)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const dateStr = dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  })

  if (!hasTime) return dateStr

  const timeStr = dt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  })
  return `${dateStr} at ${timeStr}`
}

/**
 * Build a compact italic detail line for a task's enriched context.
 * Returns null if no meaningful enriched data exists.
 */
function formatTaskDetail(task: TaskItem): string | null {
  const parts: string[] = []
  const ctx = task.context ?? {}

  if (task.description) {
    parts.push(task.description.length > 60 ? task.description.slice(0, 60) + '…' : task.description)
  }
  if (ctx.people?.length) parts.push(ctx.people.join(', '))
  if (ctx.companies?.length) parts.push(ctx.companies.join(', '))
  if (ctx.why_it_matters) parts.push(ctx.why_it_matters)

  return parts.length > 0 ? `*${parts.join(' · ')}*` : null
}

async function fetchAndFormatTaskList(): Promise<SmartRouteResult | null> {
  const res = await fetch('/api/store/tasks?limit=30')
  if (!res.ok) return null

  const { items, summary } = (await res.json()) as {
    items: TaskItem[]
    summary: TaskSummary
  }

  if (!items || items.length === 0) {
    return {
      content:
        "You have no open tasks right now. ✨\n\nTell me what you need to do and I'll add it to your list.",
      sourceLabel: 'Tasks · empty',
    }
  }

  const lines: string[] = []

  const headerParts = [`**${summary.totalOpen} open task${summary.totalOpen !== 1 ? 's' : ''}`]
  if (summary.dueToday > 0) headerParts.push(`${summary.dueToday} due today`)
  if (summary.doneToday > 0) headerParts.push(`${summary.doneToday} done today`)
  lines.push(headerParts.join(' · ') + '**', '')

  items.forEach((task, i) => {
    const isMIT = i === 0
    const due = task.dueAt
      ? ` — due ${formatDueDate(task.dueAt, task.dueAtHasTime)}`
      : ''
    if (isMIT) {
      lines.push(`🎯 **${task.title}**${due} *(Most Important)*`)
    } else {
      lines.push(`- ${task.title}${due}`)
    }

    // Show context details if present
    const detail = formatTaskDetail(task)
    if (detail) lines.push(`  ${detail}`)
  })

  if (summary.doneToday > 0) {
    const streak = summary.doneToday >= 3 ? ' 🔥' : ''
    lines.push('', `✅ ${summary.doneToday} completed today${streak}`)
  }

  return {
    content: lines.join('\n'),
    sourceLabel: `Tasks · ${summary.totalOpen} open`,
  }
}

async function fetchAndFormatTaskSummary(): Promise<SmartRouteResult | null> {
  const res = await fetch('/api/store/tasks?limit=1')
  if (!res.ok) return null

  const { summary } = (await res.json()) as { summary: TaskSummary }

  const lines: string[] = [
    '**Task summary**',
    '',
    `- Open: **${summary.totalOpen}**`,
    `- Due today: **${summary.dueToday}**`,
    `- Done today: **${summary.doneToday}**`,
  ]

  if (summary.mit) {
    lines.push('', `🎯 **MIT:** ${summary.mit.title}`)
  }

  if (summary.doneToday >= 3) {
    lines.push('', '🔥 On a streak!')
  }

  return {
    content: lines.join('\n'),
    sourceLabel: 'Tasks · summary',
  }
}

const TASK_HANDLERS: SmartHandler[] = [
  {
    // "list/show tasks", "my tasks", "what do I have to do", "what's on my plate"
    pattern: /\b(list|show( me)?|what('s| are| is)?( my| all)?|my) (tasks?|to-?dos?|plate|pending|open items?)\b|(what (do|have) i (have |need )to do)\b|(what'?s? on my plate)\b|(show|list|view) (all |open |my )?(tasks?|to-?dos?)\b/i,
    handler: (_msg) => fetchAndFormatTaskList(),
  },
  {
    // "task summary", "done today", "how many tasks", "streak"
    pattern: /\b(task summary|how many tasks?|tasks? (summary|count|stats?)|done today|completed today|finished today|streak|progress( today)?)\b/i,
    handler: (_msg) => fetchAndFormatTaskSummary(),
  },
]

// ─── Recipe handlers ────────────────────────────────────────────────────────

type RecipeItem = {
  id: string
  title: string
  tags: string[]
  cookTime?: string
  preview: string
  createdAt: number
}

async function fetchAndFormatRecipeList(): Promise<SmartRouteResult | null> {
  const res = await fetch('/api/recipes')
  if (!res.ok) return null

  const { recipes } = (await res.json()) as { recipes: RecipeItem[] }

  // Empty vault → return null so the query falls through to the LLM,
  // which can give a much more helpful contextual response.
  if (!recipes || recipes.length === 0) return null

  const lines: string[] = [
    `**${recipes.length} recipe${recipes.length !== 1 ? 's' : ''} in your vault**`,
    '',
  ]

  for (const r of recipes) {
    const time = r.cookTime ? ` · ${r.cookTime}` : ''
    const tags = r.tags.length > 0 ? ` _[${r.tags.join(', ')}]_` : ''
    lines.push(`- [${r.title}](/apps/mise?id=${r.id})${time}${tags}`)
  }

  return {
    content: lines.join('\n'),
    sourceLabel: `Recipes · ${recipes.length}`,
  }
}

async function fetchRecipeById(id: string): Promise<SmartRouteResult | null> {
  const res = await fetch(`/api/recipes?id=${encodeURIComponent(id)}`)
  if (!res.ok) return null

  const recipe = (await res.json()) as RecipeItem & { content: string }

  const lines: string[] = [
    `## ${recipe.title}`,
    '',
  ]
  if (recipe.cookTime) lines.push(`**Cook time:** ${recipe.cookTime}`)
  if (recipe.tags.length > 0) lines.push(`**Tags:** ${recipe.tags.join(', ')}`)
  lines.push('', recipe.content)

  return {
    content: lines.join('\n'),
    sourceLabel: `Recipe · ${recipe.title}`,
  }
}

const MISE_HANDLERS: SmartHandler[] = [
  {
    // Deep link lookup by ID: /apps/mise?id=xxx → initialMessage contains the ID
    pattern: /\bid[=:\s]+([a-z0-9_-]+)\b|recipe\s+id[:\s]+([a-z0-9_-]+)/i,
    handler: async (message: string) => {
      const match = message.match(/\bid[=:\s]+([a-z0-9_-]+)/i) || message.match(/recipe\s+id[:\s]+([a-z0-9_-]+)/i)
      const id = match?.[1]
      if (!id) return null
      return fetchRecipeById(id)
    },
  },
  {
    // "list/show my recipes", "what's in my vault", "show my collection"
    pattern: /\b(list|show|see|browse|view|my|all)\b.{0,20}\b(recipes?|vault|collection)\b|\bwhat('s| is) in my vault\b/i,
    handler: (_msg) => fetchAndFormatRecipeList(),
  },
  {
    // "quick dinner", "under 30 minutes", "weeknight recipe"
    pattern: /\b(quick(est)?|fast(est)?|under \d+ min|30[-\s]?min|weeknight|easy)\b.{0,20}\b(dinner|recipe|meal|cook|eat)\b|\b(dinner|recipe|meal)\b.{0,20}\b(quick|fast|easy|tonight)\b/i,
    handler: async (_msg) => {
      const result = await fetchAndFormatRecipeList()
      if (!result) return null
      // Add a note to the list response indicating it's filtered for quick meals
      return {
        ...result,
        content: result.content + '\n\n_All your recipes are listed — pick the quickest based on cook time._',
      }
    },
  },
]

// ─── Connection queries ────────────────────────────────────────────────────────
//
// Email and calendar queries are NOT smart-routed. They go through the LLM,
// which receives injected context from buildEmailContext() / buildCalendarContext().
// This gives much better answers: prioritization, summarization, action suggestions,
// and the ability to draft replies / create events via <myway:connection> blocks.
//
// The smart router would need to duplicate all that intelligence for no gain —
// the LLM path is the correct one for connection data.

// ─── Handler registries ────────────────────────────────────────────────────────

/**
 * App-specific handlers — keyed by appId.
 * Add a line here for app-specific query patterns.
 *
 * '*' runs for every app regardless of appId.
 */
const APP_HANDLERS: Record<string, SmartHandler[]> = {
  tasks: TASK_HANDLERS,
  // Chat and Briefing AI benefit from direct task lookups
  chat: TASK_HANDLERS,
  brief: TASK_HANDLERS,
  // Mise: recipe lookups (by ID for deep links, or by keyword for browse)
  mise: MISE_HANDLERS,
}

/**
 * Resource-type handlers — keyed by the `storage.resource` field on MywayApp.
 *
 * Any app (including Forge-generated apps) that declares:
 *   `storage: { resource: 'tasks' }`
 * automatically gets these handlers — no manual registration needed.
 *
 * To add a new resource:
 *   1. Create fetch handlers and register them in RESOURCE_HANDLERS
 *   2. Declare `storage: { resource: 'your-resource' }` in the app definition
 */
const RESOURCE_HANDLERS: Record<string, SmartHandler[]> = {
  tasks: TASK_HANDLERS,
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Try to answer a message directly from the DB.
 * Returns null if the message needs LLM reasoning.
 *
 * Handler resolution order:
 *   1. APP_HANDLERS[appId]         — app-specific overrides
 *   2. RESOURCE_HANDLERS[resource] — auto-inherited from app.storage.resource
 *   3. APP_HANDLERS['*']           — global handlers
 */
export async function smartRoute(
  appId: string,
  message: string,
): Promise<SmartRouteResult | null> {
  // Look up the app's declared resource type for auto-inheritance
  const app = getApp(appId)
  const resourceHandlers = app?.storage?.resource
    ? (RESOURCE_HANDLERS[app.storage.resource] ?? [])
    : []

  const handlers = [
    ...(APP_HANDLERS[appId] ?? []),
    ...resourceHandlers,
    ...(APP_HANDLERS['*'] ?? []),
  ]

  for (const { pattern, handler } of handlers) {
    if (pattern.test(message)) {
      try {
        const result = await handler(message)
        if (result) return result
      } catch {
        // Handler failed — fall through to LLM
      }
    }
  }

  return null
}
