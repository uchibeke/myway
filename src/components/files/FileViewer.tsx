'use client'

import React, { useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileArchive } from 'lucide-react'
import { formatSize, formatDate } from '@/lib/file-types'
import { MarkdownContent } from '@/components/MarkdownContent'
import { slugify, parseOutline } from '@/lib/outline'
import DocumentOutline from '@/components/files/DocumentOutline'

export type FileData = {
  path: string
  displayPath: string
  name: string
  parent: string
  isRoot: boolean
  type: 'file'
  ext: string
  category: string
  size: number
  modified: string
  content: string | null
  binary: boolean
  editable: boolean
  reason?: string
}

type Props = {
  file: FileData
}

// Extract plain text from React children for slugify()
function childrenToText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map((c) => (typeof c === 'string' ? c : '')).join('')
  return ''
}

// Derives a public URL for a file inside the vault.
function getRawUrl(filePath: string) {
  return `/api/files/raw?path=${encodeURIComponent(filePath)}`
}

// Derives a preview URL for document/spreadsheet conversion.
function getPreviewUrl(filePath: string) {
  return `/api/files/preview?path=${encodeURIComponent(filePath)}`
}

export default function FileViewer({ file }: Props) {
  const rawUrl = useMemo(() => getRawUrl(file.path), [file.path])
  const previewUrl = useMemo(() => getPreviewUrl(file.path), [file.path])
  const scrollRef = useRef<HTMLDivElement>(null)
  const outline = useMemo(
    () => file.content ? parseOutline(file.content, file.category) : [],
    [file.content, file.category],
  )

  return (
    <div ref={scrollRef} className="relative flex-1 overflow-y-auto overscroll-contain">
      {/* ── Meta card ── */}
      <div className="mx-4 mt-4 mb-0 bg-white/[0.05] rounded-2xl overflow-hidden border border-white/[0.08] backdrop-blur-sm">
        <div className="flex items-start gap-3 p-4 border-b border-white/[0.06]">
          <div className="min-w-0 flex-1">
            <p className="text-white font-semibold truncate">{file.name}</p>
            <p className="text-zinc-500 text-xs mt-0.5">{file.displayPath}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-white/[0.06]">
          {[
            { label: 'Size', value: formatSize(file.size) },
            { label: 'Modified', value: formatDate(file.modified) },
            { label: 'Type', value: file.ext || 'unknown' },
          ].map(({ label, value }) => (
            <div key={label} className="px-4 py-3">
              <p className="text-zinc-600 text-xs">{label}</p>
              <p className="text-zinc-200 text-sm mt-0.5 font-medium truncate">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Content area ── */}
      <div className="p-4">
        {file.category === 'image' && (
          <div className="bg-black/40 rounded-2xl overflow-hidden border border-white/[0.08] flex items-center justify-center p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={rawUrl}
              alt={file.name}
              className="max-w-full max-h-[70vh] object-contain rounded-xl"
              loading="lazy"
            />
          </div>
        )}

        {file.category === 'video' && (
          <div className="bg-black/60 rounded-2xl overflow-hidden border border-white/[0.08]">
            <video
              src={rawUrl}
              controls
              className="w-full max-h-[70vh]"
              preload="metadata"
            />
          </div>
        )}

        {file.category === 'pdf' && (
          <div className="rounded-2xl overflow-hidden border border-white/[0.08] bg-black/30">
            <iframe
              src={rawUrl}
              title={file.name}
              className="w-full border-0"
              style={{ height: '75vh' }}
            />
          </div>
        )}

        {(file.category === 'document' || file.category === 'spreadsheet') && (
          <div className="rounded-2xl overflow-hidden border border-white/[0.08] bg-black/30">
            <iframe
              src={previewUrl}
              title={file.name}
              className="w-full border-0"
              style={{ height: '75vh' }}
            />
          </div>
        )}

        {file.category === 'audio' && (
          <div className="bg-white/[0.05] rounded-2xl p-6 border border-white/[0.08] flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-indigo-500/20 rounded-2xl flex items-center justify-center text-3xl">
              🎵
            </div>
            <p className="text-zinc-300 font-medium text-sm">{file.name}</p>
            <audio src={rawUrl} controls className="w-full" preload="metadata" />
          </div>
        )}

        {file.category === 'markdown' && file.content !== null && (
          <div className="bg-white/[0.04] rounded-2xl p-5 border border-white/[0.08] overflow-hidden">
            {/*
              FileViewer uses its own ReactMarkdown instance to support:
              - Heading anchor IDs (for in-page navigation)
              - Smooth-scroll anchor links
              - External links opening in new tab
              Table overflow and code overflow are handled by MarkdownContent's
              custom components, which we include here via a wrapper approach.

              We keep MarkdownContent for the base styles + table/pre overrides,
              then layer file-viewer-specific heading + link overrides on top.
            */}
            <div className={[
              'prose prose-sm prose-invert max-w-none',
              'prose-headings:text-zinc-100 prose-headings:font-semibold prose-headings:tracking-tight',
              'prose-p:text-zinc-300 prose-p:leading-relaxed',
              'prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-a:transition-colors',
              'prose-code:text-cyan-300 prose-code:bg-white/[0.08] prose-code:px-1.5 prose-code:py-0.5',
              'prose-code:rounded prose-code:text-[0.8em] prose-code:before:content-none prose-code:after:content-none',
              'prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/[0.08] prose-pre:rounded-xl',
              'prose-pre:overflow-x-auto prose-pre:max-w-full prose-pre:text-xs',
              'prose-blockquote:border-l-white/20 prose-blockquote:text-zinc-400 prose-blockquote:not-italic',
              'prose-strong:text-zinc-100',
              'prose-hr:border-white/[0.08]',
              'prose-li:text-zinc-300',
              'prose-table:text-sm prose-table:my-0',
              'prose-th:text-zinc-300 prose-th:font-semibold prose-th:bg-white/[0.06]',
              'prose-td:text-zinc-400 prose-td:border-white/[0.06]',
            ].join(' ')}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Heading anchors for in-page navigation
                  h1: ({ children, ...p }) => <h1 id={slugify(childrenToText(children))} {...p}>{children}</h1>,
                  h2: ({ children, ...p }) => <h2 id={slugify(childrenToText(children))} {...p}>{children}</h2>,
                  h3: ({ children, ...p }) => <h3 id={slugify(childrenToText(children))} {...p}>{children}</h3>,
                  h4: ({ children, ...p }) => <h4 id={slugify(childrenToText(children))} {...p}>{children}</h4>,
                  h5: ({ children, ...p }) => <h5 id={slugify(childrenToText(children))} {...p}>{children}</h5>,
                  h6: ({ children, ...p }) => <h6 id={slugify(childrenToText(children))} {...p}>{children}</h6>,
                  // Links: anchor links scroll smoothly, external links open in new tab
                  a: ({ href, children, ...p }) => {
                    if (href?.startsWith('#')) {
                      return (
                        <a
                          {...p}
                          href={href}
                          onClick={(e) => {
                            e.preventDefault()
                            document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          }}
                        >
                          {children}
                        </a>
                      )
                    }
                    return <a {...p} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                  },
                  // Tables scroll horizontally — never blow out the card
                  table: ({ children }) => (
                    <div className="overflow-x-auto w-full rounded-lg border border-white/[0.06] my-3">
                      <table className="min-w-full">{children}</table>
                    </div>
                  ),
                  // Code blocks scroll horizontally
                  pre: ({ children }) => (
                    <pre className="overflow-x-auto max-w-full">{children}</pre>
                  ),
                }}
              >
                {file.content}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {file.ext === '.csv' && (
          <div className="rounded-2xl overflow-hidden border border-white/[0.08] bg-black/30">
            <iframe
              src={previewUrl}
              title={file.name}
              className="w-full border-0"
              style={{ height: '75vh' }}
            />
          </div>
        )}

        {(file.category === 'code' || file.category === 'data' || file.category === 'text') &&
          file.ext !== '.csv' && file.content !== null && (
            <div className="bg-black/40 rounded-2xl overflow-hidden border border-white/[0.08]">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                <span className="text-xs text-zinc-500 font-mono uppercase tracking-wide">{file.ext}</span>
              </div>
              <pre className="text-xs text-zinc-300 p-4 overflow-x-auto whitespace-pre font-mono leading-relaxed max-h-[65vh] overflow-y-auto">
                <code>{file.content}</code>
              </pre>
            </div>
          )}

        {(file.binary || file.category === 'archive') && file.category !== 'pdf' && file.category !== 'document' && file.category !== 'spreadsheet' && (
          <div className="bg-white/[0.03] rounded-2xl p-10 flex flex-col items-center gap-3 border border-white/[0.06] text-center">
            <FileArchive size={36} className="text-zinc-700" strokeWidth={1} />
            <p className="text-zinc-500 text-sm">{file.reason ?? 'Preview not available'}</p>
          </div>
        )}
      </div>

      {outline.length > 0 && (
        <DocumentOutline items={outline} scrollContainerRef={scrollRef} />
      )}
    </div>
  )
}
