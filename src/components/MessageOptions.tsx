'use client'

import { useState, useCallback } from 'react'
import { Check, X, Loader2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type MessageOption = {
  id: string
  label: string
  description?: string
  variant: 'primary' | 'secondary' | 'danger'
  action: () => Promise<void>
}

type Props = {
  options: MessageOption[]
  resolved?: boolean
  resultLabel?: string
}

// ─── Variant styles ───────────────────────────────────────────────────────────

const variantClasses: Record<MessageOption['variant'], string> = {
  primary:
    'bg-[rgb(var(--brand-primary-rgb)/0.8)] hover:brightness-110 text-white border-[rgb(var(--brand-primary-rgb)/0.3)]',
  secondary:
    'bg-white/[0.07] hover:bg-white/[0.12] text-zinc-300 border-white/[0.10]',
  danger:
    'bg-red-600/20 hover:bg-red-600/30 text-red-300 border-red-500/20',
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * MessageOptions — generic inline action buttons rendered below assistant
 * messages when actionable choices exist.
 *
 * Used by connections (approve/reject email drafts, calendar events) but
 * designed to be system-agnostic — any feature can provide options.
 */
export default function MessageOptions({ options, resolved, resultLabel }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const [result, setResult] = useState<{ label: string; success: boolean } | null>(null)

  const handleAction = useCallback(async (opt: MessageOption) => {
    if (loading || resolved || result) return
    setLoading(opt.id)
    try {
      await opt.action()
      setResult({ label: opt.label, success: true })
    } catch {
      setResult({ label: `${opt.label} failed`, success: false })
    } finally {
      setLoading(null)
    }
  }, [loading, resolved, result])

  // Already resolved (from loaded history or after action)
  if (resolved && resultLabel) {
    return (
      <div className="flex items-center gap-1.5 mt-2 text-xs text-zinc-500">
        <Check size={12} className="text-emerald-400" />
        <span>{resultLabel}</span>
      </div>
    )
  }

  // Action completed this session
  if (result) {
    return (
      <div className="flex items-center gap-1.5 mt-2 text-xs">
        {result.success ? (
          <>
            <Check size={12} className="text-emerald-400" />
            <span className="text-emerald-400/80">{result.label}</span>
          </>
        ) : (
          <>
            <X size={12} className="text-red-400" />
            <span className="text-red-400/80">{result.label}</span>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2.5">
      {options.map((opt) => {
        const isLoading = loading === opt.id
        const disabled = loading !== null

        return (
          <button
            key={opt.id}
            onClick={() => handleAction(opt)}
            disabled={disabled}
            title={opt.description}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
              text-xs font-medium border backdrop-blur-sm
              transition-all duration-150
              disabled:opacity-50 disabled:cursor-not-allowed
              ${variantClasses[opt.variant]}
            `}
          >
            {isLoading && <Loader2 size={12} className="animate-spin" />}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
