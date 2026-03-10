'use client'

/**
 * QuotaExceeded — inline prompt shown when app quota or spend limit is reached.
 *
 * Two modes:
 *   1. App quota exceeded: shows addon purchase buttons (per-app outcome gating)
 *   2. Spend limit exceeded: shows plan upgrade CTA (platform-level gating)
 *
 * Rendered in the chat stream when the server sends a 402 response.
 */

import { useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2, Sparkles } from 'lucide-react'

type AddonOption = {
  quantity: number
  priceUsd: number
}

type SpendLimit = {
  currentSpendUsd: number
  limitUsd: number
}

type Props = {
  appName: string
  appId?: string
  outcomeId?: string
  addonOptions: AddonOption[]
  message: string
  /** AppRoom base URL for manage subscription link. */
  appRoomUrl?: string
  /** Present when this is a spend-limit-exceeded (not app quota). */
  spendLimit?: SpendLimit
}

export type QuotaExceededData = Props

export default function QuotaExceeded({ appName, appId, outcomeId, addonOptions, message, appRoomUrl, spendLimit }: Props) {
  const [purchasing, setPurchasing] = useState<number | null>(null)
  const [upgrading, setUpgrading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSpendLimit = !!spendLimit

  // Validate appRoomUrl is HTTPS to prevent open redirect
  const safeAppRoomUrl = (() => {
    if (!appRoomUrl) return undefined
    try { return new URL(appRoomUrl).protocol === 'https:' ? appRoomUrl : undefined }
    catch { return undefined }
  })()

  async function handlePurchase(opt: AddonOption, index: number) {
    if (!appId || !outcomeId) {
      if (safeAppRoomUrl) window.open(`${safeAppRoomUrl}/account/usage`, '_blank')
      return
    }

    setPurchasing(index)
    setError(null)

    try {
      const res = await fetch('/api/addons/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ appId, outcomeId, quantity: opt.quantity }),
      })

      const data = await res.json()

      if (!res.ok || !data.checkoutUrl) {
        setError(data.error || 'Failed to start checkout')
        return
      }

      try {
        const checkoutHost = new URL(data.checkoutUrl).hostname
        if (!checkoutHost.endsWith('.stripe.com')) {
          setError('Invalid checkout URL')
          return
        }
      } catch {
        setError('Invalid checkout URL')
        return
      }

      window.location.href = data.checkoutUrl
    } catch {
      setError('Network error — please try again')
    } finally {
      setPurchasing(null)
    }
  }

  async function handleUpgrade() {
    setUpgrading(true)
    setError(null)

    try {
      const res = await fetch('/api/plan/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      })

      const data = await res.json()

      if (!res.ok || !data.checkoutUrl) {
        setError(data.error || 'Failed to start checkout')
        return
      }

      try {
        const checkoutHost = new URL(data.checkoutUrl).hostname
        if (!checkoutHost.endsWith('.stripe.com')) {
          setError('Invalid checkout URL')
          return
        }
      } catch {
        setError('Invalid checkout URL')
        return
      }

      window.location.href = data.checkoutUrl
    } catch {
      setError('Network error — please try again')
    } finally {
      setUpgrading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 my-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-amber-500/10 p-2">
          <AlertTriangle size={18} className="text-amber-400" />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <h3 className="font-semibold text-white text-sm">Monthly Limit Reached</h3>
            <p className="text-xs text-white/60 mt-1">{message}</p>
          </div>

          {/* Spend limit: show upgrade CTA */}
          {isSpendLimit && (
            <div className="space-y-2">
              <button
                disabled={upgrading}
                onClick={handleUpgrade}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-black hover:bg-amber-400 transition-colors disabled:opacity-50"
              >
                {upgrading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                Upgrade to Personal — $19/month
              </button>
              <p className="text-center text-[11px] text-white/30">
                Unlimited bundled apps. Cancel anytime.
              </p>
            </div>
          )}

          {/* App quota: show addon purchase buttons */}
          {!isSpendLimit && addonOptions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-white/40">Get more actions:</p>
              {addonOptions.map((opt, i) => (
                <button
                  key={i}
                  disabled={purchasing !== null}
                  onClick={() => handlePurchase(opt, i)}
                  className="w-full flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 transition-colors disabled:opacity-50"
                >
                  <span className="text-white/80">{opt.quantity} more actions</span>
                  <span className="font-medium text-emerald-400 flex items-center gap-1.5">
                    {purchasing === i && <Loader2 size={12} className="animate-spin" />}
                    ${opt.priceUsd.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {safeAppRoomUrl && (
            <a
              href={`${safeAppRoomUrl}/account/usage`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors"
            >
              Manage subscription
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
