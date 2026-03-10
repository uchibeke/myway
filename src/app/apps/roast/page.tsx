'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import { getApp } from '@/lib/apps'
import { useContextSummary } from '@/hooks/useContextSummary'
import { generateDynamicPresets } from '@/lib/dynamic-presets'
import { useClientContext } from '@/hooks/useClientContext'

const app = getApp('roast')!

// ─── Intensity levels ─────────────────────────────────────────────────────────

type Intensity = 'mild' | 'medium' | 'spicy'

const INTENSITY: { value: Intensity; label: string; emoji: string; hint: string }[] = [
  { value: 'mild',   label: 'Mild',   emoji: '😊', hint: 'Affectionate teasing' },
  { value: 'medium', label: 'Medium', emoji: '🔥', hint: 'Real burns, still warm' },
  { value: 'spicy',  label: 'Spicy',  emoji: '🌶️', hint: 'Full savage mode' },
]

function intensityPrefix(i: Intensity): string {
  if (i === 'mild') return 'Give me a gentle, affectionate roast. Keep it warm. '
  if (i === 'spicy') return 'Go full savage. No mercy. Maximum spice. '
  return ''
}

// ─── Quick prompts ────────────────────────────────────────────────────────────
// contextRef tells the backend which data source to resolve server-side.
// 'files' uses the vault file walker; others use their respective stores.

const QUICK_PROMPTS: { label: string; prompt: string; description: string; contextRef?: string }[] = [
  { label: '🪞 Roast me',         prompt: '/roast me',                                               description: 'Based on all your data',     contextRef: '*' },
  { label: '💼 My career',        prompt: 'Roast my career choices',                                 description: 'Life choices' },
  { label: '💡 My startup idea',  prompt: '/roast idea',                                             description: 'VC-grade brutality' },
  { label: '💻 My code',          prompt: '/roast code',                                             description: 'Paste your worst snippet' },
  { label: '🗂️ My files',         prompt: 'Roast me based on my actual vault files. Be specific.',   description: 'Based on your actual vault', contextRef: 'files' },
]

// ─── Copy roast button ────────────────────────────────────────────────────────

function CopyRoastButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`🎤 Just got roasted by my own AI:\n\n${text}\n\n—via Myway`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available (http context)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-2 py-1 rounded-lg hover:bg-white/10"
      title="Copy roast to clipboard"
    >
      {copied ? '✓ Copied' : '↗ Copy'}
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RoastPage() {
  const [intensity, setIntensity] = useState<Intensity>('medium')
  const { summary: ctxSummary } = useContextSummary(true)
  const { timeOfDay } = useClientContext()
  const [lastRoast, setLastRoast] = useState<string | null>(null)

  // Dynamic presets from context palette
  const dynamicPresets = ctxSummary && app.contextAction
    ? generateDynamicPresets(app.contextAction, ctxSummary, timeOfDay)
    : []

  // Build prompt with intensity prefix (no inline context — refs handle it)
  const buildPrompt = useCallback((raw: string): string => {
    return intensityPrefix(intensity) + raw
  }, [intensity])

  return (
    <AppShell
      app={app}
      onMessage={(role, content) => {
        if (role === 'assistant') setLastRoast(content)
      }}
      headerActions={
        <div className="flex items-center gap-1">
          {lastRoast && <CopyRoastButton text={lastRoast} />}
          <Link
            href="/apps/roast/schedule"
            className="flex items-center justify-center w-8 h-8 text-zinc-400 hover:text-zinc-200 transition-colors rounded-lg hover:bg-white/10"
            title="Scheduled roasts"
          >
            <span className="text-base leading-none">⏰</span>
          </Link>
        </div>
      }
      opener={(rawSend) => {
        // rawSend signature: (text: string, contextRefs?: string[]) => void
        function send(prompt: string, contextRefs?: string[]) {
          rawSend(buildPrompt(prompt), contextRefs)
        }

        return (
          <>
            <div className="text-5xl mb-1 select-none">🎤</div>
            <h2 className="text-white font-bold text-lg">Step into the hot seat</h2>
            <p className="text-zinc-400 text-sm max-w-xs leading-relaxed text-center">
              Feed it anything — a resume, an idea, a life choice — and get a loving but savage roast.
            </p>

            {/* Intensity selector */}
            <div className="flex gap-2 mt-1">
              {INTENSITY.map(({ value, label, emoji }) => (
                <button
                  key={value}
                  onClick={() => setIntensity(value)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                    intensity === value
                      ? 'bg-red-500/20 border border-red-500/50 text-red-300'
                      : 'bg-white/[0.05] border border-white/[0.10] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                  }`}
                >
                  <span>{emoji}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* Quick prompts */}
            <div className="flex flex-col gap-2 w-full max-w-xs mt-1">
              {QUICK_PROMPTS.map(({ label, prompt, description, contextRef }) => (
                <button
                  key={label}
                  onClick={() => send(prompt, contextRef ? [contextRef] : undefined)}
                  className="text-left px-4 py-2.5 rounded-xl
                             bg-white/[0.05] border border-white/[0.10]
                             text-zinc-200 text-sm
                             hover:bg-white/[0.09] hover:border-white/20 hover:text-white
                             active:opacity-70 transition-colors
                             flex items-center justify-between"
                >
                  <span>{label}</span>
                  <span className="text-zinc-500 text-xs">{description}</span>
                </button>
              ))}

              {/* Dynamic presets from context palette */}
              {dynamicPresets.length > 0 && (
                <>
                  <div className="border-t border-white/[0.06] my-0.5" />
                  {dynamicPresets.map(({ label, prompt, hint, contextRef }) => (
                    <button
                      key={label}
                      onClick={() => prompt && send(prompt, contextRef ? [contextRef] : undefined)}
                      className="text-left px-4 py-2.5 rounded-xl
                                 bg-white/[0.05] border border-white/[0.10]
                                 text-zinc-200 text-sm
                                 hover:bg-white/[0.09] hover:border-white/20 hover:text-white
                                 active:opacity-70 transition-colors
                                 flex items-center justify-between
                                 animate-in fade-in duration-200"
                    >
                      <span>{label}</span>
                      <span className="text-zinc-500 text-xs">{hint}</span>
                    </button>
                  ))}
                </>
              )}
            </div>

            {/* Data context hint */}
            <p className="text-white/25 text-[11px] text-center max-w-[240px]">
              🗂️ roast uses your Myway data for maximum specificity
            </p>
          </>
        )
      }}
    />
  )
}
