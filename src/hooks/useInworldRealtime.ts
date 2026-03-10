/**
 * useInworldRealtime — WebRTC hook for Inworld Realtime voice.
 *
 * Manages the full lifecycle: mic capture → WebRTC connection → Inworld
 * handles STT + LLM + TTS → audio plays natively via browser, text deltas
 * arrive via DataChannel.
 *
 * Usage:
 *   const rt = useInworldRealtime({ onTextDelta, onResponseDone, onError })
 *   await rt.connect()   // opens mic + WebRTC
 *   rt.disconnect()      // tears down everything
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { micStart, micStop, speechStart } from '@/lib/haptics'

export type InworldRealtimeState = 'idle' | 'connecting' | 'connected' | 'error'

type Options = {
  /** Called with each incremental text chunk from the AI response. */
  onTextDelta: (delta: string) => void
  /** Called when the AI finishes speaking (response.done). */
  onResponseDone: () => void
  /** Called when an error occurs (connection, mic, etc). */
  onError: (error: string) => void
}

type SessionConfig = {
  apiKey: string
  iceServers: RTCIceServer[]
  instructions: string
  voice: string
}

const ICE_GATHER_TIMEOUT_MS = 5_000

export function useInworldRealtime({ onTextDelta, onResponseDone, onError }: Options) {
  const [state, setState] = useState<InworldRealtimeState>('idle')
  const [fullText, setFullText] = useState('')

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mountedRef = useRef(true)

  // Store callbacks in refs so we don't recreate connect() on every render
  const onTextDeltaRef = useRef(onTextDelta)
  const onResponseDoneRef = useRef(onResponseDone)
  const onErrorRef = useRef(onError)
  onTextDeltaRef.current = onTextDelta
  onResponseDoneRef.current = onResponseDone
  onErrorRef.current = onError

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cleanup()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function cleanup() {
    if (dcRef.current) {
      try { dcRef.current.close() } catch { /* ignore */ }
      dcRef.current = null
    }
    if (pcRef.current) {
      try { pcRef.current.close() } catch { /* ignore */ }
      pcRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
      micStop()
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.srcObject = null
      audioRef.current = null
    }
  }

  const disconnect = useCallback(() => {
    cleanup()
    if (mountedRef.current) setState('idle')
  }, [])

  const connect = useCallback(async (): Promise<boolean> => {
    setState('connecting')
    setFullText('')

    // 1. Fetch session config from server
    let config: SessionConfig
    try {
      const res = await fetch('/api/demo/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      })
      if (!res.ok) {
        if (mountedRef.current) setState('idle')
        return false
      }
      config = await res.json() as SessionConfig
    } catch {
      if (mountedRef.current) setState('idle')
      return false
    }

    // 2. Get microphone
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream
      micStart()
    } catch (err) {
      if (mountedRef.current) {
        setState('error')
        onErrorRef.current('Microphone access denied')
      }
      return false
    }

    try {
      // 3. Create RTCPeerConnection
      const pc = new RTCPeerConnection({ iceServers: config.iceServers })
      pcRef.current = pc

      // 4. Create DataChannel for events
      const dc = pc.createDataChannel('oai-events', { ordered: true })
      dcRef.current = dc

      dc.onopen = () => {
        // Send session config with instructions and voice
        dc.send(JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            model: 'openai/gpt-4o-mini',
            instructions: config.instructions,
            output_modalities: ['audio', 'text'],
            audio: {
              input: {
                turn_detection: {
                  type: 'semantic_vad',
                  eagerness: 'high',
                  create_response: true,
                  interrupt_response: true,
                },
              },
              output: {
                model: 'inworld-tts-1.5-mini',
                voice: config.voice,
              },
            },
          },
        }))
      }

      dc.onmessage = (ev) => {
        if (!mountedRef.current) return
        try {
          const msg = JSON.parse(ev.data) as { type: string; delta?: string }
          switch (msg.type) {
            case 'response.output_text.delta':
              if (msg.delta) {
                onTextDeltaRef.current(msg.delta)
                setFullText(prev => prev + msg.delta)
              }
              break
            case 'response.done':
              onResponseDoneRef.current()
              break
          }
        } catch { /* ignore malformed messages */ }
      }

      // 5. Handle remote audio track (Inworld's voice)
      pc.ontrack = (ev) => {
        const audio = new Audio()
        audio.autoplay = true
        audio.srcObject = ev.streams[0] || new MediaStream([ev.track])
        audioRef.current = audio
        speechStart()
      }

      // 6. Add mic track
      stream.getTracks().forEach(track => pc.addTrack(track, stream))

      // 7. Create and set local SDP offer
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      // 8. Wait for ICE gathering
      await waitForIceGathering(pc)

      // 9. Send offer to Inworld, get answer
      const sdpRes = await fetch('https://api.inworld.ai/v1/realtime/calls', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: pc.localDescription!.sdp,
        signal: AbortSignal.timeout(10_000),
      })

      if (!sdpRes.ok) {
        const errText = await sdpRes.text().catch(() => `${sdpRes.status}`)
        throw new Error(`SDP exchange failed: ${errText}`)
      }

      const answerSdp = await sdpRes.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      if (mountedRef.current) setState('connected')
      return true
    } catch (err) {
      cleanup()
      if (mountedRef.current) {
        setState('error')
        onErrorRef.current(err instanceof Error ? err.message : 'WebRTC connection failed')
      }
      return false
    }
  }, [])

  return { state, fullText, connect, disconnect }
}

/** Wait for ICE candidates to finish gathering (with timeout). */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()

  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ICE_GATHER_TIMEOUT_MS)

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer)
        resolve()
      }
    }
  })
}
