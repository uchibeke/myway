'use client'

/**
 * chat-client — shared utility for all shells that call /api/openclaw/chat.
 *
 * Centralises the request body shape so every shell automatically sends
 * clientContext (timestamp, timezone, time-of-day) without duplicating logic.
 *
 * Usage:
 *   const clientContext = useClientContext()
 *   body: JSON.stringify(buildChatBody(app.id, messages, { conversationId, clientContext }))
 */

import type { ClientContext } from '@/hooks/useClientContext'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export function buildChatBody(
  appId: string,
  messages: ChatMessage[],
  opts: {
    conversationId?: string | null
    clientContext?: ClientContext
    /**
     * Context refs to resolve server-side. Each ref tells the backend to load
     * a specific data source and inject it into the system prompt.
     * Values: 'tasks', 'recipes', 'notes', 'memories', 'email', 'calendar',
     *         'conversations', 'files', '*' (all).
     */
    contextRefs?: string[]
  } = {},
) {
  return {
    appId,
    messages,
    conversationId: opts.conversationId ?? undefined,
    // Only send the fields the server actually needs (not dateLabel/timeLabel
    // which are client display-only — the server derives its own from isoTimestamp)
    clientContext: opts.clientContext
      ? {
          isoTimestamp: opts.clientContext.isoTimestamp,
          timezone:     opts.clientContext.timezone,
          timeOfDay:    opts.clientContext.timeOfDay,
        }
      : undefined,
    contextRefs: opts.contextRefs?.length ? opts.contextRefs : undefined,
  }
}
