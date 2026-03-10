'use client'

/**
 * Client hook for fetching the context palette summary.
 *
 * Progressive enhancement: returns null during loading so static openers
 * render immediately. Dynamic presets fade in after the ~200ms API call.
 */

import { useState, useEffect } from 'react'

export type ContextSummarySource = {
  key: string
  label: string
  icon: string
  count: number
  samples: string[]
  statLine: string
}

export type ContextSummary = {
  sources: ContextSummarySource[]
  totalItems: number
}

export function useContextSummary(enabled: boolean): {
  summary: ContextSummary | null
  loading: boolean
} {
  const [summary, setSummary] = useState<ContextSummary | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    setLoading(true)

    fetch('/api/context/summary')
      .then(res => res.json())
      .then((data: ContextSummary) => {
        if (!cancelled) {
          setSummary(data.sources?.length > 0 ? data : null)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(null)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [enabled])

  return { summary, loading }
}
