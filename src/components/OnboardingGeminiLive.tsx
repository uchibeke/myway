'use client'

/**
 * OnboardingGeminiLive — voice-first onboarding using Gemini Live.
 *
 * Single persistent WebSocket session handles both audio input and output.
 * No separate TTS/STT — Gemini's native audio model speaks and listens
 * in real time, making the conversation feel natural.
 *
 * Flow:
 *   1. Fetch session config (API key + system prompt) from server
 *   2. Connect to Gemini Live with mic streaming
 *   3. Send initial prompt to kick off greeting immediately
 *   4. Gemini guides the conversation: name → goal → magic moment + closing
 *   5. On completion, POST full transcript to /api/onboarding/live/extract
 *   6. Show next-step cards (no text wall — AI already said the closing)
 *
 * Falls back to OnboardingImmersive if Gemini key missing, mic denied, etc.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Mic, Keyboard, ArrowRight, Moon, MessageCircle, LayoutGrid, Send } from 'lucide-react'
import { signalInstallValue } from '@/components/InstallPrompt'
import { micStart } from '@/lib/haptics'

type Phase =
  | 'init'          // fetching config + requesting mic
  | 'connecting'    // opening Gemini Live session
  | 'listening'     // AI is listening to user
  | 'speaking'      // AI is speaking
  | 'processing'    // saving facts after conversation
  | 'next_steps'    // cards
  | 'error'         // fallback

type Props = {
  onComplete: () => void
  onFallback: () => void
}

// ─── Audio helpers ──────────────────────────────────────────────────────────

function float32ToBase64PCM(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  const bytes = new Uint8Array(int16.buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64PCMToFloat32(base64: string): Float32Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const int16 = new Int16Array(bytes.buffer)
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff)
  }
  return float32
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function OnboardingGeminiLive({ onComplete, onFallback }: Props) {
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>('init')
  const [errorMsg, setErrorMsg] = useState('')
  const [liveUserText, setLiveUserText] = useState('')   // user's speech shown live
  const [liveModelText, setLiveModelText] = useState('')  // model's speech shown live
  const [showTextInput, setShowTextInput] = useState(false)
  const [typedText, setTypedText] = useState('')
  const textInputRef = useRef<HTMLInputElement>(null)

  const mountedRef = useRef(true)
  const initStartedRef = useRef(false)
  const sessionRef = useRef<any>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const playbackCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const isPlayingRef = useRef(false)
  const turnIndexRef = useRef(0)
  const phaseRef = useRef<Phase>('init')

  function updatePhase(p: Phase) { phaseRef.current = p; setPhase(p) }

  // Conversation data for extraction — just the raw transcript
  const currentUserTextRef = useRef('')
  const currentModelTextRef = useRef('')
  const fullTranscriptRef = useRef('')
  const conversationDoneRef = useRef(false) // true once AI's closing response detected
  const browserTimezoneRef = useRef(
    typeof window !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC',
  )

  const nextPlayTimeRef = useRef(0)

  // ── Cleanup ─────────────────────────────────────────────────────────────
  function teardown() {
    try { sessionRef.current?.close?.() } catch { /* */ }
    sessionRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    processorRef.current?.disconnect()
    processorRef.current = null
    sourceNodeRef.current?.disconnect()
    sourceNodeRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    playbackCtxRef.current?.close()
    playbackCtxRef.current = null
  }

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; teardown() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (initStartedRef.current) return
    initStartedRef.current = true
    initSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Init ────────────────────────────────────────────────────────────────
  async function initSession() {
    try {
      const configRes = await fetch('/api/onboarding/live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ browserTimezone: browserTimezoneRef.current }),
      })
      if (!configRes.ok) { onFallback(); return }
      const config = await configRes.json()
      if (!config.apiKey) { onFallback(); return }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        })
      } catch { onFallback(); return }
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      micStart()

      const audioCtx = new AudioContext({ sampleRate: 16000 })
      audioCtxRef.current = audioCtx
      const playbackCtx = new AudioContext({ sampleRate: 24000 })
      playbackCtxRef.current = playbackCtx

      if (!mountedRef.current) return
      updatePhase('connecting')

      const { GoogleGenAI, Modality } = await import('@google/genai')
      const ai = new GoogleGenAI({ apiKey: config.apiKey })

      const session = await ai.live.connect({
        model: config.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: config.systemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceName || 'Aoede' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            if (!mountedRef.current) return
            updatePhase('speaking')
          },
          onmessage: (message: any) => {
            if (!mountedRef.current) return
            handleServerMessage(message)
          },
          onerror: (e: any) => {
            console.error('[GeminiLive] error:', e)
            if (mountedRef.current) {
              setErrorMsg(`Connection error: ${e?.message || e}`)
              updatePhase('error')
              setTimeout(() => { if (mountedRef.current) onFallback() }, 2000)
            }
          },
          onclose: () => {
            if (!mountedRef.current) return
            // If the conversation closed before the AI finished its closing
            // response and we haven't started processing, fall back to text mode.
            if (!conversationDoneRef.current
                && phaseRef.current !== 'processing'
                && phaseRef.current !== 'next_steps') {
              // But if we have enough transcript, try to extract what we have
              if (turnIndexRef.current >= 3 && fullTranscriptRef.current.trim()) {
                finishOnboarding()
              } else {
                setTimeout(() => { if (mountedRef.current) onFallback() }, 1000)
              }
            }
          },
        },
      })

      if (!mountedRef.current) { session.close(); return }
      sessionRef.current = session

      // Kick off greeting
      session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: 'Start the onboarding conversation. Greet me.' }] }],
        turnComplete: true,
      })

      startMicStream(audioCtx, stream, session)
    } catch (err: any) {
      console.error('[GeminiLive] init failed:', err)
      if (mountedRef.current) {
        setErrorMsg(`Init failed: ${err?.message || err}`)
        updatePhase('error')
        setTimeout(() => { if (mountedRef.current) onFallback() }, 2000)
      }
    }
  }

  function startMicStream(audioCtx: AudioContext, stream: MediaStream, session: any) {
    const source = audioCtx.createMediaStreamSource(stream)
    sourceNodeRef.current = source
    const processor = audioCtx.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor

    processor.onaudioprocess = (e) => {
      if (!mountedRef.current) return
      const inputData = e.inputBuffer.getChannelData(0)
      try {
        const base64 = float32ToBase64PCM(inputData)
        session.sendRealtimeInput({
          audio: { data: base64, mimeType: 'audio/pcm;rate=16000' },
        })
      } catch { /* session closing */ }
    }

    source.connect(processor)
    const silentGain = audioCtx.createGain()
    silentGain.gain.value = 0
    processor.connect(silentGain)
    silentGain.connect(audioCtx.destination)
  }

  // ── Handle Gemini messages ──────────────────────────────────────────────
  function handleServerMessage(message: any) {
    const sc = message.serverContent
    if (!sc) return

    // User's speech transcription — show live on screen
    if (sc.inputTranscription?.text) {
      currentUserTextRef.current += sc.inputTranscription.text
      setLiveUserText(currentUserTextRef.current)
    }

    // Model's speech transcription
    if (sc.outputTranscription?.text) {
      currentModelTextRef.current += sc.outputTranscription.text
      setLiveModelText(currentModelTextRef.current)
    }

    // Model audio chunks
    if (sc.modelTurn?.parts) {
      updatePhase('speaking')
      setShowTextInput(false)
      setTypedText('')
      isPlayingRef.current = true
      for (const part of sc.modelTurn.parts) {
        if (part.inlineData?.data) {
          scheduleAudioChunk(base64PCMToFloat32(part.inlineData.data))
        }
      }
    }

    // Turn complete
    if (sc.turnComplete) {
      isPlayingRef.current = false

      // Append this turn's text to the running transcript
      const userText = currentUserTextRef.current.trim()
      if (userText) {
        fullTranscriptRef.current += `User: ${userText}\n`
      }
      const modelText = currentModelTextRef.current.trim()
      if (modelText) {
        fullTranscriptRef.current += `Myway: ${modelText}\n`

        // Detect the AI's closing response by looking for natural handoff phrases
        // from the system prompt (e.g. "let me show you", "morning briefing").
        const lower = modelText.toLowerCase()
        if (['let me show you', 'get you set up', 'show you what we',
             'morning briefing', 'morning brief', 'bunch of other apps',
             'built just for you'].some(s => lower.includes(s))) {
          conversationDoneRef.current = true
        }
      }

      // Reset per-turn accumulators
      currentUserTextRef.current = ''
      currentModelTextRef.current = ''
      setLiveUserText('')
      setLiveModelText('')

      turnIndexRef.current++

      // Finish when the AI has given its closing response (content-based),
      // OR as a safety fallback after 10 turns.
      // Minimum 3 turns required to avoid premature VAD-triggered endings.
      if ((conversationDoneRef.current && turnIndexRef.current >= 3) || turnIndexRef.current >= 10) {
        const ctx = playbackCtxRef.current
        const remaining = ctx ? Math.max(0, nextPlayTimeRef.current - ctx.currentTime) : 0
        setTimeout(() => finishOnboarding(), Math.ceil(remaining * 1000) + 500)
      } else {
        updatePhase('listening')
      }
    }
  }

  function scheduleAudioChunk(float32: Float32Array) {
    const ctx = playbackCtxRef.current
    if (!ctx) return
    const buffer = ctx.createBuffer(1, float32.length, 24000)
    buffer.getChannelData(0).set(float32)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    const now = ctx.currentTime
    const startTime = Math.max(now, nextPlayTimeRef.current)
    source.start(startTime)
    nextPlayTimeRef.current = startTime + buffer.duration
  }

  // ── Finish: extract + save ──────────────────────────────────────────────
  async function finishOnboarding() {
    if (!mountedRef.current) return
    updatePhase('processing')
    teardown()

    const transcript = fullTranscriptRef.current.trim()

    if (transcript) {
      try {
        const res = await fetch('/api/onboarding/live/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript,
            browserTimezone: browserTimezoneRef.current,
          }),
        })
        if (!res.ok) {
          console.error('[GeminiLive] extract failed:', res.status)
        }
      } catch (err) {
        console.error('[GeminiLive] extract error:', err)
      }
    }

    if (!mountedRef.current) return
    updatePhase('next_steps')
    signalInstallValue()
  }

  // ── Navigation ──────────────────────────────────────────────────────────
  const hour = new Date().getHours()
  const isNighttime = hour >= 21 || hour < 5

  function handleNextStep(route: string) {
    onComplete()
    router.push(route)
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const isSpeaking = phase === 'speaking'
  const isListening = phase === 'listening'
  const isLoading = phase === 'init' || phase === 'connecting' || phase === 'processing'
  const showOrb = phase !== 'next_steps' && phase !== 'error'
  const orbColor = '#6366f1'
  const orbScale = isSpeaking ? 1.05 : isListening ? 0.95 : 0.9

  function getStatusLabel(): string {
    if (phase === 'init') return 'Setting up...'
    if (phase === 'connecting') return 'Connecting...'
    if (phase === 'speaking') return ''
    if (phase === 'listening') return showTextInput ? '' : 'Listening...'
    if (phase === 'processing') return 'Setting things up...'
    return ''
  }

  /** Send typed text as if the user spoke it */
  const submitTypedText = useCallback(() => {
    const text = typedText.trim()
    if (!text || !sessionRef.current) return

    // Send as client content so model receives it as a user turn
    sessionRef.current.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    })

    // Record in transcript as if it was spoken
    currentUserTextRef.current = text
    setLiveUserText(text)
    setTypedText('')
    setShowTextInput(false)
  }, [typedText])

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
        <div className="flex flex-col items-center gap-6 px-8 max-w-md w-full animate-[fade-up_0.5s_ease-out]">
          <div className="flex flex-col gap-3 w-full">
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
          {getStatusLabel() && (
            <p className="text-white/40 text-xs font-medium tracking-widest uppercase mb-8 select-none">
              {getStatusLabel()}
            </p>
          )}

          {showOrb && (
            <div
              className="relative w-32 h-32 rounded-full flex items-center justify-center
                         transition-transform duration-500 ease-out"
              style={{ transform: `scale(${orbScale})` }}
            >
              <div className={`absolute inset-0 rounded-full transition-opacity duration-700
                               ${isSpeaking || isListening ? 'opacity-100' : 'opacity-0'}`}>
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
                           ${isSpeaking || isListening ? 'voice-orb-active' : 'voice-orb-idle'}`}
                style={{
                  background: isSpeaking || isListening
                    ? `radial-gradient(circle at 40% 40%, ${orbColor}ee, ${orbColor}88 50%, ${orbColor}44)`
                    : `radial-gradient(circle at 40% 40%, ${orbColor}88, ${orbColor}44 50%, ${orbColor}22)`,
                  boxShadow: isSpeaking || isListening
                    ? `0 0 60px ${orbColor}40, 0 0 120px ${orbColor}20`
                    : `0 0 30px ${orbColor}20`,
                }}
              >
                {isLoading ? (
                  <span className="inline-flex gap-1 items-center">
                    <span className="w-2 h-2 bg-white/60 rounded-full animate-breathe-dot" />
                    <span className="w-2 h-2 bg-white/60 rounded-full animate-breathe-dot [animation-delay:400ms]" />
                    <span className="w-2 h-2 bg-white/60 rounded-full animate-breathe-dot [animation-delay:800ms]" />
                  </span>
                ) : (
                  <Mic
                    size={32}
                    className={`transition-all duration-300
                               ${isListening ? 'text-white scale-110' : 'text-white/70 scale-100'}`}
                  />
                )}
              </div>
            </div>
          )}

          {/* Live user speech */}
          {isListening && !showTextInput && liveUserText && (
            <div className="mt-8 px-8 max-w-md w-full">
              <p className="text-white text-lg text-center leading-relaxed animate-[fade-up_0.2s_ease-out]">
                {liveUserText}
                <span className="inline-block w-0.5 h-5 bg-white/60 ml-1 animate-pulse" />
              </p>
            </div>
          )}

          {/* Type instead — text input mode */}
          {isListening && showTextInput && (
            <div className="mt-8 px-8 max-w-md w-full animate-[fade-up_0.2s_ease-out]">
              <form
                onSubmit={(e) => { e.preventDefault(); submitTypedText() }}
                className="flex items-center gap-2"
              >
                <input
                  ref={textInputRef}
                  type="text"
                  value={typedText}
                  onChange={(e) => setTypedText(e.target.value)}
                  placeholder={turnIndexRef.current === 1 ? 'Type your name...' : 'Type your response...'}
                  autoFocus
                  className="flex-1 bg-white/[0.08] border border-white/[0.12] rounded-xl px-4 py-3
                             text-white text-sm placeholder:text-white/30
                             focus:outline-none focus:border-white/[0.25]
                             transition-colors"
                />
                <button
                  type="submit"
                  disabled={!typedText.trim()}
                  className="w-10 h-10 rounded-xl bg-indigo-500/30 border border-indigo-400/20
                             flex items-center justify-center
                             hover:bg-indigo-500/50 disabled:opacity-30
                             transition-all"
                >
                  <Send size={16} className="text-white" />
                </button>
              </form>
            </div>
          )}

          {/* Type instead button — hidden once user starts speaking */}
          {isListening && !showTextInput && !liveUserText && (
            <button
              onClick={() => { setShowTextInput(true); setTimeout(() => textInputRef.current?.focus(), 50) }}
              className="mt-4 flex items-center gap-1.5 text-white/20 text-xs
                         hover:text-white/40 transition-colors"
            >
              <Keyboard size={12} />
              <span>Type instead</span>
            </button>
          )}

          {/* Live model speech transcription */}
          {isSpeaking && liveModelText && (
            <div className="mt-8 px-8 max-w-md w-full">
              <p className="text-white/60 text-sm text-center leading-relaxed">
                {liveModelText}
              </p>
            </div>
          )}

          {phase === 'error' && errorMsg && (
            <div className="mt-8 px-8 max-w-md w-full">
              <p className="text-red-400/80 text-sm text-center">{errorMsg}</p>
              <p className="text-white/30 text-xs text-center mt-2">Switching to text mode...</p>
            </div>
          )}
        </>
      )}

      {phase !== 'next_steps' && (
        <button
          onClick={() => { teardown(); onComplete() }}
          className="absolute bottom-6 text-white/15 text-[11px] hover:text-white/30
                     transition-colors px-4 py-2"
        >
          Skip setup
        </button>
      )}
    </div>
  )
}
