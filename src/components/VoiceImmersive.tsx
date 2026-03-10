'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { X, Mic } from 'lucide-react'
import { useVoiceInput } from '@/hooks/useVoiceInput'

/**
 * VoiceImmersive — full-screen voice input with animated orb visualization.
 *
 * Inspired by Siri/Google Assistant. The orb breathes when idle, pulses and
 * morphs when listening, and expands when the user speaks. The transcript
 * appears live below the orb.
 *
 * Designed to feel native on mobile PWA — takes over the entire viewport
 * with a blurred backdrop and smooth entry/exit transitions.
 *
 * Usage:
 *   <VoiceImmersive
 *     open={showVoice}
 *     onClose={() => setShowVoice(false)}
 *     onSubmit={(text) => send(text)}
 *     appName="Chat"
 *     appColor="#2563eb"
 *   />
 */

type Props = {
  open: boolean
  onClose: () => void
  onSubmit: (text: string) => void
  appName?: string
  appColor?: string
}

export default function VoiceImmersive({ open, onClose, onSubmit, appName = 'Myway', appColor = '#2563eb' }: Props) {
  const [liveText, setLiveText] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const voice = useVoiceInput({
    onTranscript: useCallback((text: string) => {
      setLiveText(text)
    }, []),
    onFinalResult: useCallback((text: string) => {
      if (text.trim()) {
        setSubmitted(true)
        onSubmit(text.trim())
        // Brief visual feedback then close
        setTimeout(() => {
          onClose()
        }, 600)
      }
    }, [onSubmit, onClose]),
    silenceMs: 2000,
    continuous: true,
  })

  const isListening = voice.state === 'listening'
  const isStarting = voice.state === 'starting'
  const isActive = isListening || isStarting

  // Auto-start when opened
  useEffect(() => {
    if (open && !isActive && !submitted) {
      // Small delay to allow entry animation
      const t = setTimeout(() => voice.start(), 300)
      return () => clearTimeout(t)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setLiveText('')
      setSubmitted(false)
    }
  }, [open])

  // Close on escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        voice.stop()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, voice, onClose])

  if (!open) return null

  const handleClose = () => {
    voice.stop()
    onClose()
  }

  const handleTapOrb = () => {
    if (isActive) {
      voice.stop()
    } else {
      setLiveText('')
      setSubmitted(false)
      voice.start()
    }
  }

  // Dynamic orb size based on whether user is speaking
  const hasText = liveText.length > 0
  const orbScale = isListening ? (hasText ? 1.15 : 1.0) : 0.9

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-[10000] flex flex-col items-center justify-center
                 bg-black/90 backdrop-blur-2xl rounded-[inherit]
                 animate-[voice-in_0.4s_cubic-bezier(0.16,1,0.3,1)]"
      style={{ '--voice-color': appColor } as React.CSSProperties}
    >
      {/* Close button */}
      <button
        onClick={handleClose}
        className="absolute top-3 right-4 w-10 h-10 flex items-center justify-center
                   rounded-full bg-white/10 text-white/60 hover:text-white hover:bg-white/15
                   transition-colors z-10"
        aria-label="Close voice input"
      >
        <X size={18} />
      </button>

      {/* Status label */}
      <p className="text-white/40 text-xs font-medium tracking-widest uppercase mb-8 select-none">
        {submitted ? 'Sending…' : isActive ? `Listening` : voice.error ? 'Tap to retry' : `Tap to speak`}
      </p>

      {/* Animated orb */}
      <button
        onClick={handleTapOrb}
        className="relative w-32 h-32 rounded-full flex items-center justify-center
                   transition-transform duration-500 ease-out cursor-pointer
                   focus:outline-none"
        style={{ transform: `scale(${orbScale})` }}
        aria-label={isActive ? 'Tap to stop' : 'Tap to speak'}
      >
        {/* Outer glow rings */}
        <div className={`absolute inset-0 rounded-full transition-opacity duration-700
                         ${isActive ? 'opacity-100' : 'opacity-0'}`}>
          <div className="absolute inset-[-16px] rounded-full voice-ring-outer"
               style={{ background: `radial-gradient(circle, ${appColor}20, transparent 70%)` }} />
          <div className="absolute inset-[-8px] rounded-full voice-ring-inner"
               style={{ background: `radial-gradient(circle, ${appColor}30, transparent 60%)` }} />
        </div>

        {/* Core orb */}
        <div className={`w-full h-full rounded-full flex items-center justify-center
                         transition-all duration-500
                         ${isActive ? 'voice-orb-active' : 'voice-orb-idle'}`}
             style={{
               background: isActive
                 ? `radial-gradient(circle at 40% 40%, ${appColor}ee, ${appColor}88 50%, ${appColor}44)`
                 : `radial-gradient(circle at 40% 40%, ${appColor}88, ${appColor}44 50%, ${appColor}22)`,
               boxShadow: isActive
                 ? `0 0 60px ${appColor}40, 0 0 120px ${appColor}20`
                 : `0 0 30px ${appColor}20`,
             }}>
          <Mic size={32} className={`transition-all duration-300
                                     ${isActive ? 'text-white scale-110' : 'text-white/70 scale-100'}`} />
        </div>
      </button>

      {/* Live transcript */}
      <div className="mt-10 px-8 max-w-md w-full min-h-[80px] flex flex-col items-center">
        {voice.error ? (
          <p className="text-red-400/80 text-sm text-center">{voice.error}</p>
        ) : liveText ? (
          <p className="text-white text-lg text-center leading-relaxed animate-[fade-up_0.2s_ease-out]">
            {liveText}
            {isActive && <span className="inline-block w-0.5 h-5 bg-white/60 ml-1 animate-pulse" />}
          </p>
        ) : isActive ? (
          <p className="text-white/30 text-sm text-center">Speak naturally…</p>
        ) : null}
      </div>

      {/* Hint */}
      <p className="absolute bottom-6 text-white/20 text-[11px] text-center px-8">
        {voice.isIOS
          ? 'Voice input uses your device speech recognition'
          : 'Tap the orb to start • auto-sends after silence'}
      </p>
    </div>
  )
}
