'use client'

/**
 * AppUsageInfo — in-app usage info popover for paid apps.
 *
 * Shows a small info icon in the app header. On click, fetches and displays:
 *   - Requests this month
 *   - Token usage
 *   - Estimated cost
 *   - Quota remaining (for subscription apps)
 *
 * Renders nothing for free apps.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Info, X } from 'lucide-react'

type UsageData = {
  appId: string
  appName: string
  isPaid: boolean
  usage: {
    totalTokens: number
    promptTokens: number
    completionTokens: number
    estimatedCostUsd: number
    requestCount: number
  }
  quota: { remaining: number; total: number; outcomeId: string } | null
  pricing: { model: string; monthlyCents?: number } | null
}

type Props = {
  appId: string
  isPaid?: boolean
}

export default function AppUsageInfo({ appId, isPaid }: Props) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  const fetchUsage = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/apps/usage?appId=${encodeURIComponent(appId)}&period=month`)
      if (res.ok) setData(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [appId])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleToggle() {
    if (!open) {
      fetchUsage()
    }
    setOpen(!open)
  }

  return (
    <div className="relative" ref={popRef}>
      <button
        onClick={handleToggle}
        className="flex items-center gap-1 text-white/50 hover:text-white/80 transition-colors p-1 rounded"
        aria-label="Usage info"
      >
        <Info size={16} />
        {isPaid && (
          <span className="text-[10px] font-medium uppercase tracking-wider text-amber-400/70">Pro</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-lg bg-zinc-900/95 border border-white/10 backdrop-blur-xl shadow-2xl z-[9999] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-white">Usage This Month</span>
            <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white/70">
              <X size={14} />
            </button>
          </div>

          {loading && !data && (
            <div className="text-xs text-white/40 py-2">Loading...</div>
          )}

          {data && (
            <div className="space-y-3">
              {/* Quota bar for paid apps */}
              {data.quota && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white/60">Quota</span>
                    <span className="text-white/80">
                      {data.quota.remaining} remaining
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        data.quota.remaining === 0
                          ? 'bg-red-500'
                          : data.quota.remaining < 5
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{
                        width: `${Math.max(2, Math.min(100, data.quota.total > 0
                          ? ((data.quota.total - data.quota.remaining) / data.quota.total) * 100
                          : 0))}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-white/5 p-2">
                  <div className="text-xs text-white/40">Requests</div>
                  <div className="text-sm font-medium text-white">{data.usage.requestCount}</div>
                </div>
                <div className="rounded-md bg-white/5 p-2">
                  <div className="text-xs text-white/40">Tokens</div>
                  <div className="text-sm font-medium text-white">
                    {data.usage.totalTokens > 1000
                      ? `${(data.usage.totalTokens / 1000).toFixed(1)}k`
                      : data.usage.totalTokens}
                  </div>
                </div>
                <div className="rounded-md bg-white/5 p-2">
                  <div className="text-xs text-white/40">Est. Cost</div>
                  <div className="text-sm font-medium text-white">
                    ${data.usage.estimatedCostUsd.toFixed(4)}
                  </div>
                </div>
                {data.pricing?.monthlyCents && (
                  <div className="rounded-md bg-white/5 p-2">
                    <div className="text-xs text-white/40">Plan</div>
                    <div className="text-sm font-medium text-white">
                      ${(data.pricing.monthlyCents / 100).toFixed(0)}/mo
                    </div>
                  </div>
                )}
              </div>

              {/* Token breakdown */}
              <div className="text-[10px] text-white/30 flex gap-3">
                <span>In: {data.usage.promptTokens.toLocaleString()}</span>
                <span>Out: {data.usage.completionTokens.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
