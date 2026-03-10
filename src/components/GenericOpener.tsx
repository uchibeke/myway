'use client'

import { useState } from 'react'
import { useClientContext } from '@/hooks/useClientContext'
import { useContextSummary } from '@/hooks/useContextSummary'
import { generateDynamicPresets } from '@/lib/dynamic-presets'
import type { AppOpener, AppQuickAction } from '@/lib/apps'

type Props = {
  opener: AppOpener
  onSend?: (prompt: string, contextRefs?: string[]) => void
  /** When set, fetches context palette and generates dynamic presets. */
  contextAction?: string
}

/** Substitute [id] placeholders in a template with form values. */
function assemblePrompt(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [id, value]) => text.split(`[${id}]`).join(value),
    template,
  )
}

/**
 * GenericOpener renders the empty-state for any app.
 *
 * Three quick-action modes:
 *  1. Static  (`prompt`) — fires `onSend(prompt)` immediately on click.
 *  2. Template (`template` + `inputs`) — expands to an inline form; user fills
 *     each field; Submit assembles the full prompt and calls `onSend`. The user
 *     never sees the template — only the labelled inputs.
 *  3. Legacy editable (`prompt` ending in space) — treated as static but this
 *     pattern should be migrated to template mode in apps.ts.
 *
 * Time-of-day filtering: quick actions with a `when` array are only shown when
 * the device's current hour matches the declared band. Actions without `when`
 * are always shown. This is purely declarative — no hardcoding in this component.
 */
export default function GenericOpener({ opener, onSend, contextAction }: Props) {
  const { timeOfDay } = useClientContext()
  const { summary } = useContextSummary(!!contextAction)
  const [activeAction, setActiveAction] = useState<AppQuickAction | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})

  // Filter quick actions by time-of-day band
  const visibleActions = opener.quickActions.filter(
    (action) => !action.when || action.when.includes(timeOfDay),
  )

  // Dynamic presets from context palette (progressive enhancement)
  const dynamicPresets = contextAction && summary
    ? generateDynamicPresets(contextAction, summary, timeOfDay)
    : []

  function handleActionClick(action: AppQuickAction) {
    if (!onSend) return

    // Template mode: expand to inline form
    if (action.template && action.inputs?.length) {
      const defaults: Record<string, string> = {}
      action.inputs.forEach((input) => { defaults[input.id] = '' })
      setActiveAction(action)
      setFormValues(defaults)
      return
    }

    // Static mode: fire immediately (ignore trailing-space legacy pattern)
    if (action.prompt?.trim()) {
      const refs = action.contextRef ? [action.contextRef] : undefined
      onSend(action.prompt, refs)
    }
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!activeAction?.template || !onSend) return
    const assembled = assemblePrompt(activeAction.template, formValues)
    if (!assembled.trim()) return
    onSend(assembled)
    setActiveAction(null)
    setFormValues({})
  }

  function handleBack() {
    setActiveAction(null)
    setFormValues({})
  }

  // ── Inline form view (template mode) ────────────────────────────────────────
  if (activeAction?.template && activeAction.inputs) {
    const allRequiredFilled = activeAction.inputs
      .filter((i) => i.required !== false)
      .every((i) => formValues[i.id]?.trim())

    return (
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={handleBack}
          className="self-start text-zinc-500 text-xs hover:text-zinc-300 transition-colors
                     flex items-center gap-1"
        >
          ← Back
        </button>

        <div className="text-white text-sm font-semibold">{activeAction.label}</div>

        <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
          {activeAction.inputs.map((input) => (
            <div key={input.id} className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-400">{input.label}</label>

              {input.type === 'select' && input.options ? (
                <select
                  value={formValues[input.id] ?? ''}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, [input.id]: e.target.value }))
                  }
                  className="w-full bg-white/[0.06] border border-white/[0.10] rounded-xl
                             px-3 py-2 text-white text-sm outline-none
                             focus:border-white/25 transition-colors"
                >
                  <option value="" disabled>Choose…</option>
                  {input.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : input.type === 'text' ? (
                <input
                  type="text"
                  value={formValues[input.id] ?? ''}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, [input.id]: e.target.value }))
                  }
                  placeholder={input.placeholder}
                  className="w-full bg-white/[0.06] border border-white/[0.10] rounded-xl
                             px-3 py-2 text-white text-sm outline-none
                             placeholder:text-zinc-600 focus:border-white/25 transition-colors"
                />
              ) : (
                /* Default: textarea */
                <textarea
                  rows={5}
                  value={formValues[input.id] ?? ''}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, [input.id]: e.target.value }))
                  }
                  placeholder={input.placeholder}
                  className="w-full bg-white/[0.06] border border-white/[0.10] rounded-xl
                             px-3 py-2 text-white text-sm outline-none resize-none
                             placeholder:text-zinc-600 focus:border-white/25 transition-colors
                             leading-relaxed"
                />
              )}
            </div>
          ))}

          <button
            type="submit"
            disabled={!allRequiredFilled}
            className="self-end px-5 py-2.5 rounded-xl bg-[var(--brand-primary)] text-white text-sm
                       font-semibold disabled:opacity-30 disabled:cursor-not-allowed
                       hover:brightness-110 active:opacity-70 transition-all"
          >
            Send
          </button>
        </form>
      </div>
    )
  }

  // ── Default list view ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-xs text-center">
      <div>
        <h2 className="text-white font-bold text-lg">{opener.title}</h2>
        <p className="text-zinc-400 text-sm mt-1.5 leading-relaxed max-w-[260px] mx-auto">
          {opener.tagline}
        </p>
      </div>

      {onSend && (visibleActions.length > 0 || dynamicPresets.length > 0) && (
        <div className="flex flex-col gap-1.5 w-full mt-1 max-h-[45vh] overflow-y-auto scrollbar-none pb-4">
          {visibleActions.map((action) => (
            <button
              key={action.label}
              onClick={() => handleActionClick(action)}
              className="text-left px-4 py-2.5 rounded-xl
                         bg-white/[0.05] border border-white/[0.08]
                         text-zinc-200 text-sm
                         hover:bg-white/[0.09] hover:border-white/15 hover:text-white
                         active:opacity-70 transition-colors
                         flex items-center justify-between"
            >
              <span>{action.label}</span>
              <span className="text-zinc-500 text-xs shrink-0 ml-2">{action.hint}</span>
            </button>
          ))}

          {/* Dynamic presets from context palette */}
          {dynamicPresets.length > 0 && (
            <>
              {visibleActions.length > 0 && (
                <div className="border-t border-white/[0.06] my-0.5" />
              )}
              {dynamicPresets.map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleActionClick(action)}
                  className="text-left px-4 py-2.5 rounded-xl
                             bg-white/[0.05] border border-white/[0.08]
                             text-zinc-200 text-sm
                             hover:bg-white/[0.09] hover:border-white/15 hover:text-white
                             active:opacity-70 transition-colors
                             flex items-center justify-between
                             animate-in fade-in duration-200"
                >
                  <span>{action.label}</span>
                  <span className="text-zinc-500 text-xs shrink-0 ml-2">{action.hint}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {onSend && visibleActions.length === 0 && dynamicPresets.length === 0 && opener.quickActions.length > 0 && (
        /* All actions filtered by time — show a soft nudge instead of empty space */
        <p className="text-zinc-600 text-xs">
          No suggestions for this time of day — just type what you need.
        </p>
      )}
    </div>
  )
}
