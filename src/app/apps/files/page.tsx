'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, X, Pencil, Eye, AlertCircle, Upload, Download } from 'lucide-react'
import FileBreadcrumb from '@/components/files/FileBreadcrumb'
import FileList, { type Entry, type SortKey, type SortDir } from '@/components/files/FileList'
import FileViewer, { type FileData } from '@/components/files/FileViewer'
import { SaveStatusBadge, type SaveStatus } from '@/components/files/FileEditor'
import AppPage from '@/components/AppPage'
import AppHeader from '@/components/AppHeader'
import { getAppGradient } from '@/lib/design'

const FileEditor = dynamic(() => import('@/components/files/FileEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-white/20 border-t-blue-400 rounded-full animate-spin" />
    </div>
  ),
})

// ─── Types ────────────────────────────────────────────────────────────────────

type DirData = {
  path: string
  displayPath: string
  parent: string | null
  isRoot: boolean
  type: 'dir'
  entries: Entry[]
  count: number
}

type ApiData = DirData | FileData
type ViewMode = 'view' | 'edit'

// ─── Inner page (needs useSearchParams, wrapped in Suspense below) ────────────

function FilesPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlPath = searchParams.get('path') // null = vault root

  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const [viewMode, setViewMode] = useState<ViewMode>('view')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')

  // ── Upload state ──────────────────────────────────────────────────────────
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ saved: number; errors: string[] } | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadFolderRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // ── Load whenever URL path changes ────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setShowSearch(false)
    setSearchQuery('')
    setViewMode('view')

    const url = urlPath
      ? `/api/files?path=${encodeURIComponent(urlPath)}`
      : '/api/files'

    fetch(url)
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return
        if (!ok) throw new Error(json.detail ?? json.error ?? 'Failed to load')
        setData(json)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [urlPath])

  // ── Navigation — URL is the source of truth ───────────────────────────────

  const goBack = useCallback(() => {
    if (data?.parent) {
      router.push(`/apps/files?path=${encodeURIComponent(data.parent)}`)
    } else {
      router.push('/')
    }
  }, [data, router])

  const navigateBreadcrumb = useCallback((segmentIndex: number) => {
    if (segmentIndex === -1 || !data) {
      router.push('/apps/files')
      return
    }
    if (data.type !== 'dir') return

    const parts = data.displayPath.split('/').filter(Boolean)
    const levelsUp = parts.length - 1 - segmentIndex
    let target = data.path
    for (let i = 0; i < levelsUp; i++) {
      target = target.split('/').slice(0, -1).join('/') || '/'
    }
    router.push(`/apps/files?path=${encodeURIComponent(target)}`)
  }, [data, router])

  // ── Sort ──────────────────────────────────────────────────────────────────

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }, [sortKey])

  // ── Upload ────────────────────────────────────────────────────────────────

  const doUpload = useCallback(async (files: FileList | File[], isFolder = false) => {
    // data must be a directory to upload into it
    if (!data || data.type !== 'dir') return
    const currentPath = data.path
    setUploading(true)
    setUploadResult(null)
    const form = new FormData()
    form.append('targetPath', currentPath)
    const fileArray = Array.from(files)
    for (const file of fileArray) {
      form.append('files[]', file)
      // For folder uploads, preserve relative path via webkitRelativePath
      const rel = isFolder && (file as File & { webkitRelativePath?: string }).webkitRelativePath
      form.append('relativePaths[]', rel || file.name)
    }
    try {
      const res = await fetch('/api/files/upload', { method: 'POST', body: form })
      const json = await res.json()
      setUploadResult({
        saved: json.saved?.length ?? 0,
        errors: (json.errors ?? []).map((e: { name: string; error: string }) => `${e.name}: ${e.error}`),
      })
      // Reload directory listing to show new files
      if (json.saved?.length > 0) {
        const url = currentPath ? `/api/files?path=${encodeURIComponent(currentPath)}` : '/api/files'
        fetch(url).then(r => r.json()).then(setData).catch((err) => console.warn('[Files] directory refresh after upload failed', err))
      }
    } catch {
      setUploadResult({ saved: 0, errors: ['Upload failed — check server logs'] })
    } finally {
      setUploading(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
      if (uploadFolderRef.current) uploadFolderRef.current.value = ''
    }
  }, [data])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    // Check if any dropped item is a directory via the DataTransferItem API
    const items = e.dataTransfer.items
    let hasFolder = false
    const entries: FileSystemEntry[] = []
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.()
        if (entry) {
          entries.push(entry)
          if (entry.isDirectory) hasFolder = true
        }
      }
    }

    if (hasFolder && entries.length > 0) {
      // Recursively traverse all directories to collect files with relative paths
      const collected: { file: File; relativePath: string }[] = []

      async function traverse(entry: FileSystemEntry, basePath: string): Promise<void> {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry
          const file = await new Promise<File>((resolve, reject) =>
            fileEntry.file(resolve, reject)
          )
          collected.push({ file, relativePath: basePath + entry.name })
        } else if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry
          const reader = dirEntry.createReader()
          // readEntries may return partial results — keep reading until empty
          let batch: FileSystemEntry[] = []
          do {
            batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
              reader.readEntries(resolve, reject)
            )
            for (const child of batch) {
              await traverse(child, basePath + entry.name + '/')
            }
          } while (batch.length > 0)
        }
      }

      for (const entry of entries) await traverse(entry, '')

      if (collected.length > 0) {
        // Build FormData manually to include relativePaths
        if (!data || data.type !== 'dir') return
        const currentPath = data.path
        setUploading(true)
        setUploadResult(null)
        const form = new FormData()
        form.append('targetPath', currentPath)
        for (const { file, relativePath } of collected) {
          form.append('files[]', file)
          form.append('relativePaths[]', relativePath)
        }
        try {
          const res = await fetch('/api/files/upload', { method: 'POST', body: form })
          const json = await res.json()
          setUploadResult({
            saved: json.saved?.length ?? 0,
            errors: (json.errors ?? []).map((e: { name: string; error: string }) => `${e.name}: ${e.error}`),
          })
          if (json.saved?.length > 0) {
            const url = currentPath ? `/api/files?path=${encodeURIComponent(currentPath)}` : '/api/files'
            fetch(url).then(r => r.json()).then(setData).catch((err) => console.warn('[Files] directory refresh after drop-upload failed', err))
          }
        } catch {
          setUploadResult({ saved: 0, errors: ['Upload failed — check server logs'] })
        } finally {
          setUploading(false)
        }
      }
    } else if (e.dataTransfer.files.length > 0) {
      // Plain file drop — no folder traversal needed
      doUpload(e.dataTransfer.files)
    }
  }, [doUpload, data])

  // ── Download ──────────────────────────────────────────────────────────────

  const download = useCallback((filePath: string, isDir = false) => {
    const url = `/api/files/download?path=${encodeURIComponent(filePath)}${isDir ? '&zip=1' : ''}`
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [])

  // ── Derived ───────────────────────────────────────────────────────────────

  const isFile = data?.type === 'file'
  const fileData = isFile ? (data as FileData) : null
  const dirData = !isFile ? (data as DirData | null) : null
  const canEdit = isFile && (data as FileData).editable
  const atRoot = !urlPath || data?.isRoot

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <AppPage gradient={getAppGradient('bg-yellow-500')}>

      {/* ── Header ── */}
      <AppHeader
        title="Files"
        icon="📁"
        onBack={goBack}
        backLabel={atRoot ? 'Home' : 'Back'}
        actions={
          <div className="flex items-center gap-1">
            {viewMode === 'edit' && <SaveStatusBadge status={saveStatus} />}
            {canEdit && !loading && (
              <button
                onClick={() => setViewMode((m) => m === 'view' ? 'edit' : 'view')}
                className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg
                           bg-white/10 hover:bg-white/15 text-zinc-300 hover:text-white
                           active:opacity-70 transition-colors"
              >
                {viewMode === 'view' ? <><Pencil size={12} /> Edit</> : <><Eye size={12} /> View</>}
              </button>
            )}
            {/* Download current file or directory */}
            {!loading && data && (
              <button
                onClick={() => download(data.path, data.type === 'dir')}
                className="p-2 text-zinc-400 hover:text-white active:opacity-60 transition-colors"
                aria-label={data.type === 'dir' ? 'Download folder as ZIP' : 'Download file'}
                title={data.type === 'dir' ? 'Download as ZIP' : 'Download'}
              >
                <Download size={17} />
              </button>
            )}
            {/* Upload — only on directories */}
            {!isFile && !loading && (
              <button
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploading}
                className="p-2 text-zinc-400 hover:text-white active:opacity-60 transition-colors disabled:opacity-30"
                aria-label="Upload files"
                title="Upload files"
              >
                <Upload size={17} />
              </button>
            )}
            {!isFile && (
              <button
                onClick={() => setShowSearch((s) => !s)}
                className="p-2 text-zinc-400 hover:text-white active:opacity-60 transition-colors"
                aria-label="Search"
              >
                {showSearch ? <X size={17} /> : <Search size={17} />}
              </button>
            )}
          </div>
        }
      />

      {/* ── Search bar ── */}
      {showSearch && !isFile && (
        <div className="px-4 py-2.5 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2 bg-white/[0.05] rounded-xl px-3 py-2.5
                          border border-white/[0.08] focus-within:border-white/20 transition-colors">
            <Search size={14} className="text-zinc-500 shrink-0" />
            <input
              autoFocus
              type="text"
              placeholder="Filter files…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-zinc-600 min-w-0"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-zinc-500 hover:text-zinc-300">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Breadcrumb ── */}
      {data && !loading && (
        <div className="border-b border-white/[0.06] shrink-0">
          <FileBreadcrumb
            displayPath={data.displayPath}
            isRoot={data.isRoot}
            onNavigate={navigateBreadcrumb}
          />
        </div>
      )}

      {/* ── Hidden upload inputs ── */}
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && doUpload(e.target.files)}
      />
      <input
        ref={uploadFolderRef}
        type="file"
        multiple
        // @ts-expect-error — webkitdirectory is not in React types but works in browsers
        webkitdirectory=""
        className="hidden"
        onChange={(e) => e.target.files && doUpload(e.target.files, true)}
      />

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">

        {loading && (
          <div className="flex items-center justify-center h-48 gap-3">
            <div className="w-5 h-5 border-2 border-white/10 border-t-blue-400 rounded-full animate-spin" />
            <span className="text-zinc-500 text-sm">Loading…</span>
          </div>
        )}

        {error && !loading && (
          <div className="m-4 p-4 bg-red-900/20 border border-red-500/20 rounded-2xl flex gap-3 items-start">
            <AlertCircle size={17} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 text-sm font-medium">Could not load</p>
              <p className="text-red-400/70 text-xs mt-1 font-mono">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && dirData && (
          <div
            className={`flex-1 overflow-y-auto overscroll-contain flex flex-col relative`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {/* Drag-over overlay */}
            {dragOver && (
              <div className="absolute inset-0 z-20 flex items-center justify-center
                              bg-blue-900/40 border-2 border-dashed border-blue-400/60 rounded-xl m-2">
                <p className="text-blue-300 font-medium text-sm">Drop files or folders to upload</p>
              </div>
            )}

            {/* Upload result notification */}
            {uploadResult && (
              <div className={`mx-4 mt-3 px-4 py-3 rounded-xl text-sm flex items-start gap-2
                ${uploadResult.errors.length === 0
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                  : 'bg-amber-500/10 border border-amber-500/20 text-amber-300'}`}>
                <span className="flex-1">
                  {uploadResult.saved > 0 && `✓ ${uploadResult.saved} file${uploadResult.saved !== 1 ? 's' : ''} uploaded`}
                  {uploadResult.errors.length > 0 && (
                    <>{uploadResult.saved > 0 ? ' · ' : ''}{uploadResult.errors.join(', ')}</>
                  )}
                </span>
                <button onClick={() => setUploadResult(null)} className="text-current opacity-60 hover:opacity-100 leading-none">×</button>
              </div>
            )}

            {/* Upload progress */}
            {uploading && (
              <div className="mx-4 mt-3 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin flex-shrink-0" />
                <p className="text-blue-300 text-sm">Uploading…</p>
              </div>
            )}

            <FileList
              entries={dirData.entries}
              totalCount={dirData.count}
              searchQuery={searchQuery}
              sortKey={sortKey}
              sortDir={sortDir}
              hrefFor={(path) => `/apps/files?path=${encodeURIComponent(path)}`}
              onSort={handleSort}
            />

            {/* Upload drop zone nudge */}
            {!uploading && (
              <div
                className="mx-4 my-4 px-4 py-6 rounded-2xl border-2 border-dashed border-white/[0.06]
                           flex flex-col items-center gap-3 text-white/20 cursor-pointer
                           hover:border-white/15 hover:text-white/35 transition-colors group"
                onClick={() => uploadInputRef.current?.click()}
              >
                <Upload size={20} className="group-hover:scale-110 transition-transform" />
                <div className="text-center">
                  <p className="text-xs font-medium">Drop files or folders here, or tap to upload</p>
                  <button
                    className="text-[10px] mt-1 text-white/20 group-hover:text-white/30 underline"
                    onClick={(e) => { e.stopPropagation(); uploadFolderRef.current?.click() }}
                  >
                    or upload a folder
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && !error && fileData && viewMode === 'view' && (
          <div className="flex-1 flex flex-col min-h-0">
            <FileViewer file={fileData} />
          </div>
        )}

        {!loading && !error && fileData && viewMode === 'edit' && fileData.content !== null && (
          <FileEditor
            filePath={fileData.path}
            ext={fileData.ext}
            initialContent={fileData.content}
            onStatusChange={setSaveStatus}
          />
        )}

      </div>
    </AppPage>
  )
}

// ─── Export with Suspense (required by useSearchParams in App Router) ─────────

export default function FilesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--brand-bg)' }}>
        <div className="w-5 h-5 border-2 border-white/10 border-t-blue-400 rounded-full animate-spin" />
      </div>
    }>
      <FilesPageInner />
    </Suspense>
  )
}
