'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { List, X } from 'lucide-react'
import type { OutlineItem } from '@/lib/outline'

type Props = {
  items: OutlineItem[]
  scrollContainerRef: React.RefObject<HTMLElement | null>
}

export default function DocumentOutline({ items, scrollContainerRef }: Props) {
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // ── Active section tracking via IntersectionObserver ──
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || items.length === 0) return

    const headingEls = items
      .map((item) => document.getElementById(item.id))
      .filter(Boolean) as HTMLElement[]

    if (headingEls.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the last heading that is intersecting (closest to top of viewport)
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        }
      },
      {
        root: container,
        rootMargin: '0px 0px -70% 0px',
        threshold: 0,
      },
    )

    headingEls.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [items, scrollContainerRef])

  // ── Click outside to dismiss ──
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const navigate = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setOpen(false)
  }, [])

  const levelStyles: Record<number, string> = {
    1: 'pl-0 font-bold text-zinc-100',
    2: 'pl-3 font-semibold text-zinc-200',
    3: 'pl-6 font-normal text-zinc-400',
    4: 'pl-9 font-normal text-zinc-500',
    5: 'pl-9 font-normal text-zinc-500',
    6: 'pl-9 font-normal text-zinc-500',
  }

  return (
    <div className="sticky bottom-0 z-40 pointer-events-none h-0">
      <div ref={panelRef} className="absolute right-4 bottom-4 flex flex-col items-end gap-2 pointer-events-auto">
        {/* ── Overlay panel ── */}
        {open && (
          <div
            className="w-[260px] max-h-[70vh] bg-zinc-900/95 backdrop-blur-xl border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Outline</span>
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto py-2 px-2">
              {items.map((item) => {
                const isActive = activeId === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.id)}
                    className={[
                      'w-full text-left text-xs py-1.5 px-2 rounded-lg transition-colors truncate',
                      levelStyles[item.level] ?? levelStyles[6],
                      isActive
                        ? 'bg-white/[0.06] border-l-2 border-white/20 !text-zinc-100'
                        : 'hover:bg-white/[0.04]',
                    ].join(' ')}
                  >
                    {item.text}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── FAB trigger ── */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2.5 bg-white/[0.07] border border-white/[0.10] backdrop-blur-sm rounded-full text-zinc-300 hover:text-white hover:bg-white/[0.12] transition-all active:scale-95"
        >
          <List size={18} />
          <span className="text-xs font-medium tabular-nums">{items.length}</span>
        </button>
      </div>
    </div>
  )
}
