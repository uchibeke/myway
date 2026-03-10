/**
 * TTS module — re-exports everything for backward-compatible imports.
 *
 * `import { stableAssetId, VoiceEntry } from '@/lib/tts'` keeps working.
 */

export { stableAssetId, stripMarkdown, estimateDuration } from './helpers'
export type { VoiceEntry, TTSProviderId, AudioFormat, TTSResult, TTSProvider, TTSGenerateOpts } from './types'
export { getProvider } from './providers'
