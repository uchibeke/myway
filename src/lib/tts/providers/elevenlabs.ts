/**
 * ElevenLabs TTS provider.
 *
 * POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 * Returns binary mp3 audio.
 */

import type { TTSProvider, TTSResult, TTSGenerateOpts } from '../types'
import { estimateDuration } from '../helpers'
import { requireIntegration } from '@/lib/integrations'

export const elevenlabsProvider: TTSProvider = {
  id: 'elevenlabs',

  async generate(text: string, opts?: TTSGenerateOpts): Promise<TTSResult> {
    requireIntegration('tts.elevenlabs')
    const apiKey = process.env.ELEVENLABS_API_KEY!
    const voiceId = opts?.voiceId || process.env.ELEVENLABS_VOICE_ID!

    console.log(`[TTS:elevenlabs] ${text.split(/\s+/).length} words`)

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.75,
          similarity_boost: 0.75,
        },
      }),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'Unknown error')
      throw new Error(`ElevenLabs error (${res.status}): ${errBody}`)
    }

    const audioData = Buffer.from(await res.arrayBuffer())
    const duration = estimateDuration(text)

    return {
      audioData,
      durationSec: duration,
      format: 'mp3',
    }
  },
}
