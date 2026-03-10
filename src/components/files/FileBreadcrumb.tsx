'use client'

import { ChevronRight, Home } from 'lucide-react'

type Props = {
  displayPath: string
  isRoot: boolean
  /** Called with segment index (-1 = root, 0..n = path segment) */
  onNavigate: (index: number) => void
}

export default function FileBreadcrumb({ displayPath, isRoot, onNavigate }: Props) {
  const parts = displayPath === 'Home' ? [] : displayPath.split('/').filter(Boolean)

  return (
    <nav
      aria-label="File path"
      className="flex items-center gap-0.5 px-4 py-2 text-xs overflow-x-auto scrollbar-none"
    >
      <button
        onClick={() => onNavigate(-1)}
        className={`flex items-center gap-1 shrink-0 transition-colors ${
          isRoot ? 'text-zinc-300 cursor-default' : 'text-zinc-500 hover:text-zinc-300 active:text-zinc-200'
        }`}
        aria-label="Home"
      >
        <Home size={12} />
        <span>Home</span>
      </button>

      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-0.5 shrink-0">
          <ChevronRight size={10} className="text-white/20" />
          <button
            onClick={i < parts.length - 1 ? () => onNavigate(i) : undefined}
            className={`transition-colors ${
              i === parts.length - 1
                ? 'text-zinc-300 cursor-default'
                : 'text-zinc-500 hover:text-zinc-300 active:text-zinc-200 cursor-pointer'
            }`}
          >
            {part}
          </button>
        </span>
      ))}
    </nav>
  )
}
