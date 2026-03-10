/**
 * POST /api/openclaw/chat
 *
 * Streaming chat for all Myway AI apps. Handles two modes:
 *
 * PERSISTENT mode (chat/feed apps):
 *   - Creates/continues a DB conversation session
 *   - Saves every user + assistant message to DB (append-only)
 *   - Injects memories + personality signals + task summary + workspace context
 *     + live temporal context into system prompt
 *   - Returns X-Conversation-Id header so client can thread sessions
 *
 * STATELESS mode (transformer apps — no conversationId sent):
 *   - Passes client messages directly to AI, no DB writes
 *   - Still injects temporal context (date/time) so AI is grounded
 *   - Does NOT inject workspace context (transformers are tools, not assistants)
 *
 * Backend is fully env-driven — no provider hardcoding:
 *
 *   MYWAY_AI_BASE_URL   OpenAI-compatible completions URL
 *                        Default: http://localhost:18789  (OpenClaw gateway)
 *
 *   MYWAY_AI_TOKEN      Bearer token (also reads OPENCLAW_GATEWAY_TOKEN)
 *
 *   MYWAY_AI_MODEL      Model override (optional, leave unset for backend default)
 */

import { NextRequest } from 'next/server'
import { getApp, isPersistentApp } from '@/lib/apps'
import { getAIConfig, isAIConfigured, chatCompletionsUrl } from '@/lib/ai-config'
import { resolveModelForApp } from '@/lib/model-registry'
import { readSkillPrompt } from '@/lib/skill-reader'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { ensureConversation, getLastConversation } from '@/lib/store/conversations'
import { addMessage, getContextMessages } from '@/lib/store/messages'
import { getContextMemories } from '@/lib/store/memories'
import { getAllSignals } from '@/lib/store/personality'
import { getTaskSummary, getOpenTasks } from '@/lib/store/tasks'
import type { Task, TaskContext } from '@/lib/store/tasks'
import { getWorkspaceContext } from '@/lib/workspace-context'
import { executeMywayTaskActions, stripTaskActions } from '@/lib/myway-actions'
import { executeContentActions, stripContentActions } from '@/lib/content-actions'
import { buildRecipeContext } from '@/lib/recipes'
import { buildNotesContext } from '@/lib/notes-context'
import { buildEmailContext, buildCalendarContext } from '@/lib/connections/context'
import { executeMywayConnectionActions, stripConnectionActions } from '@/lib/connections/actions'
import { getUserTimezone, formatDueDateInTz } from '@/lib/timezone'
import { writeAllWorkspaceContext } from '@/lib/workspace-writer'
import { buildContextPalette, buildPersonalContext } from '@/lib/context-palette'
import { resolveContextRefs } from '@/lib/context-refs'
import { trackUsageFromSSE } from '@/lib/token-tracking'
import { checkAppQuota, buildQuotaExceededBody, updateQuotaCache, checkSpendLimit, buildSpendLimitExceededBody } from '@/lib/quota-gate'
import { trackOutcome } from '@/lib/approom/client'

// ─── Temporal context ─────────────────────────────────────────────────────────

/**
 * Parse the client's ISO timestamp into a human-readable context block.
 * Returns null if no timestamp provided (server falls back gracefully).
 */
function buildTemporalContext(clientContext?: {
  isoTimestamp?: string
  timezone?: string
  timeOfDay?: string
}): { label: string; timeOfDay: string; iso: string } | null {
  if (!clientContext?.isoTimestamp) return null
  try {
    const dt = new Date(clientContext.isoTimestamp)
    if (isNaN(dt.getTime())) return null
    const tz = clientContext.timezone ?? 'UTC'
    const label = dt.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    })
    return {
      label,
      timeOfDay: clientContext.timeOfDay ?? 'unknown',
      iso: clientContext.isoTimestamp,
    }
  } catch {
    return null
  }
}

// ─── Task context helper ─────────────────────────────────────────────────────

/**
 * Build a concise one-line summary of a task's enriched context.
 * Used in system prompt injection so the AI has rich context about each task.
 */
function buildTaskContextLine(task: Task): string | null {
  const parts: string[] = []
  const ctx: TaskContext = task.context ?? {}

  if (task.description) {
    parts.push(task.description.length > 80 ? task.description.slice(0, 80) + '…' : task.description)
  }
  if (ctx.when) parts.push(`When: ${ctx.when}`)
  if (ctx.where) parts.push(`Where: ${ctx.where}`)
  if (ctx.why_it_matters) parts.push(`Why: ${ctx.why_it_matters}`)
  if (ctx.people?.length) parts.push(`People: ${ctx.people.join(', ')}`)
  if (ctx.companies?.length) parts.push(`Companies: ${ctx.companies.join(', ')}`)
  if (ctx.deliverables?.length) parts.push(`Deliverables: ${ctx.deliverables.join(', ')}`)
  if (ctx.subtasks?.length) parts.push(`Subtasks: ${ctx.subtasks.join(', ')}`)
  if (ctx.references?.length) parts.push(`Refs: ${ctx.references.join(', ')}`)
  if (ctx.implementation_intention) parts.push(`Plan: ${ctx.implementation_intention}`)

  return parts.length > 0 ? parts.join('. ') : null
}

// ─── Context injection ───────────────────────────────────────────────────────

/**
 * Append a Myway context block to the skill's base system prompt.
 * This gives every app awareness of the user's long-term memory,
 * personality signals (written by any app), temporal context, and
 * cross-app state (tasks, workspace profile).
 */
function buildSystemPrompt(
  basePrompt: string,
  extras: {
    userName?: string
    timezone?: string
    currentDateTime?: { label: string; timeOfDay: string; iso: string } | null
    signals: { key: string; value: string; confidence: number }[]
    memories: { type: string; content: string; appId: string | null }[]
    taskSummary?: { totalOpen: number; dueToday: number; mit: { title: string } | null; doneToday: number } | null
    /**
     * Full open task list (injected for the Tasks app so the AI can reference IDs
     * when completing or updating tasks via <myway:task> action blocks).
     */
    openTasks?: Task[]
    workspaceContext?: string | null
    /**
     * Excerpt from the most recent previous conversation session (new sessions only).
     * Gives the AI continuity context without requiring the user to press "Resume".
     */
    prevConversationContext?: string | null
    /**
     * Recent cross-app conversation excerpts — injected for Briefing AI.
     * Enables personalized briefings that reference activity across all apps.
     */
    crossAppContext?: string | null
    /**
     * Recipe vault contents — lists recipes as markdown deep links.
     */
    recipeContext?: string | null
    /**
     * Notes context — lists saved notes as markdown deep links.
     */
    notesContext?: string | null
    /**
     * Email context — unread emails from connected Gmail account.
     */
    emailContext?: string | null
    /**
     * Calendar context — upcoming events from connected Google Calendar.
     */
    calendarContext?: string | null
  },
): string {
  const { userName, timezone, currentDateTime, signals, memories, taskSummary, openTasks, workspaceContext, prevConversationContext, crossAppContext, recipeContext, notesContext, emailContext, calendarContext } = extras
  const hasContext =
    userName || timezone || currentDateTime ||
    signals.length > 0 || memories.length > 0 ||
    taskSummary || openTasks?.length || workspaceContext || prevConversationContext || crossAppContext || recipeContext || notesContext || emailContext || calendarContext
  if (!hasContext) return basePrompt

  const lines: string[] = [
    '',
    '---',
    '## Myway Context',
    '',
    '> The following is live context from the user\'s Myway environment.',
    '> Use it to personalise responses — don\'t repeat it verbatim.',
    '> The current date/time is authoritative — never hallucinate dates or years.',
    '> When referencing a specific resource (task, note, recipe) that has a link provided,',
    '> format it as a markdown link so the user can navigate directly. Only use provided links.',
    '',
  ]

  if (currentDateTime) {
    lines.push(`**Current date/time:** ${currentDateTime.label} (${currentDateTime.timeOfDay})`)
  }
  if (userName) lines.push(`**User:** ${userName}`)
  if (timezone) lines.push(`**Timezone:** ${timezone}`)

  if (taskSummary) {
    lines.push('', '**Tasks:**')
    lines.push(`- Open: ${taskSummary.totalOpen}, Due today: ${taskSummary.dueToday}, Done today: ${taskSummary.doneToday}`)
    if (taskSummary.mit) lines.push(`- Most Important Task (MIT): "${taskSummary.mit.title}"`)
  }

  if (openTasks && openTasks.length > 0) {
    lines.push('', '**Your Open Tasks** (titles are formatted as deep links — use them when referencing tasks):')
    for (const t of openTasks) {
      const due = t.dueAt
        ? ` — due: ${formatDueDateInTz(t.dueAt, extras.timezone ?? 'UTC', t.dueAtHasTime)}`
        : ''
      lines.push(`- [${t.title}](/apps/tasks?id=${t.id}) (priority ${t.priority}${due}) [id:${t.id}]`)

      // Enriched context line
      const ctx = buildTaskContextLine(t)
      if (ctx) lines.push(`  > ${ctx}`)
    }
    lines.push('> Use [task title](/apps/tasks?id=ID) format when mentioning specific tasks in your response.')
    lines.push('> IMPORTANT: When mentioning a task that has a specific time (shown as "at HH:MM AM/PM" above), ALWAYS include the time in your response. Never drop times from task references.')
  } else if (openTasks !== undefined) {
    lines.push('', '**Your Open Tasks:** none yet — ask the user what they need to do.')
  }

  // Cross-app task creation instructions (available to all apps)
  lines.push(
    '',
    '> To create or modify tasks from any app, output a `<myway:task>` action block at the end of your response.',
    '> Format: `<myway:task>{"action":"create","title":"...","description":"...","priority":N,"dueAt":"YYYY-MM-DD" or "YYYY-MM-DDTHH:MM","context":{...}}</myway:task>`',
    '> IMPORTANT: dueAt must be a LOCAL time string WITHOUT timezone suffix. Never append "Z" or UTC offsets — the system automatically converts from the user\'s timezone. Example: "2026-02-23T11:00" (correct), NOT "2026-02-23T11:00:00Z" (wrong — would be interpreted as UTC).',
    '> Context fields: people, companies, deliverables, why_it_matters, when, where, subtasks, references',
  )

  if (signals.length > 0) {
    lines.push('', '**Signals** (cross-app personality state):')
    for (const s of signals) {
      const note = s.confidence < 0.8 ? ' *(inferred)*' : ''
      lines.push(`- ${s.key}: ${s.value}${note}`)
    }
  }

  if (memories.length > 0) {
    lines.push('', '**Memory** (long-term facts and preferences):')
    for (const m of memories.slice(0, 10)) {
      const scope = m.appId ? ` (${m.appId})` : ' (global)'
      lines.push(`- [${m.type}${scope}] ${m.content}`)
    }
  }

  if (workspaceContext) {
    lines.push('', '**User profile (from workspace):**')
    lines.push(workspaceContext)
  }

  if (prevConversationContext) {
    lines.push('', '**Recent conversation context** (previous session — for continuity):')
    lines.push(prevConversationContext)
    lines.push('> Use this for continuity and to avoid repeating questions. Do not recite it back.')
  }

  if (crossAppContext) {
    lines.push('', '**Cross-app activity** (recent conversations across all your apps):')
    lines.push(crossAppContext)
    lines.push('> Use this to provide rich, contextual insights. Reference specific cross-app patterns when relevant.')
  }

  if (recipeContext) {
    lines.push('', recipeContext)
  }

  if (notesContext) {
    lines.push('', notesContext)
  }

  if (emailContext) {
    lines.push('', emailContext)
  }

  if (calendarContext) {
    lines.push('', calendarContext)
    // Prevent double-counting: calendar events auto-create tasks in the task list above.
    // The AI should treat them as the same item, not count them separately.
    if (openTasks && openTasks.length > 0) {
      lines.push('> NOTE: Some calendar events above also appear in your task list (auto-synced). Treat them as the same item — do not double-count or list them twice.')
    }
  }

  // Connection action instructions (alongside task actions)
  if (emailContext || calendarContext) {
    lines.push(
      '',
      '> To perform email or calendar actions, output a `<myway:connection>` action block at the end of your response.',
      '> Email draft: `<myway:connection>{"connection":"google-workspace","action":"email.draft","to":"...","subject":"...","body":"..."}</myway:connection>`',
      '> Email send: `<myway:connection>{"connection":"google-workspace","action":"email.send","to":"...","subject":"...","body":"...","html":"<html>...</html>"}</myway:connection>`',
      '> Email briefing (auto-approved, sends to self): `<myway:connection>{"connection":"google-workspace","action":"email.briefing","subject":"...","body":"plain text fallback","html":"<html>...</html>"}</myway:connection>`',
      '> Calendar create: `<myway:connection>{"connection":"google-workspace","action":"calendar.create","title":"...","start":"YYYY-MM-DDTHH:MM","end":"YYYY-MM-DDTHH:MM"}</myway:connection>`',
      '> Calendar respond: `<myway:connection>{"connection":"google-workspace","action":"calendar.respond","eventId":"...","response":"accept|decline|tentative"}</myway:connection>`',
      '> Calendar update: `<myway:connection>{"connection":"google-workspace","action":"calendar.update","eventId":"...","title":"...","start":"YYYY-MM-DDTHH:MM","end":"YYYY-MM-DDTHH:MM","location":"..."}</myway:connection>`',
      '> Write actions create pending items that require user approval before execution.',
    )
  }

  return basePrompt + '\n' + lines.join('\n')
}

// ─── Route ───────────────────────────────────────────────────────────────────

type ChatMessage = { role: 'user' | 'assistant'; content: string }

type RequestBody = {
  appId: string
  /** Present for chat-type apps after the first exchange. */
  conversationId?: string
  /**
   * Message history. For persistent mode, only the last user message matters —
   * the server loads authoritative history from DB. For stateless mode, the full
   * array is passed to the AI.
   */
  messages: ChatMessage[]
  /**
   * Device context sent by every shell on every request.
   * Provides temporal grounding so the AI knows the real date/time.
   */
  clientContext?: {
    isoTimestamp: string
    timezone: string
    timeOfDay: string
  }
  /**
   * Optional metadata to persist with the user's message (e.g. file attachments).
   * Stored in messages.metadata JSON field — not sent to the AI.
   */
  messageMetadata?: Record<string, unknown>
  /**
   * Context refs to resolve server-side and inject into the system prompt.
   * Each ref loads detailed data for the specified source — the data appears
   * in the system prompt, never in the user message bubble.
   *
   * Values: 'tasks', 'recipes', 'notes', 'memories', 'email', 'calendar',
   *         'conversations', 'files', '*' (all available sources).
   */
  contextRefs?: string[]
}

export async function POST(req: NextRequest) {
  if (!isAIConfigured()) {
    return Response.json(
      { error: 'No AI backend configured. Set MYWAY_AI_TOKEN or OPENCLAW_GATEWAY_TOKEN (or MYWAY_AI_BASE_URL for Ollama).' },
      { status: 500 }
    )
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { appId, conversationId: clientConvId, messages, clientContext, messageMetadata, contextRefs } = body
  if (!appId || !Array.isArray(messages)) {
    return Response.json({ error: 'appId and messages are required' }, { status: 400 })
  }

  // Get DB reference early for dynamic app resolution
  const chatDb = getDb(getTenantId(req))

  const app = getApp(appId, chatDb)
  if (!app?.skill) {
    return Response.json({ error: `No skill configured for app: ${appId}` }, { status: 404 })
  }

  // Resolve model for this specific app (provider/model/modelClass → baseUrl + token + model)
  const { baseUrl, token, model } = resolveModelForApp(app.provider, app.model, app.modelClass)

  const baseSkillPrompt = readSkillPrompt(app.skill.slug, chatDb)
  if (!baseSkillPrompt) {
    return Response.json(
      { error: `SKILL.md not found for skill: ${app.skill.slug}. Add a bundled default at src/lib/skills/${app.skill.slug}.md or a workspace file at ~/.openclaw/workspace/skills/${app.skill.slug}/SKILL.md` },
      { status: 500 }
    )
  }

  // ── Quota gate (paid apps only) ──────────────────────────────────────────
  // Check AppRoom quota before burning tokens. Self-hosted / free apps skip.
  const userId = req.headers.get('x-myway-user-id') ?? undefined
  const quotaResult = await checkAppQuota(chatDb, app, userId)
  if (!quotaResult.allowed) {
    return Response.json(buildQuotaExceededBody(quotaResult, app.name, app.id), { status: 402 })
  }

  // ── Spend limit (hosted only, plan-aware) ────────────────────────────────
  // MYWAY_MAX_FREE_SPEND / MYWAY_MAX_PAID_SPEND cap total USD/month.
  const spendResult = await checkSpendLimit(chatDb)
  if (!spendResult.allowed) {
    return Response.json(buildSpendLimitExceededBody(spendResult), { status: 402 })
  }

  // Parse client-provided temporal context (grounding — works for all paths)
  const currentDateTime = buildTemporalContext(clientContext)

  // ── Decide context level: full / personal / temporal ─────────────────────────
  // Explicit contextLevel on the app wins; otherwise infer from isPersistentApp().
  const contextLevel = app.contextLevel ?? (isPersistentApp(app) ? 'full' : 'temporal')
  let conversationId: string | null = null
  let historyMessages: ChatMessage[] = messages

  if (contextLevel === 'full') {
    let db: ReturnType<typeof getDb>
    let systemPrompt = baseSkillPrompt
    let userTz = 'UTC'

    try {
      db = chatDb

      // Get or create conversation
      conversationId = ensureConversation(db, clientConvId, appId)

      // Save the incoming user message (with optional attachment metadata)
      const incomingUser = messages.filter(m => m.role === 'user').pop()
      if (incomingUser) {
        addMessage(db, {
          conversationId,
          appId,
          role: 'user',
          content: incomingUser.content,
          metadata: messageMetadata ?? {},
        })
      }

      // Load authoritative history from DB (25 messages balances context vs token cost)
      historyMessages = getContextMessages(db, conversationId, 25)

      // For brand-new conversations, inject a brief excerpt from the previous session
      // so the AI has continuity context without the user pressing "Resume".
      let prevConversationContext: string | null = null
      if (!clientConvId) {
        try {
          const lastConv = getLastConversation(db, appId)
          if (lastConv && lastConv.id !== conversationId) {
            const prevMsgs = getContextMessages(db, lastConv.id, 3)
            if (prevMsgs.length > 0) {
              prevConversationContext = prevMsgs
                .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
                .join('\n')
            }
          }
        } catch {
          // Non-critical — continue without previous context
        }
      }

      // Build enriched system prompt with full cross-app context
      const memories = getContextMemories(db, appId, 20)
      const signals = getAllSignals(db, 'user.')
      const identity = db.prepare(
        `SELECT key, value FROM identity`
      ).all() as { key: string; value: string }[]

      // Read user timezone from identity; sync from client if it changed
      let userTz = getUserTimezone(db)
      if (clientContext?.timezone && clientContext.timezone !== userTz) {
        try {
          db.prepare(
            `INSERT INTO identity (key, value, updated_by) VALUES ('user.timezone', ?, 'chat')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by`
          ).run(clientContext.timezone)
          userTz = clientContext.timezone
        } catch { /* non-critical — keep existing timezone */ }
      }

      // Task summary for apps that benefit from it (brief, tasks, chat)
      let taskSummary = null
      try {
        taskSummary = getTaskSummary(db, userTz)
      } catch { /* tasks table may not exist yet */ }

      // Full task list — injected for apps that discuss tasks with the user.
      // Tasks app needs IDs for complete/update via <myway:task> blocks.
      // Chat and Brief need titles/due dates to answer follow-up questions about tasks.
      let openTasks: Task[] | undefined
      if (['tasks', 'chat', 'brief'].includes(appId)) {
        try {
          // Only inject tasks due within 48h (+ undated high-priority) to keep context tight
          openTasks = getOpenTasks(db, 15, userTz, 2)
        } catch { /* tasks table may not exist yet */ }
      }

      // Workspace context (DB profile + USER.md + IDENTITY.md) — cached 5 min
      const workspaceContext = getWorkspaceContext(db)

      // Cross-app context — loaded for Briefing AI to enable rich personalized briefs.
      // Samples the last conversation from each major app (first user msg + last AI msg).
      let crossAppContext: string | null = null
      if (appId === 'brief') {
        try {
          const appsToSample = ['chat', 'tasks', 'mise', 'decode', 'notes', 'forge', 'roast', 'oracle', 'drama', 'office']
          const excerpts: string[] = []
          for (const aid of appsToSample) {
            const lastConv = getLastConversation(db, aid)
            if (!lastConv) continue
            const msgs = getContextMessages(db, lastConv.id, 4)
            if (msgs.length === 0) continue
            // Take first user message + last assistant message for concise context
            const firstUser = msgs.find(m => m.role === 'user')
            const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant')
            const parts: string[] = []
            if (firstUser) parts.push(`User: ${firstUser.content.slice(0, 180)}`)
            if (lastAssistant) parts.push(`AI: ${lastAssistant.content.slice(0, 180)}`)
            if (parts.length > 0) {
              const appName = aid.charAt(0).toUpperCase() + aid.slice(1)
              excerpts.push(`**${appName}:** ${parts.join(' → ')}`)
            }
          }
          if (excerpts.length > 0) crossAppContext = excerpts.join('\n\n')
        } catch { /* non-critical — brief works without cross-app context */ }
      }

      // Cross-app context: recipes + notes — available to ALL persistent apps so any
      // app can reference or suggest recipes/notes. Both return null if empty.
      const recipeContext = buildRecipeContext(db, undefined, userId)
      const notesContext = buildNotesContext(db, undefined, userId)

      // Connection context: email + calendar — available to ALL persistent apps.
      // Returns null if no connections configured (zero regression).
      let emailContext: string | null = null
      let calendarContext: string | null = null
      try {
        emailContext = buildEmailContext(db)
        calendarContext = buildCalendarContext(db, 2, userTz)
      } catch { /* connections table may not exist yet */ }

      systemPrompt = buildSystemPrompt(baseSkillPrompt, {
        userName: identity.find(i => i.key === 'user.name')?.value,
        timezone: identity.find(i => i.key === 'user.timezone')?.value,
        currentDateTime,
        signals,
        memories: memories.map(m => ({ type: m.type, content: m.content, appId: m.appId })),
        taskSummary,
        openTasks,
        workspaceContext,
        prevConversationContext,
        crossAppContext,
        recipeContext,
        notesContext,
        emailContext,
        calendarContext,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[chat] DB setup error:', err)
      // Fall back to stateless mode — chat still works, just no persistence
      conversationId = null
      historyMessages = messages
      // Still inject temporal context even in fallback
      systemPrompt = buildSystemPrompt(baseSkillPrompt, {
        currentDateTime,
        signals: [],
        memories: [],
      })
      console.warn(`[chat] Falling back to stateless mode: ${msg}`)
    }

    // Accumulate the response to save after streaming (only if DB is available)
    let accumulated = ''
    let rawSSE = ''  // Full SSE text for token usage extraction
    const decoder = new TextDecoder()
    const convId = conversationId
    const dbForFlush = conversationId ? db! : null
    // Use the tenant-aware DB for token tracking even in stateless mode
    const dbForTracking = chatDb || null

    let lineBuf = ''
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true })
        if (dbForTracking) rawSSE += text
        if (dbForFlush) {
          lineBuf += text
          const lines = lineBuf.split('\n')
          lineBuf = lines.pop() ?? '' // keep partial line for next chunk
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const raw = line.slice(6).trim()
              if (raw === '[DONE]') continue
              try {
                const delta = (JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] })
                  ?.choices?.[0]?.delta?.content
                if (delta) accumulated += delta
              } catch { /* non-JSON SSE line */ }
            }
          }
        }
        controller.enqueue(chunk)
      },
      async flush() {
        if (dbForFlush && accumulated && convId) {
          try {
            // Execute any <myway:task> action blocks before saving
            executeMywayTaskActions(dbForFlush, appId, accumulated, convId, userTz)
            // Execute content action blocks (recipe saves, note saves, etc.)
            try { executeContentActions(dbForFlush, accumulated, userId) } catch (e) {
              console.error('[chat] Content action execution failed:', e)
            }
            // Execute any <myway:connection> action blocks (email drafts, calendar events)
            try {
              const connResult = executeMywayConnectionActions(dbForFlush, appId, accumulated, convId)
              // Auto-execute any auto-approved actions (e.g. email.briefing, email.draft)
              if (connResult.autoExecuteIds.length > 0) {
                const { executeAction } = require('@/lib/connections/manager') as typeof import('@/lib/connections/manager')
                for (const id of connResult.autoExecuteIds) {
                  try { await executeAction(dbForFlush, id) } catch (e) {
                    console.warn('[chat] Auto-execute action failed:', id, e)
                  }
                }
              }
            } catch { /* connection actions are non-critical */ }
            // Strip action blocks from the stored content (they're not display text)
            const cleaned = stripContentActions(stripConnectionActions(stripTaskActions(accumulated)))
            addMessage(dbForFlush, { conversationId: convId, appId, role: 'assistant', content: cleaned || accumulated })
            // Refresh workspace context files after mutations (non-critical)
            try { writeAllWorkspaceContext(dbForFlush, userTz) } catch { /* non-critical */ }
          } catch (e) {
            console.error('[chat] Failed to save assistant message:', e)
          }
        }
        // Track token usage (works for all modes: hosted, OpenClaw, BYOK)
        if (dbForTracking && rawSSE) {
          try {
            const usage = trackUsageFromSSE(dbForTracking, appId, model || null, rawSSE)
            // Track outcome to AppRoom for paid apps (fire-and-forget)
            if (userId && app.pricing?.model === 'subscription' && app.pricing.outcomeTypes?.[0] && usage) {
              trackOutcome({
                userId,
                appId,
                outcomeId: app.pricing.outcomeTypes[0],
                tokenUsage: {
                  input: usage.promptTokens,
                  output: usage.completionTokens,
                  total: usage.totalTokens,
                  cost: usage.estimatedCost,
                },
                durationMs: undefined,
                status: 'completed',
              }).then((res) => {
                // Update local quota cache with fresh remaining count
                if (res.remaining !== undefined && dbForTracking) {
                  updateQuotaCache(dbForTracking, appId, app.pricing!.outcomeTypes![0], res.remaining)
                }
              }).catch(() => { /* non-critical */ })
            }
          } catch { /* non-critical */ }
        }
      },
    })

    const upstream = await fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'system', content: systemPrompt }, ...historyMessages],
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 4096,
        ...(model ? { model } : {}),
      }),
    })

    if (!upstream.ok || !upstream.body) {
      const err = await upstream.text().catch(() => upstream.statusText)
      return Response.json({ error: `AI backend error: ${err}` }, { status: upstream.status })
    }

    upstream.body.pipeTo(writable).catch(() => { /* stream may abort on client disconnect */ })

    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    }
    if (conversationId) headers['X-Conversation-Id'] = conversationId
    // Expose remaining quota to client for low-quota warnings (paid apps only)
    if (quotaResult.remaining !== undefined) {
      headers['X-Quota-Remaining'] = String(quotaResult.remaining)
    }

    return new Response(readable, { headers })
  }

  // ── Personal path (contextLevel: 'personal') ────────────────────────────────
  // Enriches system prompt with palette summary (counts + samples) + signals.
  // If contextRefs are present, resolves full data for the requested sources.
  // Persistence is orthogonal to context level — apps with storage.conversations
  // still save messages even on the personal path.
  if (contextLevel === 'personal') {
    let personalSystemPrompt = baseSkillPrompt
    const persistent = isPersistentApp(app)
    let personalConvId: string | null = null
    let personalDb: ReturnType<typeof getDb> | null = null

    try {
      const db = chatDb
      personalDb = db

      // Conversation persistence (when app opts in via storage.conversations)
      if (persistent) {
        personalConvId = ensureConversation(db, clientConvId, appId)
        const incomingUser = messages.filter(m => m.role === 'user').pop()
        if (incomingUser) {
          addMessage(db, {
            conversationId: personalConvId,
            appId,
            role: 'user',
            content: incomingUser.content,
            metadata: messageMetadata ?? {},
          })
        }
        historyMessages = getContextMessages(db, personalConvId, 25)
      }

      const palette = buildContextPalette(db, userId)
      const signals = getAllSignals(db, 'user.')
      const identity = db.prepare(
        `SELECT key, value FROM identity`
      ).all() as { key: string; value: string }[]

      const personalContext = buildPersonalContext(palette, {
        userName: identity.find(i => i.key === 'user.name')?.value,
        timezone: identity.find(i => i.key === 'user.timezone')?.value,
        currentDateTime,
        signals,
      })
      personalSystemPrompt = baseSkillPrompt + '\n' + personalContext

      // Resolve context refs — full detailed data for requested sources
      if (contextRefs && contextRefs.length > 0) {
        const resolved = resolveContextRefs(db, contextRefs, userId)
        if (resolved) {
          personalSystemPrompt += '\n\n### Detailed Context (requested by the user)\n\n' + resolved
        }
      }
    } catch (err) {
      console.warn('[chat] Personal context failed, falling back to temporal:', err)
      personalConvId = null
      personalDb = null
      if (currentDateTime) {
        personalSystemPrompt = buildSystemPrompt(baseSkillPrompt, {
          currentDateTime,
          signals: [],
          memories: [],
        })
      }
    }

    const upstreamPersonal = await fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'system', content: personalSystemPrompt }, ...historyMessages],
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 4096,
        ...(model ? { model } : {}),
      }),
    })

    if (!upstreamPersonal.ok || !upstreamPersonal.body) {
      const err = await upstreamPersonal.text().catch(() => upstreamPersonal.statusText)
      return Response.json({ error: `AI backend error: ${err}` }, { status: upstreamPersonal.status })
    }

    // When persistent, use TransformStream to capture + save assistant response
    if (personalConvId && personalDb) {
      let accumulated = ''
      let rawSSEPersonal = ''
      const decoder = new TextDecoder()
      const convId = personalConvId
      const dbFlush = personalDb

      let personalLineBuf = ''
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          const text = decoder.decode(chunk, { stream: true })
          rawSSEPersonal += text
          personalLineBuf += text
          const lines = personalLineBuf.split('\n')
          personalLineBuf = lines.pop() ?? '' // keep partial line for next chunk
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const raw = line.slice(6).trim()
              if (raw === '[DONE]') continue
              try {
                const delta = (JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] })
                  ?.choices?.[0]?.delta?.content
                if (delta) accumulated += delta
              } catch { /* non-JSON SSE line */ }
            }
          }
          controller.enqueue(chunk)
        },
        flush() {
          console.log(`[chat/personal] flush() called — accumulated ${accumulated.length} chars, appId=${appId}, userId=${userId ?? 'none'}`)
          if (accumulated) {
            const hasContentBlock = accumulated.includes('<myway:content>') || accumulated.includes('<myway:recipe>') || accumulated.includes('<myway:note>')
            if (hasContentBlock) {
              console.log(`[chat/personal] Content action block detected in accumulated text`)
            }
            try {
              // Execute content action blocks (personal context apps like Mise)
              try { executeContentActions(dbFlush, accumulated, userId) } catch (e) {
                console.error('[chat/personal] Content action execution failed:', e)
              }
              const cleaned = stripContentActions(stripConnectionActions(stripTaskActions(accumulated)))
              addMessage(dbFlush, { conversationId: convId, appId, role: 'assistant', content: cleaned || accumulated })
            } catch (e) {
              console.error('[chat/personal] Failed to save assistant message:', e)
            }
          }
          if (rawSSEPersonal) {
            try {
              const usage = trackUsageFromSSE(dbFlush, appId, model || null, rawSSEPersonal)
              // Track outcome to AppRoom for paid apps (fire-and-forget)
              if (userId && app.pricing?.model === 'subscription' && app.pricing.outcomeTypes?.[0] && usage) {
                trackOutcome({
                  userId,
                  appId,
                  outcomeId: app.pricing.outcomeTypes[0],
                  tokenUsage: {
                    input: usage.promptTokens,
                    output: usage.completionTokens,
                    total: usage.totalTokens,
                    cost: usage.estimatedCost,
                  },
                  status: 'completed',
                }).then((res) => {
                  if (res.remaining !== undefined && dbFlush) {
                    updateQuotaCache(dbFlush, appId, app.pricing!.outcomeTypes![0], res.remaining)
                  }
                }).catch(() => { /* non-critical */ })
              }
            } catch { /* non-critical */ }
          }
        },
      })

      upstreamPersonal.body.pipeTo(writable).catch(() => {})

      const personalHeaders: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'X-Conversation-Id': convId,
      }
      if (quotaResult.remaining !== undefined) {
        personalHeaders['X-Quota-Remaining'] = String(quotaResult.remaining)
      }

      return new Response(readable, { headers: personalHeaders })
    }

    // Non-persistent personal: stream through with tracking + content actions
    {
      let rawSSEPersonal = ''
      let accumulatedNonPersistent = ''
      let nonPersistLineBuf = ''
      const decoder = new TextDecoder()
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          const text = decoder.decode(chunk, { stream: true })
          rawSSEPersonal += text
          // Accumulate content deltas for action block execution
          nonPersistLineBuf += text
          const lines = nonPersistLineBuf.split('\n')
          nonPersistLineBuf = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const raw = line.slice(6).trim()
              if (raw === '[DONE]') continue
              try {
                const delta = (JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] })
                  ?.choices?.[0]?.delta?.content
                if (delta) accumulatedNonPersistent += delta
              } catch { /* non-JSON SSE line */ }
            }
          }
          controller.enqueue(chunk)
        },
        flush() {
          // Execute content action blocks even without conversation persistence
          if (accumulatedNonPersistent && chatDb) {
            try { executeContentActions(chatDb, accumulatedNonPersistent, userId) } catch (e) {
              console.error('[chat/personal-nonpersist] Content action execution failed:', e)
            }
          }
          if (rawSSEPersonal) {
            try { trackUsageFromSSE(chatDb, appId, model || null, rawSSEPersonal) } catch { /* non-critical */ }
          }
        },
      })
      upstreamPersonal.body.pipeTo(writable).catch(() => {})
      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      })
    }
  }

  // ── Temporal path (contextLevel: 'temporal') ───────────────────────────────
  // Inject temporal context only — no workspace/memory (tools, not assistants)
  let statelessSystemPrompt = baseSkillPrompt
  if (currentDateTime) {
    statelessSystemPrompt = buildSystemPrompt(baseSkillPrompt, {
      currentDateTime,
      signals: [],
      memories: [],
    })
  }

  const upstream = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ role: 'system', content: statelessSystemPrompt }, ...historyMessages],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 4096,
      ...(model ? { model } : {}),
    }),
  })

  if (!upstream.ok || !upstream.body) {
    const err = await upstream.text().catch(() => upstream.statusText)
    return Response.json({ error: `AI backend error: ${err}` }, { status: upstream.status })
  }

  // Wrap stream to track usage + execute content action blocks even in stateless mode
  let rawSSEStateless = ''
  let accumulatedStateless = ''
  let statelessLineBuf = ''
  const decoderStateless = new TextDecoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoderStateless.decode(chunk, { stream: true })
      rawSSEStateless += text
      // Accumulate content deltas for action block execution
      statelessLineBuf += text
      const lines = statelessLineBuf.split('\n')
      statelessLineBuf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') continue
          try {
            const delta = (JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] })
              ?.choices?.[0]?.delta?.content
            if (delta) accumulatedStateless += delta
          } catch { /* non-JSON SSE line */ }
        }
      }
      controller.enqueue(chunk)
    },
    flush() {
      // Execute content action blocks even in stateless mode
      if (accumulatedStateless && chatDb) {
        try { executeContentActions(chatDb, accumulatedStateless, userId) } catch (e) {
          console.error('[chat/stateless] Content action execution failed:', e)
        }
      }
      if (rawSSEStateless) {
        try { trackUsageFromSSE(chatDb, appId, model || null, rawSSEStateless) } catch { /* non-critical */ }
      }
    },
  })
  upstream.body.pipeTo(writable).catch(() => {})

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
