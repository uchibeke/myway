'use client'

/**
 * ViewMode — global layout mode for the entire Myway frontend.
 *
 * Two modes:
 *   - mobile:   390px phone card (default)
 *   - expanded: up to 960px, content reflows via @container queries
 *
 * State is persisted in localStorage and shared across all pages
 * via React context. The toggle button is rendered here at the root
 * level — always visible on desktop regardless of which page is active.
 *
 * Architecture:
 *   layout.tsx → ViewModeProvider → page.tsx / AppPage / shells
 *                                 ↳ floating toggle button
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'

// ─── Types & Constants ───────────────────────────────────────────────────────

export type ViewMode = 'mobile' | 'expanded'

const LS_KEY = 'myway-view-mode'

type ViewModeContextValue = {
  mode: ViewMode
  toggle: () => void
  /** Card width class for the phone card container */
  widthClass: string
  /** Card height class for the phone card container */
  heightClass: string
  /** True after hydration — prevents layout shift */
  mounted: boolean
}

const ViewModeContext = createContext<ViewModeContextValue>({
  mode: 'mobile',
  toggle: () => {},
  widthClass: 'md:w-[390px]',
  heightClass: 'md:h-[844px] md:max-h-[calc(100vh-4rem)]',
  mounted: false,
})

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useViewMode() {
  return useContext(ViewModeContext)
}

// ─── Provider ────────────────────────────────────────────────────────────────

function getStoredMode(): ViewMode | null {
  if (typeof window === 'undefined') return null
  const v = localStorage.getItem(LS_KEY)
  return v === 'mobile' || v === 'expanded' ? v : null
}

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ViewMode>('mobile')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = getStoredMode()
    if (stored) setMode(stored)
    setMounted(true)
  }, [])

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next: ViewMode = prev === 'mobile' ? 'expanded' : 'mobile'
      localStorage.setItem(LS_KEY, next)
      return next
    })
  }, [])

  const isExpanded = mode === 'expanded'

  const widthClass = isExpanded
    ? 'md:w-full md:max-w-[960px]'
    : 'md:w-[390px]'

  const heightClass = isExpanded
    ? 'md:h-[calc(100vh-4rem)]'
    : 'md:h-[844px] md:max-h-[calc(100vh-4rem)]'

  return (
    <ViewModeContext.Provider value={{ mode, toggle, widthClass, heightClass, mounted }}>
      {children}

      {/* Floating toggle — fixed to bottom-right of viewport, desktop only */}
      {mounted && (
        <button
          onClick={toggle}
          className="
            hidden md:flex
            fixed bottom-6 right-6 z-[100]
            items-center justify-center
            w-9 h-9 rounded-full
            bg-zinc-800/80 hover:bg-zinc-700/90
            border border-zinc-700/50
            text-zinc-400 hover:text-zinc-200
            shadow-lg backdrop-blur-sm
            transition-all cursor-pointer
          "
          title={isExpanded ? 'Switch to mobile view' : 'Switch to expanded view'}
        >
          {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      )}
    </ViewModeContext.Provider>
  )
}
