'use client'

/**
 * OnboardingImmersive — full-screen, voice-first onboarding.
 *
 * All 3 steps use the SAME pattern:
 *   1. Pre-cached TTS plays
 *   2. Audio ends → VoiceImmersive opens for STT
 *   3. User speaks → extract info client-side → fire API in background
 *   4. Immediately play next pre-cached TTS (no API await)
 *
 * Only the final magic moment awaits an API response.
 *
 * TTS caching: stableAssetId(text) = deterministic hash.
 * Same text = same cache key = shared across all users.
 * Step 3 includes timezone city name, so all users in same TZ share cache.
 *
 * All data saved server-side. No localStorage.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Mic, ArrowRight, Moon, MessageCircle, LayoutGrid } from 'lucide-react'
import { useTTS } from '@/hooks/useTTS'
import { stableAssetId } from '@/lib/tts'
import type { VoiceEntry } from '@/lib/tts'
import { signalInstallValue } from '@/components/InstallPrompt'
import { speechStart, micStart } from '@/lib/haptics'
import VoiceImmersive from '@/components/VoiceImmersive'

// ─── Types ──────────────────────────────────────────────────────────────────

type Phase =
  | 'greeting'       // TTS playing: pre-cached greeting
  | 'awaiting_name'  // STT open for name
  | 'step2'          // TTS playing: pre-cached "What's on your mind?"
  | 'awaiting_goal'  // STT open for goal
  | 'step3'          // TTS playing: pre-cached "I see you're in {tz}..."
  | 'awaiting_plans' // STT open for plans
  | 'loading_magic'  // Waiting for magic moment from API
  | 'magic_moment'   // TTS playing: personalized magic moment
  | 'next_steps'     // Cards

type Props = {
  prefillName?: string
  resumeStep?: string | null   // ignored — always starts fresh
  resumeName?: string | null   // ignored
  visitor?: boolean
  onComplete: () => void
}

// ─── Pre-cached phrases ─────────────────────────────────────────────────────
// These are the exact strings in ONBOARDING_PHRASES on the server.
// stableAssetId(text) produces the same cache key for all users.

const GREETING_TEXT =
  "Hey, I'm Myway. I'm going to be your personal AI — but first, what's your name?"

const STEP2_TEXT =
  "What's one thing on your mind today?"

/** Build step 3 text from IANA timezone. Deterministic → cacheable per TZ. */
function step3Text(ianaTz: string): string {
  const city = (ianaTz.split('/').pop() || ianaTz).replace(/_/g, ' ')
  return `I see you're in ${city}. Hope I'm right? What do you have planned for today?`
}

/** Simple client-side name extraction (1–3 words → capitalize). */
function extractNameLocal(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'friend'
  // Common patterns
  const patterns = [
    /(?:my name is|i'm|i am|call me|it's|they call me)\s+(.+)/i,
    /^(?:hi|hey|hello),?\s*(?:i'm|i am|my name is)\s+(.+)/i,
  ]
  for (const p of patterns) {
    const m = trimmed.match(p)
    if (m?.[1]) {
      return m[1].trim().split(/\s+/).slice(0, 3)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    }
  }
  // 1–3 words: treat as name
  const words = trimmed.split(/\s+/)
  if (words.length <= 3) {
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  }
  // Longer: just capitalize first word
  return words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase()
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function OnboardingImmersive({
  visitor = false,
  onComplete,
}: Props) {
  const router = useRouter()
  const tts = useTTS()

  const [phase, setPhase] = useState<Phase>('greeting')
  const [aiText, setAiText] = useState('')
  const [userName, setUserName] = useState('')
  const [textInput, setTextInput] = useState('')
  const [magicText, setMagicText] = useState('')
  const [directPlaying, setDirectPlaying] = useState(false)
  const [needsInteraction, setNeedsInteraction] = useState(false)
  const [sttOpen, setSttOpen] = useState(false)

  const pendingAudioUrlRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const directAudioRef = useRef<HTMLAudioElement | null>(null)
  const onboardingPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // Guard against VoiceImmersive's delayed onClose (600ms after submit)
  // killing a newly opened STT session. When true, onClose is ignored.
  const wantSttRef = useRef(false)

  const browserTimezone = useRef(
    typeof window !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC',
  )

  // ── Cleanup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      tts.stop()
      if (directAudioRef.current) {
        directAudioRef.current.pause()
        directAudioRef.current = null
      }
      if (onboardingPollRef.current) {
        clearInterval(onboardingPollRef.current)
        onboardingPollRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Pre-fetch all TTS on mount ──────────────────────────────────────────
  // Fire-and-forget: ensure step2 + step3 audio is generated so it's
  // already in cache when we need it. Greeting is likely cached from prior visits.
  useEffect(() => {
    const warmCache = (text: string, stepKey?: string) => {
      const cacheUrl = stepKey
        ? `/api/onboarding/tts?step=${stepKey}`
        : `/api/onboarding/tts?assetId=${encodeURIComponent(stableAssetId(text))}`
      fetch(cacheUrl).then(r => r.ok ? r.json() : []).then((v: VoiceEntry[]) => {
        if (v.length === 0) {
          const body = stepKey ? { step: stepKey } : { text, assetId: stableAssetId(text) }
          fetch('/api/onboarding/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).catch((err) => console.warn('[OnboardingImmersive] TTS cache warm POST failed', err))
        }
      }).catch((err) => console.warn('[OnboardingImmersive] TTS cache warm GET failed', err))
    }
    warmCache(GREETING_TEXT, 'greeting')
    warmCache(STEP2_TEXT, 'step2')
    warmCache(step3Text(browserTimezone.current))
  }, [])

  // ── Always start with greeting ──────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      setAiText(GREETING_TEXT)
      playStep(GREETING_TEXT, 'greeting')
    }, 400)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── TTS playback ────────────────────────────────────────────────────────
  // Single path for all TTS: check cache → play from cache OR generate → play.

  const playStep = useCallback(async (text: string, stepKey?: string) => {
    const assetId = stableAssetId(text)

    // Check cache first
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

    // Not cached — generate
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

    audio.onended = () => {
      directAudioRef.current = null
      setDirectPlaying(false)
      pendingAudioUrlRef.current = null
      if (mountedRef.current) openStt()
    }
    audio.onerror = () => {
      directAudioRef.current = null
      setDirectPlaying(false)
      pendingAudioUrlRef.current = null
      if (mountedRef.current) openStt()
    }

    speechStart()
    audio.play().catch(() => {
      // Autoplay blocked — show tap prompt
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
      if (!res.ok) { setDirectPlaying(false); openStt(); return }

      const data = await res.json() as { jobId: string; assetId: string }
      const started = Date.now()

      const poll = setInterval(async () => {
        try {
          const pr = await fetch(`/api/onboarding/tts?jobId=${encodeURIComponent(data.jobId)}`)
          const pd = await pr.json() as { status: string; entry?: VoiceEntry }

          if (pd.status === 'done' && pd.entry) {
            clearInterval(poll)
            playAudio(
              `/api/onboarding/tts/play?assetId=${encodeURIComponent(data.assetId)}&voiceId=${encodeURIComponent(pd.entry.id)}`,
            )
          } else if (pd.status === 'failed' || Date.now() - started > 300_000) {
            clearInterval(poll)
            setDirectPlaying(false)
            openStt()
          }
        } catch { /* keep polling */ }
      }, 3000)
      onboardingPollRef.current = poll
    } catch {
      setDirectPlaying(false)
      openStt()
    }
  }

  // ── After TTS ends → open STT ─────────────────────────────────────────
  function openStt() {
    if (!mountedRef.current) return
    micStart()

    const p = phaseRef.current
    switch (p) {
      case 'greeting':
        setPhase('awaiting_name')
        wantSttRef.current = true
        setSttOpen(true)
        break
      case 'step2':
        setPhase('awaiting_goal')
        wantSttRef.current = true
        setSttOpen(true)
        break
      case 'step3':
        setPhase('awaiting_plans')
        wantSttRef.current = true
        setSttOpen(true)
        break
      case 'magic_moment':
        setPhase('next_steps')
        signalInstallValue()
        break
    }
  }

  // ── Handle voice/text results ───────────────────────────────────────────

  function handleVoiceResult(text: string) {
    wantSttRef.current = false
    setSttOpen(false)
    switch (phaseRef.current) {
      case 'awaiting_name':  submitName(text); break
      case 'awaiting_goal':  submitGoal(text); break
      case 'awaiting_plans': submitPlans(text); break
    }
  }

  function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = textInput.trim()
    if (!text) return
    setTextInput('')
    handleVoiceResult(text)
  }

  // ── Step handlers ─────────────────────────────────────────────────────
  // Steps 1–3: extract client-side, play next pre-cached TTS, fire API in bg.
  // Only the magic moment awaits the API.

  function submitName(value: string) {
    const name = extractNameLocal(value)
    setUserName(name)

    // Immediately play step 2 (pre-cached)
    setAiText(STEP2_TEXT)
    setPhase('step2')
    playStep(STEP2_TEXT, 'step2')

    // Fire fact extraction in background
    fetch('/api/onboarding/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'name', value }),
    }).catch((err) => console.warn('[OnboardingImmersive] name extraction failed', err))
  }

  function submitGoal(value: string) {
    const s3 = step3Text(browserTimezone.current)

    // Immediately play step 3 (pre-cached per timezone)
    setAiText(s3)
    setPhase('step3')
    playStep(s3)

    // Fire fact extraction + magic moment pre-gen in background
    fetch('/api/onboarding/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step: 'goal',
        value,
        browserTimezone: browserTimezone.current,
      }),
    }).catch((err) => console.warn('[OnboardingImmersive] goal extraction failed', err))
  }

  async function submitPlans(value: string) {
    setPhase('loading_magic')
    setAiText('')

    try {
      const res = await fetch('/api/onboarding/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'plans', value }),
      })
      const data = await res.json() as { text: string }
      if (!mountedRef.current) return

      setMagicText(data.text)
      setAiText(data.text)
      setPhase('magic_moment')
      playStep(data.text)
    } catch {
      if (!mountedRef.current) return
      const fallback = `Welcome home, ${userName || 'friend'}. I'm here whenever you need me — let's make something happen.`
      setMagicText(fallback)
      setAiText(fallback)
      setPhase('magic_moment')
      playStep(fallback)
    }
  }

  // ── Tap orb ──────────────────────────────────────────────────────────
  function handleTapOrb() {
    if (needsInteraction && pendingAudioUrlRef.current) {
      setNeedsInteraction(false)
      playAudio(pendingAudioUrlRef.current)
      return
    }
    if (isAwaitingInput) {
      setSttOpen(true)
    }
  }

  // ── Navigation ──────────────────────────────────────────────────────────
  const hour = new Date().getHours()
  const isNighttime = hour >= 21 || hour < 5

  function handleNextStep(route: string) {
    tts.stop()
    onComplete()
    router.push(route)
  }

  // ── Derived state ─────────────────────────────────────────────────────
  const isAwaitingInput = phase === 'awaiting_name' || phase === 'awaiting_goal' || phase === 'awaiting_plans'
  const isProcessing = phase === 'loading_magic'
  const isSpeaking = directPlaying
  const showOrb = phase !== 'next_steps'
  const orbColor = '#6366f1'
  const orbScale = isSpeaking ? 1.05 : needsInteraction ? 1.0 : isAwaitingInput ? 0.95 : 0.9

  function getStatusLabel(): string {
    if (needsInteraction) return 'Tap to begin'
    if (isProcessing) return 'Thinking...'
    if (isSpeaking) return 'Speaking'
    if (isAwaitingInput) return 'Tap to speak'
    return ''
  }

  function getPlaceholder(): string {
    switch (phase) {
      case 'awaiting_name':  return 'or type your name...'
      case 'awaiting_goal':  return 'or type what\'s on your mind...'
      case 'awaiting_plans': return 'or type your plans...'
      default: return ''
    }
  }

  return (
    <div
      className="absolute inset-0 z-[10000] flex flex-col items-center justify-center
                 bg-black/95 backdrop-blur-3xl rounded-[inherit]
                 animate-[voice-in_0.4s_cubic-bezier(0.16,1,0.3,1)]"
    >
      <div
        className="absolute inset-0 -z-10 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 40%, rgba(99,102,241,0.08) 0%, transparent 60%)',
        }}
      />

      {phase === 'next_steps' ? (
        <div className="flex flex-col items-center gap-8 px-8 max-w-md w-full animate-[fade-up_0.5s_ease-out]">
          <p className="text-white/90 text-lg text-center leading-relaxed">
            {magicText}
          </p>

          <div className="flex flex-col gap-3 w-full mt-4">
            <button
              onClick={() => handleNextStep(isNighttime ? '/apps/somni' : '/apps/brief')}
              className="group flex items-center gap-4 p-4 rounded-2xl
                         bg-white/[0.08] border border-white/[0.12]
                         hover:bg-white/[0.12] hover:border-white/[0.18]
                         transition-all active:scale-[0.98]"
            >
              <div className="w-11 h-11 rounded-xl bg-indigo-500/20 flex items-center justify-center shrink-0">
                {isNighttime ? <Moon size={20} className="text-indigo-300" /> : <ArrowRight size={20} className="text-indigo-300" />}
              </div>
              <div className="flex-1 text-left">
                <p className="text-white font-semibold text-[15px]">
                  {isNighttime ? 'Try a bedtime story' : 'Open your Morning Brief'}
                </p>
                <p className="text-white/40 text-xs mt-0.5">
                  {isNighttime ? 'AI-generated, just for you' : 'See what matters today'}
                </p>
              </div>
            </button>

            <button
              onClick={() => handleNextStep('/apps/chat')}
              className="group flex items-center gap-4 p-4 rounded-2xl
                         bg-white/[0.06] border border-white/[0.08]
                         hover:bg-white/[0.10] hover:border-white/[0.14]
                         transition-all active:scale-[0.98]"
            >
              <div className="w-11 h-11 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0">
                <MessageCircle size={20} className="text-blue-300" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-white font-semibold text-[15px]">Try asking me something</p>
                <p className="text-white/40 text-xs mt-0.5">Full AI access, fully private</p>
              </div>
            </button>

            <button
              onClick={() => { onComplete(); router.push('/') }}
              className="group flex items-center gap-4 p-4 rounded-2xl
                         bg-white/[0.04] border border-white/[0.06]
                         hover:bg-white/[0.08] hover:border-white/[0.10]
                         transition-all active:scale-[0.98]"
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                <LayoutGrid size={20} className="text-emerald-300" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-white font-semibold text-[15px]">Explore your apps</p>
                <p className="text-white/40 text-xs mt-0.5">14 apps, all yours</p>
              </div>
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-white/40 text-xs font-medium tracking-widest uppercase mb-8 select-none">
            {getStatusLabel()}
          </p>

          {showOrb && (
            <button
              onClick={handleTapOrb}
              disabled={!isAwaitingInput && !needsInteraction}
              className="relative w-32 h-32 rounded-full flex items-center justify-center
                         transition-transform duration-500 ease-out cursor-pointer
                         focus:outline-none disabled:cursor-default"
              style={{ transform: `scale(${orbScale})` }}
              aria-label={needsInteraction ? 'Tap to begin' : isAwaitingInput ? 'Tap to speak' : 'Myway is speaking'}
            >
              <div className={`absolute inset-0 rounded-full transition-opacity duration-700
                               ${isSpeaking || needsInteraction || isAwaitingInput ? 'opacity-100' : 'opacity-0'}`}>
                <div
                  className="absolute inset-[-16px] rounded-full voice-ring-outer"
                  style={{ background: `radial-gradient(circle, ${orbColor}20, transparent 70%)` }}
                />
                <div
                  className="absolute inset-[-8px] rounded-full voice-ring-inner"
                  style={{ background: `radial-gradient(circle, ${orbColor}30, transparent 60%)` }}
                />
              </div>

              <div
                className={`w-full h-full rounded-full flex items-center justify-center
                           transition-all duration-500
                           ${isSpeaking ? 'voice-orb-active' : 'voice-orb-idle'}`}
                style={{
                  background: isSpeaking
                    ? `radial-gradient(circle at 40% 40%, ${orbColor}ee, ${orbColor}88 50%, ${orbColor}44)`
                    : `radial-gradient(circle at 40% 40%, ${orbColor}88, ${orbColor}44 50%, ${orbColor}22)`,
                  boxShadow: isSpeaking
                    ? `0 0 60px ${orbColor}40, 0 0 120px ${orbColor}20`
                    : `0 0 30px ${orbColor}20`,
                }}
              >
                {isProcessing ? (
                  <span className="inline-flex gap-1 items-center">
                    <span className="w-2 h-2 bg-white/60 rounded-full animate-breathe-dot" />
                    <span className="w-2 h-2 bg-white/60 rounded-full animate-breathe-dot [animation-delay:400ms]" />
                    <span className="w-2 h-2 bg-white/60 rounded-full animate-breathe-dot [animation-delay:800ms]" />
                  </span>
                ) : (
                  <Mic
                    size={32}
                    className={`transition-all duration-300
                               ${isAwaitingInput ? 'text-white scale-110' : 'text-white/70 scale-100'}`}
                  />
                )}
              </div>
            </button>
          )}

          {aiText && (
            <div className="mt-8 px-8 max-w-md w-full">
              <p className="text-white/80 text-base text-center leading-relaxed animate-[fade-up_0.3s_ease-out]">
                {aiText}
              </p>
            </div>
          )}

          {isAwaitingInput && (
            <form
              onSubmit={handleTextSubmit}
              className="mt-6 px-8 max-w-md w-full animate-[fade-up_0.3s_ease-out]"
            >
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl
                              bg-white/[0.06] border border-white/[0.10]
                              focus-within:bg-white/[0.08] focus-within:border-white/[0.16]
                              transition-all">
                <input
                  type="text"
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  placeholder={getPlaceholder()}
                  className="flex-1 bg-transparent text-white placeholder-white/20 outline-none text-sm"
                  autoComplete="off"
                />
                {textInput.trim() && (
                  <button
                    type="submit"
                    className="shrink-0 w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center
                               hover:bg-indigo-400 transition-colors"
                  >
                    <ArrowRight size={14} className="text-white" />
                  </button>
                )}
              </div>
            </form>
          )}
        </>
      )}

      {phase !== 'next_steps' && (
        <button
          onClick={() => {
            tts.stop()
            setSttOpen(false)
            onComplete()
          }}
          className="absolute bottom-6 text-white/15 text-[11px] hover:text-white/30
                     transition-colors px-4 py-2"
        >
          Skip setup
        </button>
      )}

      <VoiceImmersive
        open={sttOpen}
        onClose={() => {
          // VoiceImmersive fires onClose 600ms after onSubmit.
          // If we've already opened a new STT session (wantSttRef=true),
          // ignore this stale close — it would kill the next session.
          if (!wantSttRef.current) setSttOpen(false)
        }}
        onSubmit={(text) => handleVoiceResult(text)}
        appName="Myway"
        appColor={orbColor}
      />
    </div>
  )
}
