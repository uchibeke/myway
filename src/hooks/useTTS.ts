'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { VoiceEntry } from '@/lib/tts'
import { speechStart } from '@/lib/haptics'

export type TTSState = 'idle' | 'generating' | 'playing'

const POLL_INTERVAL = 3000 // 3 seconds
const POLL_TIMEOUT = 5 * 60 * 1000 // 5 minutes

export function useTTS() {
  const [state, setState] = useState<TTSState>('idle')
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    clearPoll()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current = null
    }
    setState('idle')
    setActiveAssetId(null)
  }, [clearPoll])

  // Cleanup on unmount
  useEffect(() => stop, [stop])

  /** Play a saved voice file */
  const playFile = useCallback((assetId: string, voiceId: string) => {
    stop()

    const url = `/api/tts/play?assetId=${encodeURIComponent(assetId)}&voiceId=${encodeURIComponent(voiceId)}`
    const audio = new Audio(url)
    audioRef.current = audio

    audio.onended = () => {
      setState('idle')
      setActiveAssetId(null)
      audioRef.current = null
    }
    audio.onerror = () => {
      setState('idle')
      setActiveAssetId(null)
      audioRef.current = null
    }

    setState('playing')
    setActiveAssetId(assetId)
    speechStart()
    audio.play().catch(() => {
      setState('idle')
      setActiveAssetId(null)
    })
  }, [stop])

  /** Generate a new voice via TTS provider (async — returns when audio is ready) */
  const generate = useCallback(async (text: string, assetId: string, provider?: string, voiceId?: string): Promise<VoiceEntry | null> => {
    stop()
    setState('generating')
    setActiveAssetId(assetId)

    try {
      // Kick off — returns 202 immediately with { jobId }
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, assetId, ...(provider ? { provider } : {}), ...(voiceId ? { voiceId } : {}) }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'TTS generation failed')
      }

      const { jobId } = await res.json() as { jobId: string }

      // Poll until done or failed
      const entry = await new Promise<VoiceEntry | null>((resolve) => {
        const started = Date.now()

        const check = async () => {
          try {
            const poll = await fetch(`/api/tts?jobId=${encodeURIComponent(jobId)}`)
            const data = await poll.json() as {
              status: string
              entry?: VoiceEntry
              error?: string
            }

            if (data.status === 'done' && data.entry) {
              clearPoll()
              resolve(data.entry)
              return
            }

            if (data.status === 'failed') {
              clearPoll()
              console.error('[TTS] Generation failed:', data.error)
              resolve(null)
              return
            }

            // Timeout safety
            if (Date.now() - started > POLL_TIMEOUT) {
              clearPoll()
              console.error('[TTS] Generation timed out')
              resolve(null)
            }
          } catch {
            // Network blip — keep polling
          }
        }

        // First check after a short delay (MOSS might be fast for short texts)
        pollRef.current = setInterval(check, POLL_INTERVAL)
      })

      if (!entry) {
        setState('idle')
        setActiveAssetId(null)
        return null
      }

      // Auto-play the generated voice
      playFile(assetId, entry.id)
      return entry
    } catch (err) {
      console.error('[TTS] Generate failed:', err)
      setState('idle')
      setActiveAssetId(null)
      return null
    }
  }, [stop, playFile, clearPoll])

  return { generate, playFile, stop, state, activeAssetId }
}
