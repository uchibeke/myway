'use client'

/**
 * ButtonShell — one-tap trigger → AI output.
 *
 * Used by The Oracle, Compliment Avalanche, and any interactionType: 'button' app.
 *
 * UX pattern:
 *   1. Show opener (title + tagline + quick action buttons)
 *   2. User taps a button → fires prompt immediately
 *   3. Output streams into the card
 *   4. "Ask again" / "Try another" resets to opener
 */

import { useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Check, RotateCcw, Volume2, Loader2 } from 'lucide-react'
import type { MywayApp } from '@/lib/apps'
import AppPage from '@/components/AppPage'
import AppHeader from '@/components/AppHeader'
import { MarkdownContent } from '@/components/MarkdownContent'
import { getAppGradient } from '@/lib/design'
import { streamDeltas } from '@/lib/stream'
import { useTTS } from '@/hooks/useTTS'
import { useIntegrationStatus } from '@/hooks/useIntegrationStatus'
import { stableAssetId } from '@/lib/tts'
import { useClientContext } from '@/hooks/useClientContext'
import { useContextSummary } from '@/hooks/useContextSummary'
import { generateDynamicPresets } from '@/lib/dynamic-presets'
import { buildChatBody } from '@/lib/chat-client'

/**
 * Splits output into individual numbered items for avalanche rendering.
 * "1. Great\n\n2. Amazing" → ["1. Great", "2. Amazing"]
 * Falls back to a single item if no numbered list is detected.
 */
function parseAvalancheItems(content: string): string[] {
  const parts = content.split(/(?=^\d+\.\s)/m)
  const trimmed = parts.map((s) => s.trim()).filter(Boolean)
  return trimmed.length > 1 ? trimmed : content.trim() ? [content.trim()] : []
}

type Props = { app: MywayApp }

export default function ButtonShell({ app }: Props) {
  const router = useRouter()
  const clientContext = useClientContext()
  const { summary: ctxSummary } = useContextSummary(!!app.contextAction)
  const tts = useTTS()
  const { ttsAvailable } = useIntegrationStatus()
  const [output, setOutput] = useState('')
  const [activePrompt, setActivePrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const fire = useCallback(async (prompt: string, contextRefs?: string[]) => {
    if (busy || !prompt.trim()) return
    setOutput('')
    setActivePrompt(prompt)
    setBusy(true)
    setStreaming(true)

    const ac = new AbortController()
    abortRef.current = ac

    try {
      const res = await fetch('/api/openclaw/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify(
          buildChatBody(app.id, [{ role: 'user', content: prompt.trim() }], { clientContext, contextRefs }),
        ),
      })

      if (!res.ok || !res.body) throw new Error(await res.text() || 'Request failed')

      for await (const delta of streamDeltas(res.body)) {
        setOutput((prev) => prev + delta)
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'AbortError') return
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setOutput(`⚠ ${msg}`)
    } finally {
      setBusy(false)
      setStreaming(false)
    }
  }, [app.id, busy])

  const copy = useCallback(() => {
    if (!output) return
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [output])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setOutput('')
    setActivePrompt('')
    setBusy(false)
    setStreaming(false)
  }, [])

  const opener = app.opener
  const hasOutput = output.length > 0 || busy
  const ttsAssetId = useMemo(() => output ? stableAssetId(output) : '', [output])

  // Dynamic presets from context palette
  const dynamicPresets = app.contextAction && ctxSummary
    ? generateDynamicPresets(app.contextAction, ctxSummary, clientContext.timeOfDay)
    : []

  // Back: if there's output → clear to opener. Otherwise → home.
  const handleBack = useCallback(() => {
    if (hasOutput) {
      reset()
    } else {
      router.push('/')
    }
  }, [hasOutput, reset, router])

  return (
    <AppPage gradient={getAppGradient(app.color)}>
      <AppHeader
        title={app.name}
        icon={app.icon}
        onBack={handleBack}
        backLabel={hasOutput ? 'Back' : 'Home'}
      />

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 @lg:px-6 pt-6 pb-safe pb-6 flex flex-col gap-6 min-h-0 scrollbar-none">

        {/* ── Opener (empty state) ── */}
        {!hasOutput && opener && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-[50vh] gap-6">
            {/* Title */}
            <div className="text-center">
              <div className="text-5xl mb-3 select-none">{app.icon}</div>
              <h2 className="text-white font-bold text-lg">{opener.title}</h2>
              <p className="text-zinc-400 text-sm mt-1.5 leading-relaxed max-w-[260px] @lg:max-w-[340px] mx-auto">
                {opener.tagline}
              </p>
            </div>

            {/* One-tap action buttons */}
            {(opener.quickActions.length > 0 || dynamicPresets.length > 0) && (
              <div className="flex flex-col gap-2 w-full max-w-xs @lg:max-w-sm">
                {opener.quickActions.map(({ label, prompt, hint }) => (
                  <button
                    key={label}
                    onClick={() => prompt && fire(prompt)}
                    disabled={!prompt?.trim()}
                    className="text-left px-4 py-3.5 rounded-2xl
                               bg-white/[0.07] border border-white/[0.10]
                               text-zinc-200 text-sm
                               hover:bg-white/[0.12] hover:border-white/20 hover:text-white
                               active:scale-[0.98] active:opacity-70
                               transition-all duration-150
                               flex items-center justify-between gap-3
                               disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="font-medium">{label}</span>
                    <span className="text-zinc-500 text-xs shrink-0">{hint}</span>
                  </button>
                ))}

                {/* Dynamic presets from context palette */}
                {dynamicPresets.length > 0 && (
                  <>
                    {opener.quickActions.length > 0 && (
                      <div className="border-t border-white/[0.06] my-0.5" />
                    )}
                    {dynamicPresets.map(({ label, prompt, hint, contextRef }) => (
                      <button
                        key={label}
                        onClick={() => prompt && fire(prompt, contextRef ? [contextRef] : undefined)}
                        className="text-left px-4 py-3.5 rounded-2xl
                                   bg-white/[0.07] border border-white/[0.10]
                                   text-zinc-200 text-sm
                                   hover:bg-white/[0.12] hover:border-white/20 hover:text-white
                                   active:scale-[0.98] active:opacity-70
                                   transition-all duration-150
                                   flex items-center justify-between gap-3
                                   animate-in fade-in duration-200"
                      >
                        <span className="font-medium">{label}</span>
                        <span className="text-zinc-500 text-xs shrink-0">{hint}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Loading ── */}
        {busy && !hasOutput && (
          <div className="flex flex-col items-center justify-center flex-1 gap-4">
            <span className="inline-flex gap-1.5 items-center">
              <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </span>
          </div>
        )}

        {/* ── Output ── */}
        {hasOutput && (
          <div className="flex flex-col gap-4 flex-1">
            {/* Source prompt chip */}
            {activePrompt && (
              <div className="px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08]
                              text-zinc-500 text-xs self-center text-center max-w-[240px] @lg:max-w-[360px] truncate">
                {activePrompt}
              </div>
            )}

            {/* Output — streaming avalanche (items mount as they arrive) or standard card */}
            {app.responseAnimation === 'avalanche' ? (() => {
              const items = parseAvalancheItems(output)
              return (
                <div className="flex flex-col gap-3 w-full">
                  {items.length === 0 && streaming ? (
                    // Waiting for first token
                    <div className="flex justify-center py-6">
                      <span className="inline-flex gap-1.5 items-center">
                        <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:0ms]" />
                        <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:150ms]" />
                        <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:300ms]" />
                      </span>
                    </div>
                  ) : (
                    items.map((item, i) => {
                      const isLast = i === items.length - 1
                      return (
                        // key={i} — new items mount when i grows; existing items stay mounted.
                        // CSS animation fires on mount only → each item falls in exactly once,
                        // in the order the AI writes them. Streaming IS the animation.
                        <div
                          key={i}
                          className="animate-avalanche-fall bg-white/[0.07] border border-white/[0.09]
                                     rounded-2xl px-5 py-4 backdrop-blur-sm"
                        >
                          <MarkdownContent content={item} compact streaming={streaming && isLast} />
                          {streaming && isLast && (
                            <span className="inline-block w-0.5 h-4 bg-zinc-400 ml-0.5 animate-pulse" />
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              )
            })() : (
              <div className="bg-white/[0.07] border border-white/[0.09] rounded-2xl
                              px-5 py-5 backdrop-blur-sm flex-1 min-h-[120px] overflow-hidden">
                <MarkdownContent content={output} streaming={streaming} />
                {streaming && (
                  <span className="inline-block w-0.5 h-4 bg-zinc-400 ml-0.5 animate-pulse" />
                )}
              </div>
            )}

            {/* Actions */}
            {!streaming && (
              <div className="flex items-center justify-center gap-4">
                {ttsAvailable && (
                  <button
                    onClick={() => {
                      if (tts.activeAssetId === ttsAssetId && tts.state !== 'idle') {
                        tts.stop()
                      } else {
                        tts.generate(output, ttsAssetId)
                      }
                    }}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl
                               bg-white/[0.05] border border-white/[0.08]
                               text-sm transition-colors
                               ${tts.activeAssetId === ttsAssetId && tts.state === 'playing'
                                 ? 'text-blue-400 animate-pulse'
                                 : tts.activeAssetId === ttsAssetId && tts.state === 'generating'
                                   ? 'text-amber-400'
                                   : 'text-zinc-400 hover:text-white hover:bg-white/10'
                               }`}
                  >
                    {tts.activeAssetId === ttsAssetId && tts.state === 'generating'
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Volume2 size={14} />}
                    <span>
                      {tts.activeAssetId === ttsAssetId && tts.state === 'playing' ? 'Stop'
                        : tts.activeAssetId === ttsAssetId && tts.state === 'generating' ? 'Generating...'
                        : 'Listen'}
                    </span>
                  </button>
                )}
                <button
                  onClick={copy}
                  aria-label={copied ? 'Copied to clipboard' : 'Copy output'}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl
                             bg-white/[0.05] border border-white/[0.08]
                             text-zinc-400 hover:text-white hover:bg-white/10
                             text-sm transition-colors"
                >
                  {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  onClick={reset}
                  aria-label="Reset and try another"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl
                             bg-white/[0.05] border border-white/[0.08]
                             text-zinc-400 hover:text-white hover:bg-white/10
                             text-sm transition-colors"
                >
                  <RotateCcw size={14} />
                  <span>Try another</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppPage>
  )
}
