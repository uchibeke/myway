/**
 * MOSS-TTS provider (OpenMOSS-Team via studio.mosi.cn).
 */

import type { TTSProvider, TTSResult, TTSGenerateOpts } from '../types'
import { estimateDuration } from '../helpers'
import { requireIntegration } from '@/lib/integrations'

const MOSS_TTS_URL = 'https://studio.mosi.cn/v1/audio/tts'
const MOSS_TTS_MODEL = 'moss-tts'

const MOSS_SAMPLING_PARAMS = {
  temperature: 1.3,
  top_p: 0.6,
  top_k: 50,
}

const MOSS_MAX_TOKENS = 45000

export const mossProvider: TTSProvider = {
  id: 'moss',

  async generate(text: string, opts?: TTSGenerateOpts): Promise<TTSResult> {
    requireIntegration('tts.moss')
    const apiKey = process.env.MOSS_TTS_API_KEY!
    const voiceId = opts?.voiceId || (process.env.MOSS_TTS_VOICE_ID ?? '')

    const expectedDuration = estimateDuration(text)

    const payload: Record<string, unknown> = {
      model: MOSS_TTS_MODEL,
      text,
      reference_audio: 'placeholder',
      expected_duration_sec: expectedDuration,
      sampling_params: {
        ...MOSS_SAMPLING_PARAMS,
        max_new_tokens: MOSS_MAX_TOKENS,
      },
    }

    if (voiceId) {
      payload.voice_id = voiceId
    }

    console.log(`[TTS:moss] ${text.split(/\s+/).length} words, ~${expectedDuration}s expected`)

    const res = await fetch(MOSS_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'Unknown error')
      throw new Error(`MOSS-TTS error (${res.status}): ${errBody}`)
    }

    const result = await res.json() as {
      audio_data?: string
      duration_s?: number
    }

    if (!result.audio_data) {
      throw new Error('No audio_data in MOSS response')
    }

    return {
      audioData: Buffer.from(result.audio_data, 'base64'),
      durationSec: result.duration_s ?? 0,
      format: 'wav',
    }
  },
}
