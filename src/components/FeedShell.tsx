'use client'

/**
 * FeedShell — renders feed-type apps (interactionType: 'feed').
 *
 * Pre-emptive rendering strategy:
 *  1. On mount: check sessionStorage for today's cached content.
 *     If found → render immediately (zero latency).
 *  2. Always regenerate in background on mount (or when forced).
 *     Update sessionStorage when complete.
 *  3. Regenerate button always visible after first load.
 *
 * The generation prompt comes from `app.autoPrompt` — no hardcoding here.
 * Any feed-type app with an autoPrompt gets this behavior for free.
 *
 * Used by: Morning Brief (app.id = 'brief')
 */

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import type { MywayApp } from '@/lib/apps'
import AppPage from '@/components/AppPage'
import AppHeader from '@/components/AppHeader'
import { MarkdownContent } from '@/components/MarkdownContent'
import { getAppGradient } from '@/lib/design'
import { streamDeltas } from '@/lib/stream'
import { useClientContext } from '@/hooks/useClientContext'
import { buildChatBody } from '@/lib/chat-client'

type Props = {
  app: MywayApp
  /** When true, renders in demo mode with no interactivity. */
  demo?: boolean
  /** Progressively revealed content to display in demo mode (driven by parent). */
  demoContent?: string
  /** True while demo content is still being revealed (shows streaming cursor). */
  demoStreaming?: boolean
}

const FALLBACK_PROMPT =
  "Generate a brief summary of what's relevant for me right now. " +
  "Use any context you have about my tasks, memories, and preferences."

/** SessionStorage key for today's cached feed content. */
function cacheKey(appId: string, dateLabel: string): string {
  // Use just the date portion so cache invalidates at midnight
  const date = dateLabel.split(',').slice(-1)[0]?.trim() ?? dateLabel
  return `myway-feed-${appId}-${date}`
}

export default function FeedShell({ app, demo, demoContent, demoStreaming }: Props) {
  const router = useRouter()
  const clientContext = useClientContext()
  const gradient = getAppGradient(app.color)
  const prompt = app.autoPrompt ?? FALLBACK_PROMPT

  const [content, setContent] = useState<string>('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const key = cacheKey(app.id, clientContext.dateLabel)

  const generate = async (force = false) => {
    if (streaming) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // If not forcing, only clear content if we have nothing cached
    if (force) {
      setContent('')
      setError(null)
    }
    setStreaming(true)

    try {
      const res = await fetch('/api/openclaw/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildChatBody(app.id, [{ role: 'user', content: prompt }], { clientContext }),
        ),
        signal: ctrl.signal,
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(text)
      }

      let accumulated = ''
      for await (const delta of streamDeltas(res.body)) {
        accumulated += delta
        setContent(accumulated)
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
      }

      const now = new Date()
      setGeneratedAt(now)
      // Cache result so next mount is instant
      try {
        sessionStorage.setItem(key, JSON.stringify({ content: accumulated, generatedAt: now.toISOString() }))
      } catch { /* sessionStorage may be unavailable */ }

    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message || 'Failed to generate')
    } finally {
      setStreaming(false)
    }
  }

  // On mount: load cache immediately, then regenerate in background
  useEffect(() => {
    // Demo mode: content is driven by parent (audio-synced reveal)
    if (demo) return

    try {
      const cached = sessionStorage.getItem(key)
      if (cached) {
        const { content: cachedContent, generatedAt: cachedAt } = JSON.parse(cached)
        if (cachedContent) {
          setContent(cachedContent)
          setGeneratedAt(new Date(cachedAt))
        }
      }
    } catch { /* ignore */ }

    // Always regenerate in background (cache will update on complete)
    generate()
    return () => abortRef.current?.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync demo content from parent (audio-synced progressive reveal)
  useEffect(() => {
    if (!demo || demoContent === undefined) return
    setContent(demoContent)
    if (!generatedAt) setGeneratedAt(new Date())
  }, [demo, demoContent]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll in demo mode when content updates past visible area
  useEffect(() => {
    if (!demo || !content) return
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [demo, content])

  // In demo mode, use parent's streaming flag; otherwise use internal state
  const isStreaming = demo ? (demoStreaming ?? false) : streaming

  const handleBack = () => {
    abortRef.current?.abort()
    router.push('/')
  }

  const timeStr = generatedAt
    ? generatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <AppPage gradient={gradient}>
      <AppHeader
        title={app.name}
        icon={app.icon}
        onBack={demo ? undefined : handleBack}
        actions={demo ? undefined : (
          <button
            onClick={() => generate(true)}
            disabled={streaming}
            className="p-2 rounded-full hover:bg-white/10 transition-colors disabled:opacity-40"
            title="Regenerate"
          >
            <RefreshCw
              size={16}
              className={`text-white/70 ${streaming ? 'animate-spin' : ''}`}
            />
          </button>
        )}
      />

      <div ref={scrollRef} className={`flex-1 overflow-y-auto px-4 @lg:px-6 py-4 space-y-4 scrollbar-none ${demo ? 'pointer-events-none' : ''}`}>
        {timeStr && (
          <p className="text-xs text-white/30 text-center">
            {isStreaming ? 'Updating…' : `Generated at ${timeStr}`}
          </p>
        )}

        {(content || isStreaming) ? (
          <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-4">
            <MarkdownContent content={content} />
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-white/60 ml-0.5 animate-pulse rounded-sm" />
            )}
          </div>
        ) : error ? (
          <div className="text-center py-12 space-y-3">
            <p className="text-2xl">⚠️</p>
            <p className="text-white/60 text-sm">{error}</p>
            <button onClick={() => generate()} className="text-xs text-blue-400 underline">
              Try again
            </button>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <div className="text-4xl animate-pulse">{app.icon}</div>
            <p className="text-white/50 text-sm">Preparing your brief…</p>
          </div>
        )}
      </div>

      {!demo && !isStreaming && content && (
        <div className="px-4 app-footer-bottom pt-2 border-t border-white/[0.06]">
          <button
            onClick={() => generate(true)}
            className="w-full py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.08]
                       text-white/50 text-xs hover:bg-white/[0.10] transition-colors"
          >
            Regenerate
          </button>
        </div>
      )}
    </AppPage>
  )
}
