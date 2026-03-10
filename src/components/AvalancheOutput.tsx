'use client'

import { useMemo } from 'react'
import { MarkdownContent } from '@/components/MarkdownContent'

/**
 * AvalancheOutput — animated response renderer for button apps.
 *
 * Splits a numbered list response into individual items and renders each
 * with a staggered CSS spring animation (falls from above, 250ms apart).
 *
 * Used by ButtonShell when app.responseAnimation === 'avalanche'.
 * Reusable for any app that wants cascading item animation.
 *
 * Parsing rules:
 *   - Splits on numbered list markers (^1. ^2. etc.) at line start
 *   - Falls back to rendering the whole content as one item
 *   - Each item keeps its number — the markdown renderer handles styling
 */

type Props = {
  content: string
}

function parseItems(content: string): string[] {
  // Split on numbered list markers at the start of a line
  const parts = content.split(/(?=^\d+\.\s)/m)
  const trimmed = parts.map((s) => s.trim()).filter(Boolean)
  // Only split if we found multiple items — avoids splitting prose
  return trimmed.length > 1 ? trimmed : [content]
}

export default function AvalancheOutput({ content }: Props) {
  const items = useMemo(() => parseItems(content), [content])

  return (
    <div className="flex flex-col gap-3 w-full">
      {items.map((item, i) => (
        <div
          key={i}
          className="animate-avalanche-fall bg-white/[0.07] border border-white/[0.09]
                     rounded-2xl px-5 py-4 backdrop-blur-sm"
          style={{ animationDelay: `${i * 250}ms` }}
        >
          <MarkdownContent content={item} compact />
        </div>
      ))}
    </div>
  )
}
