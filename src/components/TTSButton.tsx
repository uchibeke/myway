'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Volume2, Loader2, Play, Mic } from 'lucide-react'
import type { useTTS } from '@/hooks/useTTS'
import { stableAssetId } from '@/lib/tts'
import type { VoiceEntry } from '@/lib/tts'

type Props = {
  text: string
  tts: ReturnType<typeof useTTS>
  provider?: string
}

export default function TTSButton({ text, tts, provider }: Props) {
  const assetId = useMemo(() => stableAssetId(text), [text])

  const [open, setOpen] = useState(false)
  const [voices, setVoices] = useState<VoiceEntry[]>([])
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isActive = tts.activeAssetId === assetId

  // Click-outside closes popover
  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Load saved voices on open
  const loadVoices = useCallback(async () => {
    if (loaded) return
    setLoadingVoices(true)
    try {
      const res = await fetch(`/api/tts?assetId=${encodeURIComponent(assetId)}`)
      if (res.ok) {
        const data = await res.json() as VoiceEntry[]
        setVoices(data)
      }
    } catch {
      // silent
    } finally {
      setLoadingVoices(false)
      setLoaded(true)
    }
  }, [assetId, loaded])

  const handleToggle = useCallback(() => {
    if (isActive && tts.state !== 'idle') {
      tts.stop()
      return
    }
    setOpen((prev) => {
      if (!prev) loadVoices()
      return !prev
    })
  }, [isActive, tts, loadVoices])

  const handleGenerate = useCallback(async () => {
    setOpen(false)
    const entry = await tts.generate(text, assetId, provider)
    if (entry) {
      setVoices((prev) => [entry, ...prev])
      setLoaded(true)
    }
  }, [text, assetId, tts, provider])

  const handlePlay = useCallback((voiceId: string) => {
    setOpen(false)
    tts.playFile(assetId, voiceId)
  }, [assetId, tts])

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleToggle}
        className={`inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors
                    ${isActive && tts.state === 'playing'
                      ? 'text-blue-400 animate-pulse'
                      : isActive && tts.state === 'generating'
                        ? 'text-amber-400'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06]'
                    }`}
        title={isActive && tts.state !== 'idle' ? 'Stop' : 'Voice'}
        aria-label={isActive && tts.state !== 'idle' ? 'Stop playback' : 'Voice options'}
      >
        {isActive && tts.state === 'generating' ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Volume2 size={13} />
        )}
      </button>

      {open && (
        <div className="absolute bottom-8 left-0 z-50 w-52
                        bg-zinc-900/95 backdrop-blur-xl border border-white/[0.12] rounded-xl
                        shadow-2xl overflow-hidden">
          {/* Generate new */}
          <button
            onClick={handleGenerate}
            className="w-full flex items-center gap-2.5 px-3 py-2.5
                       text-sm text-zinc-200 hover:bg-white/[0.08] transition-colors"
          >
            <Mic size={13} className="text-zinc-400 shrink-0" />
            <span>Generate voice</span>
          </button>

          {/* Saved voices */}
          {loadingVoices && (
            <div className="px-3 py-2 text-[11px] text-zinc-600">Loading...</div>
          )}
          {voices.length > 0 && (
            <>
              <div className="h-px bg-white/[0.08]" />
              <div className="max-h-36 overflow-y-auto">
                {voices.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => handlePlay(v.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2
                               text-xs text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-200
                               transition-colors"
                  >
                    <Play size={11} className="shrink-0" />
                    <span className="flex-1 text-left truncate">{formatDate(v.createdAt)}</span>
                    <span className="text-zinc-600 shrink-0">{v.durationSec.toFixed(1)}s</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
