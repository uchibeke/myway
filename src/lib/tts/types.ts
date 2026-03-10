/**
 * TTS shared types.
 */

export type TTSProviderId = 'lmnt' | 'elevenlabs' | 'moss' | 'inworld'

export type AudioFormat = 'wav' | 'mp3'

export interface TTSGenerateOpts {
  /** Override the default voice for this provider */
  voiceId?: string
}

export interface TTSResult {
  audioData: Buffer
  durationSec: number
  format: AudioFormat
}

export interface TTSProvider {
  id: TTSProviderId
  generate(text: string, opts?: TTSGenerateOpts): Promise<TTSResult>
}

/** Metadata saved alongside each audio file */
export interface VoiceEntry {
  id: string
  assetId: string
  textPreview: string
  durationSec: number
  createdAt: string // ISO
  format?: AudioFormat
  provider?: TTSProviderId
}
