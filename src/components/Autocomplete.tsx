'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

type AutocompleteProps<T> = {
  items: T[]
  getLabel: (item: T) => string
  getSecondary?: (item: T) => string
  onSelect: (item: T) => void
  placeholder?: string
  value?: T | null
}

export default function Autocomplete<T>({
  items,
  getLabel,
  getSecondary,
  onSelect,
  placeholder = 'Search…',
  value,
}: AutocompleteProps<T>) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? items.filter(item => {
        const q = query.toLowerCase()
        return getLabel(item).toLowerCase().includes(q) ||
               (getSecondary?.(item) ?? '').toLowerCase().includes(q)
      })
    : items

  // Click-away close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const select = useCallback((item: T) => {
    onSelect(item)
    setQuery('')
    setOpen(false)
  }, [onSelect])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) { if (e.key === 'ArrowDown' || e.key === 'Enter') setOpen(true); return }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)); break
      case 'ArrowUp':   e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); break
      case 'Enter':     e.preventDefault(); if (filtered[highlight]) select(filtered[highlight]); break
      case 'Escape':    setOpen(false); break
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={open ? query : (value ? getLabel(value) : query)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder:text-zinc-600 outline-none focus:border-amber-600/40 transition-colors"
      />
      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-2xl bg-zinc-900 border border-white/[0.1] shadow-xl"
        >
          {filtered.map((item, i) => (
            <button
              key={i}
              onMouseDown={() => select(item)}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full text-left px-4 py-2.5 transition-colors ${
                i === highlight ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
              }`}
            >
              <span className="text-sm text-white">{getLabel(item)}</span>
              {getSecondary && (
                <span className="block text-[11px] text-zinc-500 mt-0.5">{getSecondary(item)}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && query.trim() && (
        <div className="absolute z-50 mt-1 w-full rounded-2xl bg-zinc-900 border border-white/[0.1] shadow-xl px-4 py-3">
          <p className="text-zinc-500 text-sm">No sources match &quot;{query}&quot;</p>
        </div>
      )}
    </div>
  )
}
