'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { ChevronRight, Folder } from 'lucide-react'
import FileIcon from './FileIcon'
import { formatSize, formatDate } from '@/lib/file-types'

export type Entry = {
  name: string
  path: string
  type: 'dir' | 'file' | 'unknown'
  size: number
  modified: string
  birthtime?: string
  ext: string | null
  category: string | null
  /** True for virtual link entries injected from MYWAY_LINKS. */
  isLink?: boolean
  /** Number of visible children — set for directories. */
  childCount?: number | null
}

export type SortKey = 'name' | 'size' | 'modified'
export type SortDir = 'asc' | 'desc'

type Props = {
  entries: Entry[]
  totalCount: number
  searchQuery: string
  sortKey: SortKey
  sortDir: SortDir
  hrefFor: (path: string) => string
  onSort: (key: SortKey) => void
}

export default function FileList({
  entries,
  totalCount,
  searchQuery,
  sortKey,
  sortDir,
  hrefFor,
  onSort,
}: Props) {
  const processed = useMemo(() => {
    let list = [...entries]

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((e) => e.name.toLowerCase().includes(q))
    }

    list.sort((a, b) => {
      // Dirs always first unless sorting explicitly by name
      if (sortKey !== 'name') {
        if (a.type === 'dir' && b.type !== 'dir') return -1
        if (a.type !== 'dir' && b.type === 'dir') return 1
      }
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'size') cmp = (a.size || 0) - (b.size || 0)
      else cmp = a.modified.localeCompare(b.modified)
      return sortDir === 'asc' ? cmp : -cmp
    })

    return list
  }, [entries, searchQuery, sortKey, sortDir])

  if (processed.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-zinc-600">
        <Folder size={40} strokeWidth={1} />
        <span className="text-sm">{searchQuery ? 'No matches' : 'Empty folder'}</span>
      </div>
    )
  }

  const SortBtn = ({ label, field }: { label: string; field: SortKey }) => (
    <button
      onClick={() => onSort(field)}
      className={`text-xs font-medium transition-colors ${
        sortKey === field ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'
      }`}
    >
      {label}{sortKey === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  )

  return (
    <div>
      {/* ── Column headers — desktop only ── */}
      <div className="hidden md:flex items-center px-4 py-2 border-b border-white/[0.06] gap-2">
        <div className="flex-1 min-w-0"><SortBtn label="Name" field="name" /></div>
        <div className="w-[90px]"><SortBtn label="Size" field="size" /></div>
        <div className="w-[130px]"><SortBtn label="Modified" field="modified" /></div>
        <div className="w-4" />
      </div>

      {/* ── Mobile sort strip ── */}
      <div className="flex md:hidden items-center gap-1 px-4 py-1.5 border-b border-white/[0.05]">
        <SortBtn label="Name" field="name" />
        <span className="text-white/20 mx-1">·</span>
        <SortBtn label="Date" field="modified" />
        <span className="text-white/20 mx-1">·</span>
        <SortBtn label="Size" field="size" />
        <span className="ml-auto text-xs text-zinc-700">
          {processed.length}{searchQuery ? ` / ${totalCount}` : ''}
        </span>
      </div>

      {/* ── Entry list ── */}
      <ul role="list">
        {processed.map((entry, i) => (
          <li key={entry.path} className="relative">
            <Link
              href={hrefFor(entry.path)}
              className="
                block w-full px-4 py-3 text-left group
                hover:bg-white/[0.04] active:bg-white/[0.07] transition-colors
                flex items-center gap-3
                md:grid md:grid-cols-[1fr_90px_130px_16px] md:gap-2
              "
            >
              {/* Icon + Name + mobile meta */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <FileIcon
                  ext={entry.ext}
                  isDir={entry.type === 'dir'}
                  size={18}
                />
                <div className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-zinc-100 text-sm font-medium truncate
                                     group-hover:text-white transition-colors">
                      {entry.name}
                    </span>
                    {entry.isLink && (
                      <span className="shrink-0 text-[10px] text-zinc-600 font-mono
                                       bg-white/[0.05] border border-white/[0.08]
                                       px-1 py-0.5 rounded leading-none"
                        title="Virtual link — file lives outside Home"
                      >
                        ↗
                      </span>
                    )}
                  </span>
                  {/* Mobile: meta inline below name */}
                  <span className="md:hidden text-zinc-600 text-xs truncate block">
                    {entry.type === 'dir'
                      ? [
                          entry.isLink ? 'Linked folder' : 'Folder',
                          entry.childCount != null
                            ? `${entry.childCount} item${entry.childCount !== 1 ? 's' : ''}`
                            : null,
                        ].filter(Boolean).join(' · ')
                      : [formatSize(entry.size), entry.modified ? formatDate(entry.modified) : '']
                          .filter(Boolean).join(' · ')
                    }
                  </span>
                </div>
              </div>

              {/* Desktop: size / child count */}
              <span className="hidden md:block text-zinc-500 text-sm tabular-nums">
                {entry.type === 'file'
                  ? formatSize(entry.size)
                  : entry.childCount != null
                    ? `${entry.childCount} item${entry.childCount !== 1 ? 's' : ''}`
                    : '—'
                }
              </span>

              {/* Desktop: date */}
              <span className="hidden md:block text-zinc-500 text-sm">
                {entry.modified ? formatDate(entry.modified) : '—'}
              </span>

              {/* Chevron */}
              <ChevronRight
                size={15}
                className="text-zinc-700 group-hover:text-zinc-400 transition-colors shrink-0 ml-auto md:ml-0"
              />
            </Link>

            {i < processed.length - 1 && (
              <div className="ml-[52px] h-px bg-white/[0.04]" aria-hidden />
            )}
          </li>
        ))}
      </ul>

      <p className="hidden md:block px-4 py-3 text-center text-xs text-zinc-700 border-t border-white/[0.05]">
        {processed.length} item{processed.length !== 1 ? 's' : ''}
        {searchQuery ? ` (filtered from ${totalCount})` : ''}
      </p>
    </div>
  )
}
