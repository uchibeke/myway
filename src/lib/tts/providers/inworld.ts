/**
 * Inworld TTS provider (inworld-tts-1.5-max).
 *
 * POST https://api.inworld.ai/tts/v1/voice
 * Returns JSON with base64-encoded audio content.
 *
 * Auth: Basic auth via INWORLD_API_KEY env var.
 * Default voice: "Clive" (overridable via voiceId).
 */

import type { TTSProvider, TTSResult, TTSGenerateOpts } from '../types'
import { estimateDuration } from '../helpers'
import { requireIntegration } from '@/lib/integrations'

const DEFAULT_VOICE = 'Clive'
const MODEL_ID = 'inworld-tts-1.5-max'

export const inworldProvider: TTSProvider = {
  id: 'inworld',

  async generate(text: string, opts?: TTSGenerateOpts): Promise<TTSResult> {
    requireIntegration('tts.inworld')
    const apiKey = process.env.INWORLD_API_KEY!
    const voiceId = opts?.voiceId || process.env.INWORLD_VOICE_ID || DEFAULT_VOICE

    console.log(`[TTS:inworld] ${text.split(/\s+/).length} words, voice=${voiceId}`)

    const res = await fetch('https://api.inworld.ai/tts/v1/voice', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voiceId,
        modelId: MODEL_ID,
        timestampType: 'WORD',
      }),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'Unknown error')
      throw new Error(`Inworld error (${res.status}): ${errBody}`)
    }

    const result = await res.json() as { audioContent: string }
    const audioData = Buffer.from(result.audioContent, 'base64')
    const duration = estimateDuration(text)

    return {
      audioData,
      durationSec: duration,
      format: 'mp3',
    }
  },
}
