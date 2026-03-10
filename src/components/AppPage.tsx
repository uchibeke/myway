'use client'

/**
 * AppPage — shared phone-card shell for all Myway app pages.
 *
 * Reads view mode from the global ViewModeProvider (set at root layout level).
 * The card is marked as a CSS @container so children can use container query
 * variants (@lg:, @3xl:) to reflow content based on the card's actual width.
 * Note: @lg = 512px, @3xl = 768px in Tailwind v4 container queries.
 * Mobile card = 390px (below @lg → base styles only).
 * Expanded card = 960px (above @3xl → all responsive styles fire).
 *
 * On actual mobile devices: always full-screen, no rounding.
 */

import { useViewMode } from '@/lib/view-mode'

type Props = {
  gradient: string
  children: React.ReactNode
  /** Use 480 px instead of 390 px on desktop (mobile mode only). */
  wide?: boolean
}

export default function AppPage({ gradient, children, wide = false }: Props) {
  const { mode, widthClass: globalWidthClass, heightClass } = useViewMode()

  const isExpanded = mode === 'expanded'

  // In mobile mode, allow `wide` prop to use 480px instead of 390px
  const widthClass = isExpanded
    ? globalWidthClass
    : wide
      ? 'md:w-[480px]'
      : globalWidthClass

  return (
    <div className="h-dvh md:h-auto md:min-h-screen md:flex md:justify-center md:items-start md:py-8 overflow-x-hidden" style={{ background: 'var(--brand-bg)' }}>
      <div
        className={`
          @container relative flex flex-col text-white w-full h-full overflow-hidden min-w-0 min-h-[568px]
          ${heightClass}
          md:rounded-[2.5rem]
          md:ring-1 md:ring-white/15
          md:shadow-[0_50px_100px_-20px_rgba(0,0,0,0.95)]
          page-enter
          ${widthClass}
        `}
      >
        {/* Ambient gradient — absolute so it fills the card without affecting layout */}
        <div className="absolute inset-0 -z-10" style={{ background: gradient }} />
        {children}
      </div>
    </div>
  )
}
