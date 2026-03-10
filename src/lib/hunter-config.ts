/**
 * Hunter sources — the full canonical list from canadian_tax_sales_master.json.
 *
 * Replaces the old 5-entry HUNTER_RUN_PRESETS. Now exposes all 71 sources
 * across 11 provinces. The Autocomplete in RunTab lets users search/filter.
 *
 * Keeping this in a lib file (not the page) means other surfaces
 * (smart-router, API endpoints, future CLI) can import it too.
 */

export type HunterSource = {
  id: string
  name: string
  province: string
  type: string
  authority: string
  opportunity: string
  url: string
  frequency: string
  priority: number
  redemption_days: number | null
  deposit_required: string | null
  hst_applicable: boolean
  notes: string
  active: boolean
  expected_months: number[]
  expected_quarter: string
  discovery_query: string
}

/**
 * Hunter sources loaded from external config.
 * In production, populate via HUNTER_SOURCES_PATH env var pointing to your JSON.
 * Returns empty array if no sources configured (safe for open-source builds).
 */
function loadSources(): HunterSource[] {
  try {
    const sourcesPath = process.env.HUNTER_SOURCES_PATH
    if (!sourcesPath) return []
    // Dynamic require — only resolves at runtime, not build time
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const data = require(sourcesPath)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export const HUNTER_SOURCES: HunterSource[] = loadSources()

/** Only sources marked active */
export const getActiveSources = (): HunterSource[] =>
  HUNTER_SOURCES.filter(s => s.active)

/** Active sources sorted by priority then name */
export const getSortedPresets = (): HunterSource[] =>
  [...getActiveSources()].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
