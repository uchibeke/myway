'use client'

/**
 * TransformerShell — input → transformed output.
 *
 * Used by Drama Mode, Office Translator, and any app with interactionType: 'transformer'.
 * Stacks vertically on mobile (full-screen), maintains single focus on one transformation.
 *
 * UX pattern:
 *   1. Opener quick-actions pre-fill the textarea for new users
 *   2. User edits or pastes their own text
 *   3. Hit "Transform" — output streams below
 *   4. Copy or Reset to start again
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw, ArrowRight } from 'lucide-react'
import type { MywayApp } from '@/lib/apps'
import AppPage from '@/components/AppPage'
import AppHeader from '@/components/AppHeader'
import GenericOpener from '@/components/GenericOpener'
import ChatInputBar from '@/components/ChatInputBar'
import { MarkdownContent } from '@/components/MarkdownContent'
import MessageActions from '@/components/MessageActions'
import { useIntegrationStatus } from '@/hooks/useIntegrationStatus'
import { getAppGradient } from '@/lib/design'
import { streamDeltas } from '@/lib/stream'
import { useTTS } from '@/hooks/useTTS'
import { useClientContext } from '@/hooks/useClientContext'
import { useInputMode } from '@/hooks/useInputMode'
import { buildChatBody } from '@/lib/chat-client'

type Props = {
  app: MywayApp
  opener?: React.ReactNode
  /** Auto-prefill and transform on mount — from URL ?q= param */
  initialMessage?: string
  /** Verb phrase for dynamic context presets — threaded to GenericOpener. */
  contextAction?: string
}

export default function TransformerShell({ app, opener, initialMessage, contextAction }: Props) {
  const router = useRouter()
  const clientContext = useClientContext()
  const tts = useTTS()
  const { ttsAvailable } = useIntegrationStatus()
  const { isDesktop } = useInputMode()
  const [input, setInput] = useState(initialMessage ?? '')
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const contextRefsRef = useRef<string[] | undefined>(undefined)

  const hasContent = input.length > 0 || output.length > 0

  // Back: deep-linked → go back; otherwise clear content; at opener → home.
  const handleBack = useCallback(() => {
    if (initialMessage) {
      router.back()
    } else if (hasContent) {
      abortRef.current?.abort()
      setInput('')
      setOutput('')
      setBusy(false)
      setStreaming(false)
    } else {
      router.push('/')
    }
  }, [initialMessage, hasContent, router])

  const prefill = useCallback((text: string, contextRefs?: string[]) => {
    // Quick actions with trailing space = editable placeholder; strip it
    setInput(text.trimEnd())
    setOutput('')
    contextRefsRef.current = contextRefs
  }, [])

  const transform = useCallback(async () => {
    if (!input.trim() || busy) return
    setOutput('')
    setBusy(true)
    setStreaming(true)

    const ac = new AbortController()
    abortRef.current = ac

    try {
      const refs = contextRefsRef.current
      contextRefsRef.current = undefined
      const res = await fetch('/api/openclaw/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify(
          buildChatBody(app.id, [{ role: 'user', content: input.trim() }], { clientContext, contextRefs: refs }),
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
  }, [app.id, busy, input])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setInput('')
    setOutput('')
    setBusy(false)
    setStreaming(false)
    contextRefsRef.current = undefined
  }, [])

  // Auto-transform when opened with ?q= param
  const initialSent = useRef(false)
  useEffect(() => {
    if (initialMessage && !initialSent.current) {
      initialSent.current = true
      // Small delay to let component mount
      setTimeout(() => transform(), 50)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const hasOutput = output.length > 0

  return (
    <AppPage gradient={getAppGradient(app.color)}>
      <AppHeader
        title={app.name}
        icon={app.icon}
        onBack={handleBack}
        backLabel={initialMessage ? 'Home' : hasContent ? 'Back' : 'Home'}
      />

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 @lg:px-6 app-footer-bottom pt-4 flex flex-col gap-4 min-h-0 scrollbar-none">

        {/* Opener — shown when no input yet */}
        {!input && !hasOutput && opener && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-[50vh] gap-4 py-6">
            {opener}
          </div>
        )}

        {/* Input area */}
        {(input || hasOutput) && (
          <div className="flex flex-col gap-2">
            <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider px-1">
              Input
            </label>
            <textarea
              value={input}
              onChange={(e) => { setInput(e.target.value); setOutput('') }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isDesktop && !e.shiftKey && input.trim()) {
                  e.preventDefault()
                  transform()
                }
              }}
              placeholder="Paste or type your text here…"
              aria-label={`Input for ${app.name}`}
              rows={5}
              disabled={busy}
              className="w-full bg-white/[0.05] border border-white/[0.10] rounded-2xl
                         px-4 py-3 text-white text-sm leading-relaxed outline-none resize-none
                         placeholder:text-zinc-600 focus:border-white/25 transition-colors
                         disabled:opacity-60"
            />
            <button
              onClick={transform}
              disabled={!input.trim() || busy}
              className="self-end flex items-center gap-2 px-5 py-2.5 rounded-xl
                         bg-white text-black text-sm font-semibold
                         hover:bg-zinc-100 active:opacity-70
                         disabled:opacity-30 disabled:cursor-not-allowed
                         transition-all"
            >
              <span>{app.icon}</span>
              <span>Transform</span>
              <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* Output area — chat-style bubble matching AppShell rendering */}
        {hasOutput && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 mr-2 mt-0.5
                              bg-white/10 border border-white/15">
                {app.icon}
              </div>
              <div className="max-w-[85%] @lg:max-w-[75%] rounded-2xl text-sm leading-relaxed overflow-hidden
                              bg-white/[0.07] text-zinc-100 border border-white/[0.09] rounded-bl-sm backdrop-blur-sm">
                <div className="px-4 py-3">
                  <MarkdownContent content={output} compact streaming={streaming} />
                  {streaming && (
                    <span className="inline-block w-0.5 h-3.5 bg-zinc-400 ml-0.5 animate-pulse" />
                  )}
                  {!streaming && output && (
                    <MessageActions content={output} tts={tts} provider={app.ttsProvider} ttsAvailable={ttsAvailable} />
                  )}
                </div>
              </div>
            </div>
            {!streaming && output && (
              <div className="flex items-center pl-9">
                <button
                  onClick={reset}
                  aria-label="Reset and start over"
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
                >
                  <RotateCcw size={13} />
                  <span>Reset</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Loading state before first output character */}
        {busy && !hasOutput && (
          <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl
                          px-4 py-4 flex items-center gap-2">
            <span className="inline-flex gap-1 items-center">
              <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </span>
            <span className="text-zinc-500 text-sm">Transforming…</span>
          </div>
        )}

        {/* Quick-action opener when input is empty (fallback when no explicit opener prop) */}
        {!input && !hasOutput && !opener && app.opener && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-[50vh] gap-4 py-6">
            <GenericOpener opener={app.opener} onSend={(text, refs) => prefill(text, refs)} contextAction={contextAction} />
          </div>
        )}
      </div>

      {/* Compact input bar shown when quick-action opener fills the main area */}
      {!input && !hasOutput && (
        <div className="px-4 @lg:px-6 app-footer-bottom pt-2 border-t border-white/[0.08]">
          <ChatInputBar
            value={input}
            onChange={setInput}
            onSend={(text) => { setInput(text); setTimeout(() => transform(), 50) }}
            placeholder="Or type your own text…"
            disabled={busy}
            appName={app.name}
            showAttachments={false}
            showImmersiveVoice={false}
          />
        </div>
      )}
    </AppPage>
  )
}
