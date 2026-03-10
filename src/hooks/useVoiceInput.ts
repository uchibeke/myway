'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { micStart, micStop } from '@/lib/haptics'

/**
 * useVoiceInput — Web Speech API wrapper for voice-to-text input.
 *
 * Two consumer patterns:
 *   1. Chat input mode — transcript feeds into a textarea
 *   2. Immersive mode  — full-screen animated experience with auto-submit
 *
 * The hook handles browser compat, permissions, interim/final results,
 * silence detection, and iOS fallback.
 *
 * Usage:
 *   const voice = useVoiceInput({ onTranscript, onFinalResult, silenceMs })
 *   voice.start()  // begins listening
 *   voice.stop()   // stops + fires final
 */

// Web Speech API type shims (not in all TS libs)
/* eslint-disable @typescript-eslint/no-explicit-any */
type SpeechRecognitionCompat = any
type SpeechRecognitionEventCompat = { results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }
type SpeechRecognitionErrorCompat = { error: string }
/* eslint-enable @typescript-eslint/no-explicit-any */

export type VoiceInputState = 'idle' | 'starting' | 'listening' | 'error'

type UseVoiceInputOpts = {
  /** Called with live transcript (interim + final combined) */
  onTranscript?: (text: string, isFinal: boolean) => void
  /** Called when recognition ends (silence or manual stop) with final text */
  onFinalResult?: (text: string) => void
  /** Auto-stop after this many ms of silence. 0 = no auto-stop. Default: 1500 */
  silenceMs?: number
  /** Language. Default: browser default */
  lang?: string
  /** Continuous mode — keeps listening after each phrase. Default: true */
  continuous?: boolean
}

type UseVoiceInputReturn = {
  state: VoiceInputState
  transcript: string
  interimTranscript: string
  start: () => void
  stop: () => void
  /** True if Web Speech API is available in this browser */
  isSupported: boolean
  /** True if on iOS (manual PWA install instructions needed) */
  isIOS: boolean
  error: string | null
}

function getSpeechRecognition(): (new () => SpeechRecognitionCompat) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    (new () => SpeechRecognitionCompat) | null
}

export function useVoiceInput(opts: UseVoiceInputOpts = {}): UseVoiceInputReturn {
  const {
    onTranscript,
    onFinalResult,
    silenceMs = 1500,
    lang,
    continuous = true,
  } = opts

  const [state, setState] = useState<VoiceInputState>('idle')
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionCompat | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finalTranscriptRef = useRef('')
  const stoppedManuallyRef = useRef(false)

  // Stable refs for callbacks
  const onTranscriptRef = useRef(onTranscript)
  const onFinalResultRef = useRef(onFinalResult)
  useEffect(() => { onTranscriptRef.current = onTranscript }, [onTranscript])
  useEffect(() => { onFinalResultRef.current = onFinalResult }, [onFinalResult])

  const SpeechRecognitionClass = getSpeechRecognition()
  const isSupported = SpeechRecognitionClass !== null
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    clearSilenceTimer()
    stoppedManuallyRef.current = true
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* already stopped */ }
    }
  }, [clearSilenceTimer])

  const start = useCallback(() => {
    if (!SpeechRecognitionClass) {
      setError('Voice input not supported in this browser')
      setState('error')
      return
    }

    // Clean up any previous instance
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* ok */ }
    }

    setError(null)
    setTranscript('')
    setInterimTranscript('')
    finalTranscriptRef.current = ''
    stoppedManuallyRef.current = false
    setState('starting')

    const recognition = new SpeechRecognitionClass()
    recognition.continuous = continuous
    recognition.interimResults = true
    if (lang) recognition.lang = lang

    recognition.onstart = () => {
      setState('listening')
      micStart()
    }

    recognition.onresult = (event: SpeechRecognitionEventCompat) => {
      clearSilenceTimer()

      let interim = ''
      let final = ''

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          final += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }

      if (final) {
        finalTranscriptRef.current = final
      }

      const combined = (final + interim).trim()
      setTranscript(final.trim())
      setInterimTranscript(interim.trim())

      const isFinal = interim === '' && final !== ''
      onTranscriptRef.current?.(combined, isFinal)

      // Silence detection: auto-stop after silenceMs of no new results
      if (silenceMs > 0 && combined) {
        silenceTimerRef.current = setTimeout(() => {
          stoppedManuallyRef.current = true
          try { recognition.stop() } catch { /* ok */ }
        }, silenceMs)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorCompat) => {
      clearSilenceTimer()
      if (event.error === 'aborted' || event.error === 'no-speech') {
        // Not real errors — user cancelled or said nothing
        setState('idle')
        return
      }
      const msg = event.error === 'not-allowed'
        ? 'Microphone access denied. Check your browser permissions.'
        : `Voice error: ${event.error}`
      setError(msg)
      setState('error')
    }

    recognition.onend = () => {
      clearSilenceTimer()
      micStop()
      const finalText = finalTranscriptRef.current.trim()
      if (finalText) {
        onFinalResultRef.current?.(finalText)
      }
      setState('idle')
      recognitionRef.current = null
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start voice input')
      setState('error')
    }
  }, [SpeechRecognitionClass, continuous, lang, silenceMs, clearSilenceTimer])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSilenceTimer()
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch { /* ok */ }
      }
    }
  }, [clearSilenceTimer])

  return {
    state,
    transcript,
    interimTranscript,
    start,
    stop,
    isSupported,
    isIOS,
    error,
  }
}
