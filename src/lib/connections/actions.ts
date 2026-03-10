/**
 * Connection action blocks — parse and create pending actions from AI responses.
 *
 * Mirrors myway-actions.ts exactly: AI outputs <myway:connection> blocks,
 * which are stripped from display text and parsed into connection_actions rows.
 *
 * Action types: email.draft, email.send, email.briefing, calendar.create, calendar.respond
 * Read-only operations (email.read, calendar.read) are handled by context injection.
 */

import type { Database } from 'better-sqlite3'
import { createAction, updateActionStatus } from './store'
import { listConnections } from './store'
import { getConnectionDefinition } from './registry'

/** Regex to match a complete <myway:connection>…</myway:connection> block. */
const CONN_BLOCK_RE = /<myway:connection>([\s\S]*?)<\/myway:connection>/g

/**
 * Strip all <myway:connection>…</myway:connection> blocks from content.
 * Also strips incomplete blocks at stream end.
 */
export function stripConnectionActions(text: string): string {
  return text
    .replace(CONN_BLOCK_RE, '')
    .replace(/<myway:connection>[\s\S]*$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type ConnectionActionBlock =
  | { connection: string; action: 'email.draft'; to: string; subject: string; body: string; inReplyTo?: string; threadId?: string }
  | { connection: string; action: 'email.send'; draftId?: string; to?: string; subject?: string; body?: string; html?: string }
  | { connection: string; action: 'email.briefing'; subject: string; body: string; html?: string }
  | { connection: string; action: 'calendar.create'; title: string; start: string; end: string; attendees?: string[]; description?: string; location?: string }
  | { connection: string; action: 'calendar.respond'; eventId: string; response: 'accept' | 'decline' | 'tentative' }
  | { connection: string; action: 'calendar.update'; eventId: string; title?: string; start?: string; end?: string; description?: string; location?: string }

/** IDs of auto-executed actions queued during parsing (for post-parse execution). */
type ParseResult = { autoExecuteIds: string[] }

/**
 * Parse and execute all connection action blocks found in the AI response.
 * Creates connection_actions rows for each valid block.
 * Auto-approved actions (like email.briefing) are auto-executed immediately.
 */
export function executeMywayConnectionActions(
  db: Database,
  appId: string,
  content: string,
  conversationId?: string | null,
): ParseResult {
  const result: ParseResult = { autoExecuteIds: [] }

  // Check if any connections exist before parsing
  let connections: ReturnType<typeof listConnections>
  try {
    connections = listConnections(db)
  } catch {
    return result // connections table doesn't exist yet
  }
  if (connections.length === 0) return result

  let match: RegExpExecArray | null
  CONN_BLOCK_RE.lastIndex = 0

  while ((match = CONN_BLOCK_RE.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim()) as ConnectionActionBlock
      if (!parsed.connection || !parsed.action) continue

      // Find the connection
      const conn = connections.find((c) => c.id === parsed.connection)
      if (!conn || conn.status !== 'connected') continue

      const { connection, action, ...rest } = parsed

      const actionId = createAction(db, {
        connectionId: connection,
        actionType: action,
        payload: rest as Record<string, unknown>,
        sourceAppId: appId,
        conversationId: conversationId ?? undefined,
      })

      // Check if this action type is auto-approved
      const def = getConnectionDefinition(connection)
      const approvalDefault = def?.approvalDefaults?.[action]
      if (approvalDefault === 'auto') {
        updateActionStatus(db, actionId, 'approved')
        result.autoExecuteIds.push(actionId)
      }
    } catch {
      // Invalid JSON — skip silently
    }
  }

  return result
}
