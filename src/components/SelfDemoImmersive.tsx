'use client'

/**
 * SelfDemoImmersive — full-screen scripted demo for visitors (E2).
 *
 * Renders the ACTUAL app components (FeedShell, AppShell) in demo mode.
 * This means any change to the real apps is automatically reflected in the
 * demo — no duplicate rendering logic to maintain.
 *
 * Both shells are mounted simultaneously and CSS-switched (`hidden` / visible)
 * so there is zero layout shift when transitioning between demo steps.
 *
 * Phase sequence:
 *   1. Welcome greeting — TTS plays intro, text shown below orb
 *   2. Part A: Morning Brief — FeedShell with audio-synced content reveal
 *   3. Part B: Q&A — Alex voice speaks question, Myway answers via AppShell
 *   4. "Your turn" — Myway invites visitor, mic opens, live LLM response
 *
 * Audio-text sync: requestAnimationFrame reads audio.currentTime / duration
 * to proportionally reveal tokens. Live responses only appear when TTS starts.
 *
 * All demo content from @/lib/demo-content (single source of truth).
 * TTS cached via stableAssetId(text) — change the text, cache auto-invalidates.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Mic, ArrowRight, Sparkles } from 'lucide-react'
import { speechStart } from '@/lib/haptics'
import { useTTS } from '@/hooks/useTTS'
import { useInworldRealtime } from '@/hooks/useInworldRealtime'
import { stableAssetId } from '@/lib/tts'
import type { VoiceEntry } from '@/lib/tts'
import VoiceImmersive from '@/components/VoiceImmersive'
import GenericApp from '@/components/GenericApp'
import { getApp } from '@/lib/apps'
import {
  DEMO_WELCOME_TTS,
  DEMO_BRIEF_TTS,
  DEMO_QA_TTS,
  DEMO_QA_USER_TTS,
  DEMO_YOUR_TURN_TTS,
  DEMO_BRIEF_MARKDOWN,
  DEMO_QA_USER_MESSAGE,
  DEMO_QA_RESPONSE,
} from '@/lib/demo-content'

// ─── Types ──────────────────────────────────────────────────────────────────

type DemoPhase =
  | 'tap_to_start'
  | 'welcome'
  | 'brief_playing'
  | 'brief_to_qa'
  | 'qa_user_speaking'
  | 'qa_playing'
  | 'your_turn'
  | 'visitor_realtime'       // Inworld WebRTC — mic open, AI responds in realtime
  | 'visitor_listening'      // Fallback — STT via VoiceImmersive
  | 'visitor_responding'     // Fallback — waiting for LLM text
  | 'visitor_response_playing' // Fallback — TTS playing
  | 'cta'
  | 'interrupted'
  | 'responding'
  | 'response_playing'
  | 'cta_after_interrupt'

type Props = {
  onComplete: () => void
  onSignup: () => void
}

// ─── Audio-synced text reveal ───────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.split(/(\s+)/)
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function SelfDemoImmersive({ onComplete, onSignup }: Props) {
  const tts = useTTS()
  const [phase, setPhase] = useState<DemoPhase>('tap_to_start')
  const [sttOpen, setSttOpen] = useState(false)
  const [directPlaying, setDirectPlaying] = useState(false)
  const [needsInteraction, setNeedsInteraction] = useState(false)
  const [liveResponseText, setLiveResponseText] = useState('')
  const [visitorQuestionText, setVisitorQuestionText] = useState('')

  // Audio-synced reveal state
  const [revealedContent, setRevealedContent] = useState('')
  const [demoStreaming, setDemoStreaming] = useState(false)

  // Inworld WebRTC realtime state
  const [realtimeAvailable, setRealtimeAvailable] = useState<boolean | null>(null)
  const [realtimeText, setRealtimeText] = useState('')

  const mountedRef = useRef(true)
  const directAudioRef = useRef<HTMLAudioElement | null>(null)
  const pendingAudioUrlRef = useRef<string | null>(null)
  const phaseRef = useRef(phase)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const revealRafRef = useRef<number | null>(null)
  // Holds live response text until TTS audio actually starts playing (sync)
  const pendingResponseRef = useRef<string | null>(null)
  phaseRef.current = phase

  const briefApp = getApp('brief')
  const chatApp = getApp('chat')

  const briefTokensRef = useRef(tokenize(DEMO_BRIEF_MARKDOWN))
  const qaTokensRef = useRef(tokenize(DEMO_QA_RESPONSE))

  // ── Inworld WebRTC realtime hook ──────────────────────────────────────
  const inworld = useInworldRealtime({
    onTextDelta: (delta) => {
      setRealtimeText(prev => prev + delta)
    },
    onResponseDone: () => {
      inworld.disconnect()
      // Give visitor time to read the response before CTA
      setTimeout(() => {
        if (!mountedRef.current) return
        setPhase('cta')
      }, 3000)
    },
    onError: (err) => {
      console.warn('[Demo] WebRTC error, falling back:', err)
      inworld.disconnect()
      // Fall back to existing STT flow
      setPhase('visitor_listening')
      setSttOpen(true)
    },
  })

  // ── Cleanup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      tts.stop()
      inworld.disconnect()
      if (directAudioRef.current) {
        directAudioRef.current.pause()
        directAudioRef.current = null
      }
      if (pollRef.current) clearInterval(pollRef.current)
      if (revealRafRef.current) cancelAnimationFrame(revealRafRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Pre-fetch TTS + check realtime availability on mount ──────────────
  useEffect(() => {
    const warmCache = (stepKey: string) => {
      fetch(`/api/onboarding/tts?step=${stepKey}`).then(r => r.ok ? r.json() : []).then((v: VoiceEntry[]) => {
        if (v.length === 0) {
          fetch('/api/onboarding/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step: stepKey }),
          }).catch((err) => console.warn('[SelfDemoImmersive] TTS cache warm POST failed', err))
        }
      }).catch((err) => console.warn('[SelfDemoImmersive] TTS cache warm GET failed', err))
    }
    warmCache('demo_welcome')
    warmCache('demo_brief')
    warmCache('demo_qa')
    warmCache('demo_qa_user')
    warmCache('demo_your_turn')

    // Check if Inworld WebRTC is available (non-blocking)
    fetch('/api/demo/realtime/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    })
      .then(r => setRealtimeAvailable(r.ok))
      .catch(() => setRealtimeAvailable(false))
  }, [])

  // ── Auto-start on desktop (immediate) ─────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      if (phaseRef.current === 'tap_to_start') {
        startDemo()
      }
    }, 0)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Audio-synced progressive reveal ───────────────────────────────────

  function startReveal(audio: HTMLAudioElement, tokens: string[], fullText: string) {
    if (revealRafRef.current) cancelAnimationFrame(revealRafRef.current)

    setRevealedContent('')
    setDemoStreaming(true)

    function tick() {
      if (!mountedRef.current) return

      if (audio.ended || audio.paused) {
        setRevealedContent(fullText)
        setDemoStreaming(false)
        return
      }

      if (!audio.duration || isNaN(audio.duration)) {
        revealRafRef.current = requestAnimationFrame(tick)
        return
      }

      const progress = Math.min(audio.currentTime / audio.duration, 1)
      const idx = Math.min(Math.floor(progress * tokens.length), tokens.length)
      setRevealedContent(tokens.slice(0, idx).join(''))

      if (progress < 1) {
        revealRafRef.current = requestAnimationFrame(tick)
      } else {
        setRevealedContent(fullText)
        setDemoStreaming(false)
      }
    }

    revealRafRef.current = requestAnimationFrame(tick)
  }

  function stopReveal(fullText?: string) {
    if (revealRafRef.current) {
      cancelAnimationFrame(revealRafRef.current)
      revealRafRef.current = null
    }
    if (fullText) setRevealedContent(fullText)
    setDemoStreaming(false)
  }

  // Called when audio actually starts playing — kicks off synced reveal
  // or shows pending live response text (so text + speech are in sync)
  function onAudioStart(audio: HTMLAudioElement) {
    const p = phaseRef.current
    if (p === 'brief_playing') {
      startReveal(audio, briefTokensRef.current, DEMO_BRIEF_MARKDOWN)
    } else if (p === 'qa_playing') {
      startReveal(audio, qaTokensRef.current, DEMO_QA_RESPONSE)
    } else if (p === 'visitor_response_playing' || p === 'response_playing') {
      // Show response text only when audio starts — keeps text + speech synced
      if (pendingResponseRef.current) {
        setLiveResponseText(pendingResponseRef.current)
        pendingResponseRef.current = null
      }
    }
  }

  // ── TTS playback ──────────────────────────────────────────────────────
  const playStep = useCallback(async (text: string, stepKey?: string) => {
    const assetId = stableAssetId(text)
    try {
      const url = stepKey
        ? `/api/onboarding/tts?step=${stepKey}`
        : `/api/onboarding/tts?assetId=${encodeURIComponent(assetId)}`
      const res = await fetch(url)
      if (res.ok) {
        const voices = await res.json() as VoiceEntry[]
        if (voices.length > 0) {
          playAudio(
            `/api/onboarding/tts/play?assetId=${encodeURIComponent(assetId)}&voiceId=${encodeURIComponent(voices[0].id)}`,
          )
          return
        }
      }
    } catch { /* cache miss */ }
    generateAndPlay(text, assetId, stepKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function playAudio(url: string) {
    if (directAudioRef.current) {
      directAudioRef.current.pause()
      directAudioRef.current = null
    }
    const audio = new Audio(url)
    directAudioRef.current = audio
    setDirectPlaying(true)

    audio.addEventListener('playing', () => {
      if (mountedRef.current) onAudioStart(audio)
    }, { once: true })

    audio.onended = () => {
      directAudioRef.current = null
      setDirectPlaying(false)
      pendingAudioUrlRef.current = null
      if (mountedRef.current) onAudioEnd()
    }
    audio.onerror = () => {
      directAudioRef.current = null
      setDirectPlaying(false)
      pendingAudioUrlRef.current = null
      if (mountedRef.current) onAudioEnd()
    }

    speechStart()
    audio.play().catch(() => {
      setDirectPlaying(false)
      pendingAudioUrlRef.current = url
      setNeedsInteraction(true)
    })
  }

  async function generateAndPlay(text: string, assetId: string, stepKey?: string) {
    setDirectPlaying(true)
    try {
      const body = stepKey ? { step: stepKey } : { text, assetId }
      const res = await fetch('/api/onboarding/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { setDirectPlaying(false); onAudioEnd(); return }

      const data = await res.json() as { jobId: string; assetId: string }
      const started = Date.now()

      pollRef.current = setInterval(async () => {
        try {
          const pr = await fetch(`/api/onboarding/tts?jobId=${encodeURIComponent(data.jobId)}`)
          const pd = await pr.json() as { status: string; entry?: VoiceEntry }
          if (pd.status === 'done' && pd.entry) {
            if (pollRef.current) clearInterval(pollRef.current)
            playAudio(
              `/api/onboarding/tts/play?assetId=${encodeURIComponent(data.assetId)}&voiceId=${encodeURIComponent(pd.entry.id)}`,
            )
          } else if (pd.status === 'failed' || Date.now() - started > 300_000) {
            if (pollRef.current) clearInterval(pollRef.current)
            setDirectPlaying(false)
            onAudioEnd()
          }
        } catch { /* keep polling */ }
      }, 3000)
    } catch {
      setDirectPlaying(false)
      onAudioEnd()
    }
  }

  // ── Phase transitions after TTS ends ──────────────────────────────────
  function onAudioEnd() {
    if (!mountedRef.current) return
    const p = phaseRef.current
    switch (p) {
      case 'welcome':
        setPhase('brief_playing')
        playStep(DEMO_BRIEF_TTS, 'demo_brief')
        break
      case 'brief_playing':
        stopReveal(DEMO_BRIEF_MARKDOWN)
        setPhase('brief_to_qa')
        setTimeout(() => {
          if (!mountedRef.current) return
          setPhase('qa_user_speaking')
          playStep(DEMO_QA_USER_TTS, 'demo_qa_user')
        }, 1000)
        break
      case 'qa_user_speaking':
        setRevealedContent('')  // Clear stale brief content before Q&A reveal
        setPhase('qa_playing')
        playStep(DEMO_QA_TTS, 'demo_qa')
        break
      case 'qa_playing':
        stopReveal(DEMO_QA_RESPONSE)
        setPhase('your_turn')
        playStep(DEMO_YOUR_TURN_TTS, 'demo_your_turn')
        break
      case 'your_turn':
        if (realtimeAvailable) {
          // Use Inworld WebRTC — realtime voice-to-voice
          setPhase('visitor_realtime')
          setRealtimeText('')
          inworld.connect().then(ok => {
            if (!ok && mountedRef.current) {
              // WebRTC failed to connect — fall back to STT
              console.warn('[Demo] WebRTC connect failed, using fallback')
              setPhase('visitor_listening')
              setSttOpen(true)
            }
          })
        } else {
          // Fallback — STT via VoiceImmersive + /api/demo/respond + TTS
          setPhase('visitor_listening')
          setSttOpen(true)
        }
        break
      case 'visitor_response_playing':
        // Give visitor time to read the response before CTA
        setTimeout(() => {
          if (!mountedRef.current) return
          setPhase('cta')
        }, 3000)
        break
      case 'response_playing':
        setPhase('cta_after_interrupt')
        break
    }
  }

  // ── Demo start ────────────────────────────────────────────────────────
  function startDemo() {
    setPhase('welcome')
    playStep(DEMO_WELCOME_TTS, 'demo_welcome')
  }

  // ── Interrupt (during scripted demo) ──────────────────────────────────
  function handleInterrupt() {
    if (directAudioRef.current) {
      directAudioRef.current.pause()
      directAudioRef.current = null
    }
    setDirectPlaying(false)
    stopReveal()
    if (pollRef.current) clearInterval(pollRef.current)

    setPhase('interrupted')
    setSttOpen(true)
  }

  // ── Voice result handlers ─────────────────────────────────────────────
  // Response text is stored in pendingResponseRef and only committed to state
  // when the TTS audio 'playing' event fires (onAudioStart), so the text
  // appearing on screen is synced to the actual speech.

  async function handleInterruptResult(text: string) {
    setSttOpen(false)
    setPhase('responding')

    try {
      const res = await fetch('/api/demo/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text }),
      })
      const data = await res.json() as { text: string }
      if (!mountedRef.current) return

      pendingResponseRef.current = data.text
      setPhase('response_playing')
      playStep(data.text)
    } catch {
      if (!mountedRef.current) return
      const fallback = "Great question. I'd love to dig into that — create your Myway and I'll have your full context to help."
      pendingResponseRef.current = fallback
      setPhase('response_playing')
      playStep(fallback)
    }
  }

  async function handleVisitorResult(text: string) {
    setSttOpen(false)
    setVisitorQuestionText(text)
    setPhase('visitor_responding')

    try {
      const res = await fetch('/api/demo/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text }),
      })
      const data = await res.json() as { text: string }
      if (!mountedRef.current) return

      pendingResponseRef.current = data.text
      setPhase('visitor_response_playing')
      playStep(data.text)
    } catch {
      if (!mountedRef.current) return
      const fallback = "Great question. I'd love to dig into that — create your Myway and I'll have your full context to help."
      pendingResponseRef.current = fallback
      setPhase('visitor_response_playing')
      playStep(fallback)
    }
  }

  function handleVoiceSubmit(text: string) {
    if (phaseRef.current === 'visitor_listening') {
      handleVisitorResult(text)
    } else {
      handleInterruptResult(text)
    }
  }

  function handleVoiceClose() {
    setSttOpen(false)
    if (phaseRef.current === 'visitor_listening' || phaseRef.current === 'interrupted') {
      setPhase('cta')
    }
  }

  // ── Tap handler ───────────────────────────────────────────────────────
  function handleTap() {
    if (phase === 'tap_to_start' || needsInteraction) {
      setNeedsInteraction(false)
      if (pendingAudioUrlRef.current) {
        playAudio(pendingAudioUrlRef.current)
        if (phase === 'tap_to_start') {
          setPhase('welcome')
        }
      } else {
        startDemo()
      }
      return
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────
  const isCta = phase === 'cta' || phase === 'cta_after_interrupt'
  const showAppPreview = phase === 'brief_playing' || phase === 'brief_to_qa'
    || phase === 'qa_user_speaking' || phase === 'qa_playing'
    || phase === 'your_turn' || phase === 'visitor_realtime'
    || phase === 'visitor_responding' || phase === 'visitor_response_playing'
  const showOrb = !isCta
  const canInterrupt = phase === 'welcome' || phase === 'brief_playing'
    || phase === 'brief_to_qa' || phase === 'qa_user_speaking' || phase === 'qa_playing'
  const orbColor = '#6366f1'

  // Which app is currently shown — CSS switches both are always mounted (zero layout shift).
  const isBriefPhase = phase === 'brief_playing' || phase === 'brief_to_qa'

  function getStatusLabel(): string {
    if (phase === 'tap_to_start' || needsInteraction) return 'Tap to start'
    if (phase === 'responding' || phase === 'visitor_responding') return 'Thinking...'
    if (phase === 'your_turn') return 'Your turn'
    if (phase === 'visitor_realtime') {
      return inworld.state === 'connecting' ? 'Connecting...'
        : realtimeText ? 'Speaking' : 'Listening...'
    }
    if (phase === 'visitor_listening') return 'Listening...'
    if (directPlaying) return 'Speaking'
    if (phase === 'interrupted') return 'Listening...'
    return ''
  }

  /** Build demoMessages for the brief app — single assistant response being revealed. */
  function getBriefMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
    // During active reveal, show only what's been revealed so far (empty → progressive)
    // After reveal completes (brief_to_qa and later), show full content
    if (phase === 'brief_playing') {
      return [{ role: 'assistant', content: revealedContent }]
    }
    return [{ role: 'assistant', content: DEMO_BRIEF_MARKDOWN }]
  }

  /** Build demoMessages for the chat app — scripted Q&A + optional live visitor exchange. */
  function getChatMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
    const msgs: Array<{ role: 'user' | 'assistant'; content: string }> = []

    // Scripted Q&A
    msgs.push({ role: 'user', content: DEMO_QA_USER_MESSAGE })
    if (phase === 'qa_playing') {
      // During active reveal, show only what's been revealed (empty → progressive)
      msgs.push({ role: 'assistant', content: revealedContent })
    } else if (phase !== 'qa_user_speaking') {
      msgs.push({ role: 'assistant', content: DEMO_QA_RESPONSE })
    }

    // Visitor's live question + response (fallback flow)
    if (visitorQuestionText && (phase === 'visitor_responding' || phase === 'visitor_response_playing')) {
      msgs.push({ role: 'user', content: visitorQuestionText })
      if (phase === 'visitor_responding') {
        // Empty assistant message triggers loading dots in AppShell
        msgs.push({ role: 'assistant', content: '' })
      } else if (liveResponseText) {
        msgs.push({ role: 'assistant', content: liveResponseText })
      }
    }

    // Inworld WebRTC realtime — text arrives as AI speaks
    if (phase === 'visitor_realtime' && realtimeText) {
      msgs.push({ role: 'assistant', content: realtimeText })
    }

    return msgs
  }

  const briefStreaming = isBriefPhase ? demoStreaming : false
  const chatStreaming = phase === 'qa_playing' ? demoStreaming
    : phase === 'visitor_responding' ? true
    : phase === 'visitor_realtime' && inworld.state === 'connected' && realtimeText ? true
    : false

  const isRealtimeSpeaking = phase === 'visitor_realtime' && realtimeText
  const orbScale = (directPlaying || isRealtimeSpeaking) ? 1.05 : needsInteraction || phase === 'tap_to_start' ? 1.0 : 0.9

  /** Render the orb button. When `compact`, uses smaller size for bottom-right position. */
  function renderOrb(compact?: boolean) {
    const size = compact ? 'w-16 h-16' : 'w-24 h-24'
    const iconSize = compact ? 18 : 24
    const ringOuter = compact ? 'inset-[-8px]' : 'inset-[-12px]'
    const ringInner = compact ? 'inset-[-4px]' : 'inset-[-6px]'

    return (
      <button
        onClick={handleTap}
        disabled={!needsInteraction && phase !== 'tap_to_start'}
        className={`relative ${size} rounded-full flex items-center justify-center
                   transition-transform duration-500 ease-out cursor-pointer pointer-events-auto
                   focus:outline-none disabled:cursor-default shrink-0`}
        style={{ transform: `scale(${orbScale})` }}
        aria-label={needsInteraction || phase === 'tap_to_start' ? 'Tap to start' : 'Myway demo'}
      >
        <div className={`absolute inset-0 rounded-full transition-opacity duration-700
                         ${directPlaying || isRealtimeSpeaking || phase === 'visitor_realtime' || needsInteraction || phase === 'tap_to_start' ? 'opacity-100' : 'opacity-0'}`}>
          <div
            className={`absolute ${ringOuter} rounded-full voice-ring-outer`}
            style={{ background: `radial-gradient(circle, ${orbColor}20, transparent 70%)` }}
          />
          <div
            className={`absolute ${ringInner} rounded-full voice-ring-inner`}
            style={{ background: `radial-gradient(circle, ${orbColor}30, transparent 60%)` }}
          />
        </div>

        <div
          className={`w-full h-full rounded-full flex items-center justify-center
                     transition-all duration-500
                     ${(directPlaying || isRealtimeSpeaking) ? 'voice-orb-active' : 'voice-orb-idle'}`}
          style={{
            background: (directPlaying || isRealtimeSpeaking)
              ? `radial-gradient(circle at 40% 40%, ${orbColor}ee, ${orbColor}88 50%, ${orbColor}44)`
              : `radial-gradient(circle at 40% 40%, ${orbColor}88, ${orbColor}44 50%, ${orbColor}22)`,
            boxShadow: (directPlaying || isRealtimeSpeaking)
              ? `0 0 60px ${orbColor}40, 0 0 120px ${orbColor}20`
              : `0 0 30px ${orbColor}20`,
          }}
        >
          {(phase === 'responding' || phase === 'visitor_responding') ? (
            <span className="inline-flex gap-1 items-center">
              <span className="w-2 h-2 bg-white/60 rounded-full animate-breathe-dot" />
              <span className="w-2 h-2 bg-white/60 rounded-full animate-breathe-dot [animation-delay:400ms]" />
              <span className="w-2 h-2 bg-white/60 rounded-full animate-breathe-dot [animation-delay:800ms]" />
            </span>
          ) : (
            <Mic
              size={iconSize}
              className={`transition-all duration-300
                         ${phase === 'interrupted' || phase === 'visitor_listening' || phase === 'visitor_realtime' ? 'text-white scale-110' : 'text-white/70 scale-100'}`}
            />
          )}
        </div>
      </button>
    )
  }

  return (
    <div
      className="absolute inset-0 z-[10000] flex flex-col items-center
                 bg-black/95 backdrop-blur-3xl rounded-[inherit]
                 animate-[voice-in_0.4s_cubic-bezier(0.16,1,0.3,1)]"
    >
      <div
        className="absolute inset-0 -z-10 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 40%, rgba(99,102,241,0.08) 0%, transparent 60%)',
        }}
      />

      {/* ── App layer — full screen, exactly as real apps render ──────── */}
      {/* Override AppPage's h-dvh/min-h-screen/py-8 so the app fills this
          container instead of sizing to the viewport. */}
      <div className={showAppPreview
        ? 'absolute inset-0 overflow-hidden [&>div>div]:!h-full [&>div>div]:!min-h-0 [&>div>div]:!p-0'
        : 'hidden'}>
        {/* Briefing AI — visible during brief phases */}
        <div className={isBriefPhase ? 'h-full' : 'hidden'}>
          {briefApp && (
            <GenericApp
              app={briefApp}
              demo
              demoMessages={getBriefMessages()}
              demoStreaming={briefStreaming}
            />
          )}
        </div>

        {/* Chat — visible during Q&A and visitor phases */}
        <div className={!isBriefPhase ? 'h-full' : 'hidden'}>
          {chatApp && (
            <GenericApp
              app={chatApp}
              demo
              demoMessages={getChatMessages()}
              demoStreaming={chatStreaming}
            />
          )}
        </div>
      </div>

      {isCta ? (
        /* ── CTA overlay ────────────────────────────────────────────── */
        <div className="flex flex-col items-center justify-center flex-1 gap-6 px-8 max-w-md w-full animate-[fade-up_0.5s_ease-out]">
          {phase === 'cta_after_interrupt' && liveResponseText && (
            <p className="text-white/80 text-base text-center leading-relaxed mb-4">
              {liveResponseText}
            </p>
          )}

          <div className="flex flex-col items-center gap-3">
            <Sparkles size={32} className="text-indigo-400" />
            <h2 className="text-white text-2xl font-bold tracking-tight text-center">
              That was Myway.
            </h2>
            <p className="text-white/50 text-sm text-center leading-relaxed">
              {phase === 'cta_after_interrupt'
                ? 'Imagine it knowing everything about you.'
                : 'Your morning brief. Your priorities. Your AI.'}
            </p>
          </div>

          <div className="flex flex-col gap-3 w-full mt-4">
            <button
              onClick={onSignup}
              className="w-full py-4 rounded-2xl bg-indigo-500 hover:bg-indigo-400
                         text-white font-semibold text-base transition-colors
                         active:scale-[0.98]"
            >
              Create your Myway — free
            </button>
            <button
              onClick={onComplete}
              className="text-white/30 text-xs hover:text-white/50 transition-colors py-2"
            >
              Skip
            </button>
          </div>
        </div>
      ) : (
        /* ── Demo overlay — orb + controls float above the app ─────── */
        <div className="absolute inset-0 z-10 flex flex-col items-center pointer-events-none">
          {/* Orb: centered when no app, bottom-right when GenericApp is showing */}
          {!showAppPreview ? (
            /* ── Non-app phases: orb centered on screen ─────────── */
            <div className="flex flex-col items-center flex-1 justify-center">
              {/* Status label */}
              <p className="text-white/40 text-xs font-medium tracking-widest uppercase mb-4 select-none h-4">
                {getStatusLabel()}
              </p>

              {showOrb && renderOrb()}

              {/* Live response text — interrupt flow only */}
              {phase === 'response_playing' && liveResponseText && (
                <div className="mt-4 px-8 max-w-md w-full animate-[fade-up_0.3s_ease-out]">
                  <p className="text-white/80 text-sm text-center leading-relaxed">
                    {liveResponseText}
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* ── App phases: orb at bottom-right, above interrupt button ── */
            <>
              {showOrb && (
                <div className="absolute bottom-40 left-1/2 -translate-x-1/2 flex flex-col items-center z-20
                                animate-[fade-up_0.3s_ease-out]">
                  <p className="text-white/40 text-[10px] font-medium tracking-widest uppercase mb-2 select-none h-3">
                    {getStatusLabel()}
                  </p>
                  {renderOrb(true)}
                </div>
              )}
            </>
          )}

          {/* Interrupt button */}
          {canInterrupt && (
            <div className="mt-auto mb-20 flex justify-center pointer-events-auto
                            animate-[fade-up_0.3s_ease-out]">
              <button
                onClick={handleInterrupt}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full
                           bg-white/[0.10] border border-white/[0.15]
                           hover:bg-white/[0.18] hover:border-white/[0.22]
                           transition-all active:scale-[0.97] backdrop-blur-sm"
              >
                <Mic size={14} className="text-white/70" />
                <span className="text-white/70 text-xs font-medium">
                  Interrupt and ask your own question
                </span>
                <ArrowRight size={12} className="text-white/40" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Skip button */}
      {!isCta && (
        <button
          onClick={onComplete}
          className="absolute bottom-6 text-white/15 text-[11px] hover:text-white/30
                     transition-colors px-4 py-2 z-30"
        >
          Skip demo
        </button>
      )}

      <VoiceImmersive
        open={sttOpen}
        onClose={handleVoiceClose}
        onSubmit={handleVoiceSubmit}
        appName="Myway"
        appColor={orbColor}
      />
    </div>
  )
}
