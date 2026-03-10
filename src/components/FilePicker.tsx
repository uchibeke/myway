'use client'

/**
 * FilePicker — bottom-sheet file browser for attaching server-side files to a message.
 *
 * Uses /api/files to browse directories (same endpoint as the Files app).
 * Security: all path access is validated server-side by isPathAllowed().
 *
 * Props:
 *   open      — controls visibility
 *   onSelect  — called with MessageAttachment when user selects a file
 *   onClose   — called when user dismisses without selecting
 */

import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronLeft, X, FolderOpen, Loader2 } from 'lucide-react'
import FileIcon from '@/components/files/FileIcon'
import type { MessageAttachment } from '@/types/attachments'
import { formatSize } from '@/lib/file-types'
import type { FileCategory } from '@/lib/file-types'

type DirEntry = {
  name: string
  path: string
  type: 'dir' | 'file' | 'unknown'
  size: number
  ext: string | null
  category: string | null
}

type DirData = {
  path: string
  displayPath: string
  parent: string | null
  isRoot: boolean
  entries: DirEntry[]
}

type Props = {
  open: boolean
  onSelect: (att: MessageAttachment) => void
  onClose: () => void
}

export default function FilePicker({ open, onSelect, onClose }: Props) {
  const [dirData, setDirData] = useState<DirData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const navigate = useCallback(async (path?: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = path
        ? `/api/files?path=${encodeURIComponent(path)}`
        : '/api/files'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to load directory (${res.status})`)
      const data = await res.json() as DirData
      if (data.entries === undefined) throw new Error('Unexpected response')
      setDirData(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  // Load root on open
  useEffect(() => {
    if (open && !dirData) {
      navigate()
    }
  }, [open, dirData, navigate])

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setDirData(null)
      setError(null)
    }
  }, [open])

  if (!open) return null

  const handleSelect = (entry: DirEntry) => {
    if (entry.type === 'dir') {
      navigate(entry.path)
    } else if (entry.type === 'file') {
      onSelect({
        name: entry.name,
        path: entry.path,
        size: entry.size,
        category: entry.category ?? 'binary',
        ext: entry.ext ?? '',
      })
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Sheet */}
      <div className="relative w-full max-w-lg bg-zinc-900 border border-white/[0.10] rounded-t-3xl shadow-2xl max-h-[70vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.08] shrink-0">
          {dirData && !dirData.isRoot ? (
            <button
              onClick={() => navigate(dirData.parent ?? undefined)}
              className="w-8 h-8 flex items-center justify-center rounded-lg
                         text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
              aria-label="Go up"
            >
              <ChevronLeft size={18} />
            </button>
          ) : (
            <div className="w-8" />
          )}

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {dirData?.displayPath ?? 'Select a file'}
            </p>
            <p className="text-[11px] text-zinc-600">Tap a file to attach it to your message</p>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg
                       text-zinc-500 hover:text-white hover:bg-white/[0.08] transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={20} className="text-zinc-600 animate-spin" />
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 px-4 text-center">
              <p className="text-zinc-500 text-sm">{error}</p>
              <button
                onClick={() => navigate(dirData?.path)}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {dirData && !loading && !error && (
            <>
              {dirData.entries.length === 0 && (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-zinc-600">
                  <FolderOpen size={28} strokeWidth={1} />
                  <p className="text-xs">Empty folder</p>
                </div>
              )}

              <ul role="list">
                {dirData.entries.map((entry, i) => (
                  <li key={entry.path}>
                    <button
                      onClick={() => handleSelect(entry)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left
                                 hover:bg-white/[0.05] active:bg-white/[0.09] transition-colors"
                    >
                      <FileIcon
                        ext={entry.ext}
                        category={entry.category as FileCategory | undefined}
                        isDir={entry.type === 'dir'}
                        size={18}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-100 truncate">{entry.name}</p>
                        {entry.type === 'file' && (
                          <p className="text-[11px] text-zinc-600">{formatSize(entry.size)}</p>
                        )}
                      </div>
                      {entry.type === 'dir' && (
                        <ChevronRight size={15} className="text-zinc-700 shrink-0" />
                      )}
                    </button>
                    {i < dirData.entries.length - 1 && (
                      <div className="ml-[52px] h-px bg-white/[0.04]" aria-hidden />
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
