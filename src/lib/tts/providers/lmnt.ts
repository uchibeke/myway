/**
 * LMNT TTS provider.
 *
 * POST https://api.lmnt.com/v1/ai/speech
 * Returns binary wav audio.
 */

import type { TTSProvider, TTSResult, TTSGenerateOpts } from '../types'
import { estimateDuration } from '../helpers'
import { requireIntegration } from '@/lib/integrations'

export const lmntProvider: TTSProvider = {
  id: 'lmnt',

  async generate(text: string, opts?: TTSGenerateOpts): Promise<TTSResult> {
    requireIntegration('tts.lmnt')
    const apiKey = process.env.LMNT_API_KEY!
    const voiceId = opts?.voiceId || process.env.LMNT_VOICE_ID!

    console.log(`[TTS:lmnt] ${text.split(/\s+/).length} words`)

    const body = new URLSearchParams({
      text,
      voice: voiceId,
      format: 'wav',
    })

    const res = await fetch('https://api.lmnt.com/v1/ai/speech', {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'Unknown error')
      throw new Error(`LMNT error (${res.status}): ${errBody}`)
    }

    const audioData = Buffer.from(await res.arrayBuffer())
    const duration = estimateDuration(text)

    return {
      audioData,
      durationSec: duration,
      format: 'wav',
    }
  },
}
