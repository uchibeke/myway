'use client'

/**
 * BrandProvider — applies brand CSS custom properties at runtime.
 *
 * On mount:
 *  1. Reads iframe URL params: ?brandPrimary=ff6600&brandBg=111111&brandFg=eeeeee&brandName=MyApp
 *  2. Falls back to server-passed defaults (from env vars via getBrandConfig())
 *  3. Sets CSS custom properties on document.documentElement
 *
 * This enables platform-side per-iframe branding without redeploying Myway.
 */

import { useEffect } from 'react'
import type { BrandConfig } from '@/lib/brand'
import { hexToRgb } from '@/lib/brand'

type Props = {
  defaults: BrandConfig
  children: React.ReactNode
}

/** Strict hex validation — prevents CSS injection via URL params. */
const HEX_RE = /^[0-9a-fA-F]{6}$/

function safeHex(value: string | null, fallback: string): string {
  return value && HEX_RE.test(value) ? value : fallback
}

export default function BrandProvider({ defaults, children }: Props) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    const primary = safeHex(params.get('brandPrimary'), defaults.primary)
    const bg = safeHex(params.get('brandBg'), defaults.bg)
    const fg = safeHex(params.get('brandFg'), defaults.fg)

    const root = document.documentElement
    root.style.setProperty('--brand-primary', `#${primary}`)
    root.style.setProperty('--brand-primary-rgb', hexToRgb(primary))
    root.style.setProperty('--brand-bg', `#${bg}`)
    root.style.setProperty('--brand-bg-rgb', hexToRgb(bg))
    root.style.setProperty('--brand-fg', `#${fg}`)
  }, [defaults])

  return <>{children}</>
}
