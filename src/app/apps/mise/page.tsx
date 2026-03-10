'use client'

import { Suspense } from 'react'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { getApp, type TimeOfDay } from '@/lib/apps'
import { useContextSummary } from '@/hooks/useContextSummary'
import { generateDynamicPresets } from '@/lib/dynamic-presets'
import { useClientContext } from '@/hooks/useClientContext'

const app = getApp('mise')!

// ─── Quick actions ─────────────────────────────────────────────────────────

const QUICK_ACTIONS: {
  label: string
  prompt: string
  description: string
  placeholder?: boolean
  when?: TimeOfDay[]
}[] = [
  {
    label: '🔗 Save a recipe',
    prompt: 'Save this recipe: ',
    description: 'Paste a URL to import',
    placeholder: true,
  },
  {
    label: '🥕 What can I make?',
    prompt: "What can I make with the ingredients I probably have at home right now? Be realistic about a typical weeknight pantry.",
    description: 'From what you have',
  },
  {
    label: '🕐 Quick dinner',
    prompt: "What's the quickest dinner in my vault? Under 30 minutes. Be honest about real prep time.",
    description: 'Under 30 minutes',
    when: ['midday', 'afternoon', 'evening'],
  },
  {
    label: '📋 Show my recipes',
    prompt: "List all the recipes in my vault. Group them loosely by type if there are more than 5.",
    description: 'Browse your collection',
  },
  {
    label: '📅 Plan my week',
    prompt: "Suggest a practical meal plan for the week from my saved recipes. Mix quick weeknight meals with something more relaxed for the weekend. Include what I'd need to buy.",
    description: 'Weekly meal plan',
    when: ['early_morning', 'morning', 'midday'],
  },
  {
    label: '💡 Surprise me',
    prompt: "Pick a recipe from my vault that I haven't made recently and tell me why it's a good pick for tonight. Be specific.",
    description: 'Random from your vault',
    when: ['afternoon', 'evening'],
  },
]

// ─── URL paste handler ─────────────────────────────────────────────────────

function LinkCapture({ onSend }: { onSend: (text: string) => void }) {
  const [url, setUrl] = useState('')
  const [active, setActive] = useState(false)
  const [extracting, setExtracting] = useState(false)

  async function handleSubmit() {
    const trimmed = url.trim()
    if (!trimmed) return

    setExtracting(true)

    try {
      const resp = await fetch(`/api/extract?url=${encodeURIComponent(trimmed)}`)
      const data = await resp.json()

      if (resp.ok && (data.title || data.content || data.description)) {
        // Build enriched message with extracted content
        const parts = [`Save this recipe from this URL: ${trimmed}`, '', '--- Extracted content ---']

        if (data.title) parts.push(`Title: ${data.title}`)
        if (data.author) parts.push(`Author: ${data.author}`)
        if (data.description) {
          const desc = data.description.length > 1000
            ? data.description.slice(0, 1000) + '...'
            : data.description
          parts.push(`Description: ${desc}`)
        }
        if (data.content) {
          const content = data.content.length > 8000
            ? data.content.slice(0, 8000) + '...'
            : data.content
          parts.push('', 'Transcript/Content:', content)
        }

        parts.push('--- End extracted content ---')
        onSend(parts.join('\n'))
      } else {
        // Extraction failed or empty — fall back to raw URL
        onSend(`Save this recipe from this URL: ${trimmed}`)
      }
    } catch {
      // Network error — fall back to raw URL
      onSend(`Save this recipe from this URL: ${trimmed}`)
    } finally {
      setExtracting(false)
      setUrl('')
      setActive(false)
    }
  }

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="w-full text-left px-4 py-3 rounded-2xl
                   bg-orange-500/15 border border-orange-500/30
                   text-orange-200 text-sm font-medium
                   hover:bg-orange-500/20 hover:border-orange-500/40
                   active:opacity-70 transition-all flex items-center gap-3"
      >
        <span className="text-xl">🔗</span>
        <div>
          <div className="font-semibold">Save a recipe</div>
          <div className="text-orange-300/70 text-xs font-normal mt-0.5">Paste any URL — Mise extracts everything</div>
        </div>
      </button>
    )
  }

  return (
    <div className="w-full flex gap-2">
      <input
        autoFocus
        type="url"
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape' && !extracting) setActive(false) }}
        placeholder="https://..."
        disabled={extracting}
        className="flex-1 bg-white/[0.06] border border-white/[0.15] rounded-xl px-3 py-2.5
                   text-white text-sm outline-none focus:border-orange-400/50
                   placeholder:text-zinc-500 font-mono disabled:opacity-50"
      />
      <button
        onClick={handleSubmit}
        disabled={!url.trim() || extracting}
        className="px-3 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400
                   disabled:opacity-30 text-white text-sm font-semibold transition-colors shrink-0
                   min-w-[90px]"
      >
        {extracting ? 'Extracting...' : 'Save'}
      </button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────

function MiseInner() {
  const [lastRecipe, setLastRecipe] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const { timeOfDay } = useClientContext()
  const { summary: ctxSummary } = useContextSummary(true)

  // Dynamic presets from context palette
  const dynamicPresets = ctxSummary && app.contextAction
    ? generateDynamicPresets(app.contextAction, ctxSummary, timeOfDay)
    : []

  // Filter static actions by time of day
  const filteredActions = QUICK_ACTIONS.filter(
    (a) => !a.when || a.when.includes(timeOfDay),
  )

  // Deep link: /apps/mise?id=<recipeId> — smart router intercepts this and
  // returns the recipe directly; falls back to AI if ID not found.
  // ?q= — contextual prompt from proposal cards on home screen.
  const recipeId = searchParams.get('id')
  const qParam = searchParams.get('q')
  const initialMessage = recipeId
    ? `Show me recipe id=${recipeId}`
    : qParam
      ? decodeURIComponent(qParam)
      : app.autoPrompt

  return (
    <AppShell
      app={app}
      initialMessage={initialMessage}
      onMessage={(role, content) => {
        if (role === 'assistant') setLastRecipe(content)
      }}

      opener={!recipeId && !qParam ? (rawSend) => (
        <div className="flex flex-col items-center gap-4 w-full max-w-xs">
          {/* Hero */}
          <div className="text-center">
            <div className="text-5xl mb-2 select-none">🍲</div>
            <h2 className="text-white font-bold text-lg">Mise en place</h2>
            <p className="text-zinc-400 text-sm mt-1 leading-relaxed max-w-[260px]">
              Every recipe in one place. Chat with your collection.
              It plans dinner before you think to ask.
            </p>
          </div>

          {/* URL quick-save */}
          <div className="w-full">
            <LinkCapture onSend={rawSend} />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 w-full">
            <div className="flex-1 h-px bg-white/[0.08]" />
            <span className="text-zinc-600 text-xs">or ask</span>
            <div className="flex-1 h-px bg-white/[0.08]" />
          </div>

          {/* Quick actions */}
          <div className="flex flex-col gap-1.5 w-full">
            {filteredActions.filter((a) => !a.placeholder).map(({ label, prompt, description }) => (
              <button
                key={label}
                onClick={() => rawSend(prompt)}
                className="text-left px-4 py-2.5 rounded-xl
                           bg-white/[0.05] border border-white/[0.08]
                           text-zinc-200 text-sm
                           hover:bg-white/[0.09] hover:border-white/15 hover:text-white
                           active:opacity-70 transition-colors
                           flex items-center justify-between"
              >
                <span>{label}</span>
                <span className="text-zinc-500 text-xs shrink-0 ml-2">{description}</span>
              </button>
            ))}

            {/* Dynamic presets from context palette */}
            {dynamicPresets.length > 0 && (
              <>
                <div className="border-t border-white/[0.06] my-0.5" />
                {dynamicPresets.map(({ label, prompt, hint, contextRef }) => (
                  <button
                    key={label}
                    onClick={() => prompt && rawSend(prompt, contextRef ? [contextRef] : undefined)}
                    className="text-left px-4 py-2.5 rounded-xl
                               bg-white/[0.05] border border-white/[0.08]
                               text-zinc-200 text-sm
                               hover:bg-white/[0.09] hover:border-white/15 hover:text-white
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

          {/* Autonomy hint */}
          <p className="text-white/20 text-[11px] text-center max-w-[240px]">
            📅 Mise can suggest dinner at 4:30pm every weekday — without you asking
          </p>
        </div>
      ) : undefined}
    />
  )
}

export default function MisePage() {
  return (
    <Suspense>
      <MiseInner />
    </Suspense>
  )
}
