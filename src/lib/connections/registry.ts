/**
 * Connection registry — single source of truth for available connection types.
 *
 * Mirrors apps.ts: each connection is a registry entry defining auth,
 * capabilities, and sync behavior. Adding a new connection = add one
 * ConnectionDefinition + implement ConnectionProvider.
 */

import type { Database } from 'better-sqlite3'
import type { ConnectionDefinition, ConnectionProvider } from './types'

// ─── Provider Implementations ───────────────────────────────────────────────

// Lazy-loaded to avoid importing googleapis at module level
let _googleProvider: ConnectionProvider | null = null

function getGoogleProvider(): ConnectionProvider {
  if (!_googleProvider) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _googleProvider = require('./providers/google-workspace').googleWorkspaceProvider
  }
  return _googleProvider!
}

// ─── Connection Definitions ─────────────────────────────────────────────────

export const CONNECTION_DEFINITIONS: ConnectionDefinition[] = [
  {
    id: 'token-tracking',
    name: 'AI Insights',
    provider: 'built_in',
    icon: '📊',
    color: 'bg-blue-500',
    description: 'See how your AI is working for you — tokens, costs, and trends',
    dataTypes: ['usage'],
    capabilities: [
      { id: 'usage.read', name: 'View usage', description: 'View token usage and cost breakdowns', dataType: 'usage', direction: 'inbound', approvalDefault: 'auto' },
    ],
    authType: 'built_in',
    authConfig: {
      scopes: [],
      endpoints: { authorize: '', token: '' },
      clientIdEnvVar: '',
      clientSecretEnvVar: '',
    },
    syncMode: 'manual',
    syncIntervalMs: 0,
    approvalDefaults: { 'usage.read': 'auto' },
    live: true,
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    provider: 'google',
    icon: '📧',
    color: 'bg-blue-500',
    description: 'Gmail + Google Calendar — email awareness and schedule sync',
    dataTypes: ['email', 'calendar_event'],
    capabilities: [
      { id: 'email.read', name: 'Read emails', description: 'Sync unread emails for context', dataType: 'email', direction: 'inbound', approvalDefault: 'auto' },
      { id: 'email.send', name: 'Send emails', description: 'Send emails on your behalf', dataType: 'email', direction: 'outbound', approvalDefault: 'require' },
      { id: 'email.briefing', name: 'Send briefings', description: 'Send daily briefing emails to yourself (auto-approved)', dataType: 'email', direction: 'outbound', approvalDefault: 'auto' },
      { id: 'email.draft', name: 'Create drafts', description: 'Create email drafts in Gmail', dataType: 'email', direction: 'outbound', approvalDefault: 'auto' },
      { id: 'calendar.read', name: 'Read calendar', description: 'Sync upcoming events', dataType: 'calendar_event', direction: 'inbound', approvalDefault: 'auto' },
      { id: 'calendar.create', name: 'Create events', description: 'Create calendar events', dataType: 'calendar_event', direction: 'outbound', approvalDefault: 'require' },
      { id: 'calendar.respond', name: 'Respond to invites', description: 'Accept or decline calendar invitations', dataType: 'calendar_event', direction: 'outbound', approvalDefault: 'require' },
      { id: 'calendar.update', name: 'Update events', description: 'Modify existing calendar events (time, title, location)', dataType: 'calendar_event', direction: 'outbound', approvalDefault: 'require' },
    ],
    authType: 'oauth2',
    authConfig: {
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/calendar.events',
      ],
      endpoints: {
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        revoke: 'https://oauth2.googleapis.com/revoke',
      },
      clientIdEnvVar: 'GOOGLE_CLIENT_ID',
      clientSecretEnvVar: 'GOOGLE_CLIENT_SECRET',
    },
    syncMode: 'poll',
    syncIntervalMs: 5 * 60 * 1000, // 5 minutes
    approvalDefaults: {
      'email.read': 'auto',
      'email.send': 'require',
      'email.briefing': 'auto',
      'email.draft': 'auto',
      'calendar.read': 'auto',
      'calendar.create': 'require',
      'calendar.respond': 'require',
      'calendar.update': 'require',
    },
    live: true,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    provider: 'telegram',
    icon: '✈️',
    color: 'bg-sky-500',
    description: 'Receive briefings, task reminders, and AI alerts via Telegram',
    dataTypes: ['message'],
    capabilities: [
      { id: 'telegram.send', name: 'Send messages', description: 'Deliver notifications and briefings to your Telegram', dataType: 'message', direction: 'outbound', approvalDefault: 'auto' },
    ],
    authType: 'manual',
    authConfig: {
      scopes: [],
      endpoints: { authorize: '', token: '' },
      clientIdEnvVar: 'TELEGRAM_BOT_TOKEN',
      clientSecretEnvVar: '',
    },
    syncMode: 'manual',
    syncIntervalMs: 0,
    approvalDefaults: { 'telegram.send': 'auto' },
    live: true,
    // Manual setup: user provides Chat ID from @userinfobot, we store it.
    // OpenClaw users: bot already configured. BYOK: connect own bot. Hosted: our bot.
  },
]

// ─── Lookup Functions ───────────────────────────────────────────────────────

export function getConnectionDefinition(id: string): ConnectionDefinition | null {
  return CONNECTION_DEFINITIONS.find((c) => c.id === id) ?? null
}

export function getLiveDefinitions(): ConnectionDefinition[] {
  return CONNECTION_DEFINITIONS.filter((c) => c.live)
}

/**
 * Get the provider implementation for a connection definition.
 * Returns null if no provider is registered for the given ID.
 */
export function getProvider(definitionId: string): ConnectionProvider | null {
  switch (definitionId) {
    case 'google-workspace':
      return getGoogleProvider()
    default:
      return null
  }
}

/**
 * Check if a connection definition is built-in (no external auth, always active).
 */
export function isBuiltIn(definitionId: string): boolean {
  const def = getConnectionDefinition(definitionId)
  return def?.authType === 'built_in'
}

/**
 * Get data for a built-in connection.
 * Each built-in connection type returns its own data shape.
 */
export function getBuiltInData(db: Database, definitionId: string, params: Record<string, string> = {}): unknown {
  switch (definitionId) {
    case 'token-tracking': {
      const { getUsageSummary } = require('@/lib/token-tracking') as typeof import('@/lib/token-tracking')
      const days = parseInt(params.days || '30', 10)
      return getUsageSummary(db, days)
    }
    default:
      return null
  }
}
