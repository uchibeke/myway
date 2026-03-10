/**
 * Connections type system — provider-agnostic types for all external integrations.
 *
 * Design mirrors apps.ts: ConnectionDefinition is the registry entry,
 * ConnectionProvider is the interface each service implements.
 */

import type { Database } from 'better-sqlite3'

// ─── Auth & Data Enums ──────────────────────────────────────────────────────

export type AuthType = 'oauth2' | 'api_key' | 'webhook' | 'ics_feed' | 'built_in' | 'manual'
export type DataType = 'email' | 'calendar_event' | 'contact' | 'transaction' | 'social' | 'file' | 'usage' | 'message'
export type ApprovalLevel = 'auto' | 'suggest' | 'require'
export type SyncMode = 'poll' | 'webhook' | 'manual'
export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'syncing'
export type ActionStatus = 'pending' | 'approved' | 'executed' | 'rejected' | 'failed'

// ─── Registry Types ─────────────────────────────────────────────────────────

export type ConnectionCapability = {
  id: string                    // 'email.read', 'email.send', 'calendar.create'
  name: string
  description: string
  dataType: DataType
  direction: 'inbound' | 'outbound' | 'bidirectional'
  approvalDefault: ApprovalLevel
}

export type OAuthConfig = {
  scopes: string[]
  endpoints: {
    authorize: string
    token: string
    revoke?: string
  }
  clientIdEnvVar: string
  clientSecretEnvVar: string
}

export type ConnectionDefinition = {
  id: string                    // 'google-workspace'
  name: string
  provider: string              // 'google', 'microsoft', etc.
  icon: string
  color: string
  description: string
  dataTypes: DataType[]
  capabilities: ConnectionCapability[]
  authType: AuthType
  authConfig: OAuthConfig
  syncMode: SyncMode
  syncIntervalMs: number
  approvalDefaults: Record<string, ApprovalLevel>
  live: boolean
}

// ─── DB Row Types ───────────────────────────────────────────────────────────

export type Connection = {
  id: string
  provider: string
  status: ConnectionStatus
  connectedAt: number | null
  lastSyncAt: number | null
  syncCursor: string | null
  error: string | null
  config: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type ConnectionTokens = {
  connectionId: string
  accessToken: string
  refreshToken: string | null
  tokenType: string
  expiresAt: number | null
  scopes: string | null
  raw: string | null
  updatedAt: number
}

export type ConnectionData = {
  id: string
  connectionId: string
  dataType: DataType
  title: string | null
  summary: string | null
  content: string | null
  metadata: Record<string, unknown>
  externalUrl: string | null
  occurredAt: number | null
  syncedAt: number
  isRead: boolean
  isActionable: boolean
  actionStatus: string
}

export type ConnectionAction = {
  id: string
  connectionId: string
  actionType: string
  status: ActionStatus
  payload: Record<string, unknown>
  sourceDataId: string | null
  sourceAppId: string | null
  conversationId: string | null
  createdAt: number
  executedAt: number | null
  error: string | null
}

// ─── Provider Interface ─────────────────────────────────────────────────────

export type TokenResponse = {
  accessToken: string
  refreshToken?: string
  tokenType?: string
  expiresAt?: number
  scopes?: string
  raw?: string
}

export type SyncResult = {
  items: Omit<ConnectionData, 'syncedAt'>[]
  cursor?: string
  errors?: string[]
}

export type ExecuteResult = {
  success: boolean
  externalId?: string
  error?: string
}

export interface ConnectionProvider {
  /** Generate OAuth consent URL */
  getAuthUrl(config: OAuthConfig, redirectUri: string, state?: string): string

  /** Exchange authorization code for tokens */
  exchangeCode(config: OAuthConfig, code: string, redirectUri: string): Promise<TokenResponse>

  /** Refresh expired access token */
  refreshTokens(config: OAuthConfig, refreshToken: string): Promise<TokenResponse>

  /** Pull data from external service */
  sync(db: Database, connectionId: string, tokens: ConnectionTokens, cursor?: string | null): Promise<SyncResult>

  /** Execute an approved action (send email, create event) */
  execute(tokens: ConnectionTokens, action: ConnectionAction): Promise<ExecuteResult>

  /** Build context string for system prompt injection */
  buildContext(db: Database, connectionId: string, dataType: DataType, opts?: { limit?: number; daysAhead?: number; tz?: string }): string | null
}
