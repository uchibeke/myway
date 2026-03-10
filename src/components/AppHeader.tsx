'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

/**
 * Shared header bar used by every app page.
 *
 * Layout: [back]  [icon? + title]  [actions?]
 *
 * - backHref: renders a <Link> (for static back destinations)
 * - onBack: renders a <button> (for dynamic back logic, e.g. Files)
 * - backLabel defaults to "Back"
 */
type Props = {
  title: string
  icon?: string
  backHref?: string
  onBack?: () => void
  backLabel?: string
  actions?: React.ReactNode
}

export default function AppHeader({
  title,
  icon,
  backHref,
  onBack,
  backLabel = 'Back',
  actions,
}: Props) {
  const backContent = (
    <>
      <ArrowLeft size={17} />
      <span className="text-sm font-medium">{backLabel}</span>
    </>
  )

  const backCls =
    'flex items-center gap-1.5 text-white/60 hover:text-white/80 active:opacity-60 transition-colors min-w-[64px]'

  return (
    <header className="
      relative z-20 flex items-center gap-3 px-4 app-header-top pb-3 shrink-0
      bg-black/20 backdrop-blur-md border-b border-white/[0.08]
      md:px-5
    ">
      {backHref ? (
        <Link href={backHref} className={backCls}>
          {backContent}
        </Link>
      ) : onBack ? (
        <button onClick={onBack} aria-label={backLabel} className={backCls}>
          {backContent}
        </button>
      ) : (
        <div className="min-w-[64px]" />
      )}

      <div className="flex-1 flex items-center justify-center gap-2">
        {icon && <span className="text-lg">{icon}</span>}
        <span className="font-semibold text-white text-[15px] tracking-tight">{title}</span>
      </div>

      <div className="min-w-[64px] flex justify-end">
        {actions}
      </div>
    </header>
  )
}
