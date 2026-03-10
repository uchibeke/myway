'use client'

import { useCallback, useState, useEffect } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { useVoiceInput, type VoiceInputState } from '@/hooks/useVoiceInput'

/**
 * VoiceMicButton — mic toggle for the chat input bar.
 *
 * Tap to start listening → live transcript fills the textarea.
 * Tap again or silence auto-stops → ready to send.
 *
 * Designed as a drop-in alongside the Paperclip and Send buttons.
 */

type Props = {
  /** Called with live transcript text */
  onTranscript: (text: string) => void
  /** Called when voice input ends with final text */
  onFinalResult?: (text: string) => void
  /** Whether the input is currently disabled */
  disabled?: boolean
  className?: string
}

export default function VoiceMicButton({ onTranscript, onFinalResult, disabled, className = '' }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const voice = useVoiceInput({
    onTranscript: useCallback((text: string) => {
      onTranscript(text)
    }, [onTranscript]),
    onFinalResult,
    silenceMs: 2000,
    continuous: true,
  })

  const isActive = voice.state === 'listening' || voice.state === 'starting'

  // Defer support check to after mount to avoid SSR/client mismatch
  if (!mounted || !voice.isSupported) return null

  const toggle = () => {
    if (disabled) return
    if (isActive) {
      voice.stop()
    } else {
      voice.start()
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={disabled}
      className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg mb-1
                  transition-all duration-200
                  ${isActive
                    ? 'text-red-400 bg-red-500/15 voice-pulse'
                    : 'text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.08]'}
                  disabled:opacity-30 disabled:cursor-not-allowed
                  ${className}`}
      aria-label={isActive ? 'Stop listening' : 'Voice input'}
      title={isActive ? 'Tap to stop' : 'Voice input'}
    >
      {isActive ? <MicOff size={14} /> : <Mic size={14} />}
    </button>
  )
}
