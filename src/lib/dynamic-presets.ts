/**
 * Dynamic preset generator — client-side.
 *
 * Generates AppQuickAction[] from a context palette + contextAction verb.
 * Caps at 3 dynamic presets (Hick's Law — choice paralysis above 7 total).
 * Adds a final "Everything" preset that uses all available context.
 */

import type { AppQuickAction, TimeOfDay } from '@/lib/apps'
import type { ContextSummary } from '@/hooks/useContextSummary'

/** Sources hidden at certain times (progressive disclosure). */
const TIME_FILTERS: Record<string, TimeOfDay[]> = {
  // Calendar presets hidden at night/evening (events are over)
  calendar: ['early_morning', 'morning', 'midday', 'afternoon'],
  // Email presets hidden at night (wind-down)
  email: ['early_morning', 'morning', 'midday', 'afternoon', 'evening'],
}

export function generateDynamicPresets(
  contextAction: string,
  summary: ContextSummary,
  timeOfDay?: string,
): AppQuickAction[] {
  const presets: AppQuickAction[] = []

  for (const source of summary.sources) {
    // Skip sources filtered by time of day
    const allowed = TIME_FILTERS[source.key]
    if (allowed && timeOfDay && !allowed.includes(timeOfDay as TimeOfDay)) {
      continue
    }

    // Cap at 3 source-specific presets
    if (presets.length >= 3) break

    presets.push({
      label: `${source.icon} My ${source.label.toLowerCase()}`,
      hint: source.statLine,
      prompt: `${contextAction} my ${source.label.toLowerCase()}`,
      contextRef: source.key,
    })
  }

  // Final "everything" preset — only if we have any sources
  if (summary.sources.length > 0) {
    presets.push({
      label: '\u2728 Everything', // ✨
      hint: `${summary.totalItems} items across ${summary.sources.length} sources`,
      prompt: `${contextAction} everything you know about me`,
      contextRef: '*',
    })
  }

  return presets
}
