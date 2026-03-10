'use client'

/**
 * SegmentedControl — shared tab-bar for tool apps.
 *
 * Used by: Settings, Hunter, and any future tool app with tabs.
 * Accepts pre-resolved icon nodes so callers control Lucide imports.
 *
 * Tab routing is the caller's responsibility:
 *   - URL query param (?tab=<id>) for deep-link-friendly navigation
 *   - useState for ephemeral tabs (no URL persistence needed)
 */

export type SegmentedTab = {
  id: string
  label: string
  icon?: React.ReactNode
}

export default function SegmentedControl({
  tabs,
  value,
  onChange,
  flush = false,
}: {
  tabs: SegmentedTab[]
  value: string
  onChange: (id: string) => void
  /** When true, removes outer mx-4 mt-3 spacing — use when embedding inline. */
  flush?: boolean
}) {
  return (
    <div className={flush ? '' : 'mx-4 mt-3'}>
      <div className="flex gap-0.5 p-1 rounded-xl bg-white/[0.05] border border-white/[0.08]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex-auto flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-medium transition-all ${
              value === t.id
                ? 'bg-white/[0.12] text-white shadow-sm'
                : 'text-white/35 hover:text-white/55'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}
