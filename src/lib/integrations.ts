/**
 * Integration registry + guard.
 *
 * Single source of truth for which env vars each integration needs.
 * Exports convenience checks (boolean) and a throwing guard for API routes.
 */

// ─── Registry ────────────────────────────────────────────────────────────────

type IntegrationEntry = {
  name: string
  requiredVars: string[]
}

const registry: Record<string, IntegrationEntry> = {
  'tts.lmnt': {
    name: 'LMNT',
    requiredVars: ['LMNT_API_KEY', 'LMNT_VOICE_ID'],
  },
  'tts.elevenlabs': {
    name: 'ElevenLabs',
    requiredVars: ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'],
  },
  'tts.moss': {
    name: 'MOSS TTS',
    requiredVars: ['MOSS_TTS_API_KEY'],
  },
  'tts.inworld': {
    name: 'Inworld TTS',
    requiredVars: ['INWORLD_API_KEY'],
  },
  'google-workspace': {
    name: 'Google Workspace',
    requiredVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  },
  'telegram': {
    name: 'Telegram',
    requiredVars: ['TELEGRAM_BOT_TOKEN'],
  },
}

/** Build hint that only mentions the vars actually missing. */
function buildHint(missingVars: string[]): string {
  if (missingVars.length === 0) return ''
  return `Set ${missingVars.join(' and ')} in .env.local`
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type IntegrationId = keyof typeof registry

export type IntegrationStatus = {
  configured: boolean
  name: string
  missingVars: string[]
  setupHint: string
}

// ─── Error class ─────────────────────────────────────────────────────────────

export class IntegrationNotConfiguredError extends Error {
  integrationId: string
  setupHint: string
  missingVars: string[]

  constructor(id: string, status: IntegrationStatus) {
    const msg = `${status.name} not configured: missing ${status.missingVars.join(', ')}`
    super(msg)
    this.name = 'IntegrationNotConfiguredError'
    this.integrationId = id
    this.setupHint = status.setupHint
    this.missingVars = status.missingVars
  }
}

// ─── Checks ──────────────────────────────────────────────────────────────────

export function checkIntegration(id: string): IntegrationStatus {
  const entry = registry[id]
  if (!entry) {
    return { configured: false, name: id, missingVars: [], setupHint: `Unknown integration: ${id}` }
  }
  const missingVars = entry.requiredVars.filter((v) => !process.env[v])
  return {
    configured: missingVars.length === 0,
    name: entry.name,
    missingVars,
    setupHint: buildHint(missingVars),
  }
}

export function checkAllIntegrations(): Record<string, IntegrationStatus> {
  const result: Record<string, IntegrationStatus> = {}
  for (const id of Object.keys(registry)) {
    result[id] = checkIntegration(id)
  }
  return result
}

/** Throws IntegrationNotConfiguredError if the integration's env vars are missing. */
export function requireIntegration(id: string): void {
  const status = checkIntegration(id)
  if (!status.configured) {
    throw new IntegrationNotConfiguredError(id, status)
  }
}

/** True if at least one TTS provider has all its required env vars set. */
export function isAnyTTSConfigured(): boolean {
  return (
    checkIntegration('tts.lmnt').configured ||
    checkIntegration('tts.elevenlabs').configured ||
    checkIntegration('tts.moss').configured ||
    checkIntegration('tts.inworld').configured
  )
}
