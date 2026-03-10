/**
 * Brand configuration — white-label support for Myway.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_BRAND_* env vars (set by platform on the Myway instance)
 *   2. Defaults (Myway's own branding)
 *
 * Client-side iframe URL params (?brandPrimary=ff6600) override at runtime
 * via BrandProvider — those do NOT pass through here (client-only concern).
 */

export type BrandConfig = {
  primary: string    // hex without # (default: '2563eb')
  bg: string         // hex without # (default: '09090b')
  fg: string         // hex without # (default: 'fafafa')
  name: string       // default: 'Myway'
  themeColor: string // hex with # (default: '#000000')
}

const DEFAULTS: BrandConfig = {
  primary: '2563eb',
  bg: '09090b',
  fg: 'fafafa',
  name: 'Myway',
  themeColor: '#000000',
}

export function getBrandConfig(): BrandConfig {
  return {
    primary: process.env.NEXT_PUBLIC_BRAND_PRIMARY ?? DEFAULTS.primary,
    bg: process.env.NEXT_PUBLIC_BRAND_BG ?? DEFAULTS.bg,
    fg: process.env.NEXT_PUBLIC_BRAND_FG ?? DEFAULTS.fg,
    name: process.env.NEXT_PUBLIC_BRAND_NAME ?? DEFAULTS.name,
    themeColor: process.env.NEXT_PUBLIC_BRAND_THEME_COLOR ?? DEFAULTS.themeColor,
  }
}

/** Convert hex string (without #) to space-separated RGB for CSS rgb() usage. '2563eb' → '37 99 235' */
export function hexToRgb(hex: string): string {
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '37 99 235' // safe default (blue)
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `${r} ${g} ${b}`
}
